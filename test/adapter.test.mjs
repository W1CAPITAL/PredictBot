import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenCodeAdapter,validateEndpoint,validateMcpConfig} from '../src/opencode-adapter.mjs';
const principal={userId:'davi-test',companyId:'w1-test'};
const paths={'/api/info':{get:{operationId:'server.info'}},'/api/session':{post:{operationId:'session.create'}},'/api/session/{sessionID}':{get:{operationId:'session.get'}},'/api/session/{sessionID}/prompt':{post:{operationId:'session.prompt'}},'/api/mcp':{get:{operationId:'mcp.list'}}};
function fixture(){const calls=[];const fetch=async(url,options={})=>{calls.push({url:String(url),...options});const p=new URL(url).pathname;return Response.json(p==='/doc'?{openapi:'3.1.0',paths}:p==='/api/info'?{version:'2.3.0'}:p==='/api/session'?{data:{id:'ses_test'}}:{data:{id:'ses_test'}});};return {calls,adapter:new OpenCodeAdapter({url:'http://127.0.0.1:4096',password:'fixture-only',directory:'/tmp/w1-fixture',principal,fetch})};}
test('permite HTTP apenas loopback literal e recusa credenciais na URL',()=>{assert.throws(()=>validateEndpoint('http://remote.test'));assert.throws(()=>validateEndpoint('http://127.0.0.2'));assert.throws(()=>validateEndpoint('https://u:p@example.test'));assert.throws(()=>validateEndpoint('https://example.test/path'));assert.equal(validateEndpoint('http://127.0.0.1:4096').hostname,'127.0.0.1');});
test('usa contrato /doc e protege autenticação de redirects',async()=>{const {adapter,calls}=fixture();assert.equal((await adapter.health()).version,'2.3.0');assert.ok(calls.every(c=>c.redirect==='error'));assert.ok(calls.every(c=>c.headers.Authorization.startsWith('Basic ')));});
test('nega sessão desconhecida antes de acessar API',async()=>{const {adapter,calls}=fixture();await assert.rejects(()=>adapter.getSession('ses_other'),/autorizada/);assert.equal(calls.length,0);});
test('cria sessão com permissões fechadas e permite recuperar somente a própria',async()=>{const {adapter,calls}=fixture();const s=await adapter.createSession({title:'Teste'});assert.equal(s.id,'ses_test');const body=JSON.parse(calls.find(c=>c.method==='POST').body);assert.deepEqual(body.permissions,[{action:'*',resource:'*',effect:'deny'}]);assert.equal((await adapter.getSession(s.id)).id,s.id);});
test('não repete prompt automaticamente em falha',async()=>{const {adapter,calls}=fixture();await adapter.createSession({});await adapter.sendPrompt('ses_test','Olá');assert.equal(calls.filter(c=>c.url.endsWith('/prompt')).length,1);});
test('operação ausente é indisponível e não vira sucesso vazio',async()=>{const {adapter}=fixture();await adapter.health();await assert.rejects(()=>adapter.listModels(),/disponível/);});
test('erros HTTP não expõem corpo nem senha',async()=>{const adapter=new OpenCodeAdapter({url:'http://127.0.0.1:4096',password:'secret-test',directory:'/tmp/x',principal,fetch:async()=>new Response('secret-test',{status:401})});await assert.rejects(()=>adapter.health(),e=>e.message.includes('401')&&!e.message.includes('secret-test'));});
test('MCP recusa segredos literais e usa formato V2 disabled',()=>{assert.throws(()=>validateMcpConfig({type:'remote',url:'https://mcp.test',headers:{Authorization:'Bearer literal-secret'}}));assert.throws(()=>validateMcpConfig({type:'local',command:['sh','-c','whoami']},false));assert.deepEqual(validateMcpConfig({type:'remote',url:'https://mcp.test',disabled:true,headers:{Authorization:'Bearer {env:TEST_TOKEN}'}}).disabled,true);});
test('contrato não pode redirecionar Basic Auth para outra origem',async()=>{
 const {adapter,calls}=fixture();
 const hostile=new OpenCodeAdapter({url:'http://127.0.0.1:4096',password:'synthetic-only',directory:'/tmp/x',principal,fetch:async url=>{calls.push(String(url));return Response.json({openapi:'3.1.0',paths:{'//evil.test/api/info':{get:{operationId:'server.info'}}}});}});
 await assert.rejects(()=>hostile.health(),/origem/);assert.equal(calls.length,1);
});
test('sessões persistidas permanecem isoladas por empresa',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const state=await mkdtemp(join(tmpdir(),'w1-sessions-'));const fetch=async url=>Response.json(new URL(url).pathname==='/doc'?{openapi:'3.1.0',paths}:new URL(url).pathname==='/api/info'?{version:'2.3.0'}:{data:{id:'ses_persisted'}});
 try{const config={url:'http://127.0.0.1:4096',password:'synthetic',directory:'/tmp/p',principal,stateDirectory:state,fetch};const first=new OpenCodeAdapter(config);await first.createSession({});assert.equal((await new OpenCodeAdapter(config).getSession('ses_persisted')).id,'ses_persisted');await assert.rejects(()=>new OpenCodeAdapter({...config,principal:{...principal,companyId:'another'}}).getSession('ses_persisted'),/não autorizada/);}finally{await rm(state,{recursive:true,force:true});}
});
test('SSE entrega somente eventos da sessão autorizada',async()=>{
 const ssePaths={...paths,'/api/event':{get:{operationId:'event.subscribe'}}};
 const fetch=async url=>{const path=new URL(url).pathname;if(path==='/api/event')return new Response('data: {"type":"session.text.delta","data":{"sessionID":"ses_other","text":"private"}}\n\ndata: {"type":"session.text.delta","data":{"sessionID":"ses_test","text":"public"}}\n\n');return Response.json(path==='/doc'?{openapi:'3.1.0',paths:ssePaths}:path==='/api/info'?{version:'2.3.0'}:{data:{id:'ses_test'}});};
 const adapter=new OpenCodeAdapter({url:'http://127.0.0.1:4096',password:'synthetic',directory:'/tmp/p',principal,fetch});await adapter.createSession({});const events=[];for await(const event of adapter.streamEvents('ses_test'))events.push(event);assert.equal(events.length,1);assert.equal(events[0].data.text,'public');
});
