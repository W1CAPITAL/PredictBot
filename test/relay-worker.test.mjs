import test from 'node:test';import assert from 'node:assert/strict';import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const binding={RELAY_SIGNING_KEY:'synthetic-test-signing-key-32-bytes',SUPABASE_URL:'https://auth.example.test',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable'};
function bearer({user='user-a',oauth=false}={}){return 'Bearer '+Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user,iss:binding.SUPABASE_URL+'/auth/v1',aud:'authenticated',exp:Date.now()/1000+3600,aal:'aal2',...(oauth?{client_id:'client-allowed'}:{})})).toString('base64url')+'.synthetic-signature';}
function runtime(persist){return new Miniflare({modules:true,scriptPath:'dist/worker.mjs',compatibilityDate:'2026-07-28',compatibilityFlags:['nodejs_compat'],bindings:binding,durableObjects:{RELAY:{className:'OpenCodeRelay',useSQLite:true}},durableObjectsPersist:persist,outboundService:async request=>{const path=new URL(request.url).pathname;const claims=JSON.parse(Buffer.from(request.headers.get('authorization').slice(7).split('.')[1],'base64url').toString());return Response.json(path==='/auth/v1/user'?{id:claims.sub}:path.includes('/usuarios')?[{empresa_id:claims.sub==='user-a'?'company-a':'company-b'}]:path.includes('policies')?[{config:{mcp_enabled:true,mcp_allowed_client_ids:['client-allowed']}}]:true);}});}
async function call(mf,path,body,authorization=bearer()){const response=await mf.dispatchFetch('https://relay.test'+path,{method:body?'POST':'GET',headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,headers:response.headers,data:await response.json()};}
test('Worker autentica MCP, pareia dispositivo, executa fila e persiste em reinício',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'w1-relay-worker-'));let mf=runtime(dir);
 try{
  assert.equal((await call(mf,'/health')).data.configured,true);
  const denied=await call(mf,'/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},'');assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
  const init=await call(mf,'/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}},bearer({oauth:true}));assert.equal(init.status,200);assert.ok(init.data.result.serverInfo);
  const tools=await call(mf,'/mcp',{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},bearer({oauth:true}));assert.ok(tools.data.result.tools.some(t=>t.name==='opencode_send_prompt'));
  const pair=await call(mf,'/v1/pair',{scopes:['read']});assert.equal(pair.status,200);
  assert.equal((await call(mf,'/v1/claim',{pairingCode:pair.data.pairingCode+'bad',name:'Test'})).status,401);
  const claim=await call(mf,'/v1/claim',{pairingCode:pair.data.pairingCode,name:'Test desktop'});assert.equal(claim.status,200);
  const credential='Bearer '+claim.data.credential;
  assert.equal((await call(mf,'/v1/device/poll',{},credential)).data.state,'pending');
  await call(mf,'/v1/approve',{deviceId:claim.data.deviceId,confirmation:claim.data.confirmation});
  const key=crypto.randomUUID();assert.equal((await call(mf,'/v1/jobs',{deviceId:claim.data.deviceId,key,operation:'health',input:{}})).status,200);
  const poll=await call(mf,'/v1/device/poll',{},credential);assert.equal(poll.data.job.operation,'health');
  await call(mf,'/v1/device/complete',{jobId:key,lease:poll.data.job.lease,status:'succeeded',result:{healthy:true}},credential);
  assert.equal((await call(mf,'/v1/task',{jobId:key},bearer({user:'user-b'}))).status>=400,true);
  await mf.dispose();mf=runtime(dir);
  assert.equal((await call(mf,'/v1/task',{jobId:key})).data.result.healthy,true);
  await call(mf,'/v1/revoke',{deviceId:claim.data.deviceId});assert.equal((await call(mf,'/v1/device/poll',{},credential)).status>=400,true);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
