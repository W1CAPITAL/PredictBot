import test from 'node:test';import assert from 'node:assert/strict';import {OpenCodeRelayClient} from '../src/relay/client.mjs';
const principal={userId:'u',companyId:'c'};
function fixture(job,approve){let sent=false;const calls=[],executed=[];const adapter={forPrincipal(p){assert.deepEqual(p,principal);return this;},health:async()=>({healthy:true}),sendPrompt:async(...args)=>{executed.push(args);return {accepted:true};}};const fetch=async(url,options)=>{const path=new URL(url).pathname,body=JSON.parse(options.body);calls.push({path,body});if(path==='/v1/claim')return Response.json({principal,credential:'opaque-device-credential',deviceId:'test-device',confirmation:'SYNTHETIC'});if(path.endsWith('/poll'))return Response.json({state:'approved',job:sent?null:(sent=true,job)});return Response.json({recorded:true});};return {adapter,executed,calls,client:new OpenCodeRelayClient({url:'https://relay.example.test',approve,fetch})};}
test('tarefa remota não recebe execução sem confirmação local',async()=>{const job={id:'job-test001',operation:'prompt',input:{sessionId:'ses_test',text:'synthetic'},lease:'synthetic-lease',expiresAt:Date.now()+60000};const f=fixture(job);try{await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();assert.equal(f.executed.length,0);assert.equal(f.calls.find(x=>x.path.endsWith('/complete')).body.status,'failed');}finally{f.client.stop();}});
test('prompt aprovado é enviado uma vez e encaminha somente recibo',async()=>{const job={id:'job-test002',operation:'prompt',input:{sessionId:'ses_test',text:'synthetic'},lease:'synthetic-lease',expiresAt:Date.now()+60000};const f=fixture(job,async()=>true);try{await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();await f.client.tick();assert.equal(f.executed.length,1);assert.equal(f.calls.find(x=>x.path.endsWith('/complete')).body.result.accepted,true);}finally{f.client.stop();}});
test('ponte remota não aceita HTTP',()=>assert.throws(()=>new OpenCodeRelayClient({url:'http://127.0.0.1:4096'}),/HTTPS/));
test('resposta grande de escrita confirmada conserva sucesso e identificador para recuperação',async()=>{
 const job={id:'job-large-result',operation:'prompt',input:{sessionId:'ses_test',text:'synthetic'},lease:'synthetic-lease',expiresAt:Date.now()+60000};
 const f=fixture(job,async()=>true);let attempts=0;
 f.adapter.sendPrompt=async()=>{attempts++;return {accepted:true,sessionId:'ses_test',details:'x'.repeat(240001)};};
 try{
  await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();await f.client.tick();
  const receipt=f.calls.find(x=>x.path.endsWith('/complete')).body;
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.result.truncated,true);
  assert.equal(receipt.result.accepted,true);assert.equal(receipt.result.sessionId,'ses_test');
  assert.ok(JSON.stringify(receipt.result).length<2000);assert.equal(attempts,1);
 }finally{f.client.stop();}
});
for(const details of ['x'.repeat(70000),'語'.repeat(23000)])test('recibo cabe no limite real de 64 KiB do Worker, incluindo UTF-8',async()=>{
 const job={id:'job-worker-limit',operation:'prompt',input:{sessionId:'ses_test',text:'synthetic'},lease:'synthetic-lease',expiresAt:Date.now()+60000};
 const f=fixture(job,async()=>true);let attempts=0;
 f.adapter.sendPrompt=async()=>{attempts++;return {accepted:true,sessionId:'ses_test',details};};
 try{
  await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();await f.client.tick();
  const receipt=f.calls.find(x=>x.path.endsWith('/complete')).body;
  assert.ok(new TextEncoder().encode(JSON.stringify(receipt)).byteLength<65536);
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.result.truncated,true);
  assert.equal(receipt.result.sessionId,'ses_test');assert.equal(attempts,1);
 }finally{f.client.stop();}
});
test('resposta atrasada de dispositivo anterior não derruba novo pareamento',async()=>{
 let release,polls=0,claims=0;const fetch=async(url)=>{const path=new URL(url).pathname;if(path==='/v1/claim')return Response.json({principal,credential:'credential-'+(++claims),deviceId:'device-'+claims,confirmation:'SYNTHETIC'});if(path.endsWith('/poll')){polls++;if(polls===1)return new Promise(ok=>release=()=>ok(new Response(null,{status:401})));return Response.json({state:'pending',job:null});}return Response.json({recorded:true});};
 const client=new OpenCodeRelayClient({url:'https://relay.example.test',fetch}),adapter={forPrincipal(){return this;}};
 try{await client.pair({pairingCode:'first',name:'first',adapter});const previous=client.tick();await client.pair({pairingCode:'second',name:'second',adapter});release();await previous;await client.tick();assert.equal(polls,2);}finally{client.stop();}
});
for(const [operation,method,input] of [
 ['prompt','sendPrompt',{sessionId:'ses_test',text:'synthetic'}],
 ['create','createSession',{title:'synthetic'}],
 ['abort','abortSession',{sessionId:'ses_test'}]
])test('erro da API após tentar '+operation+' preserva resultado desconhecido',async()=>{
 const job={id:'job-uncertain-'+operation,operation,input,lease:'synthetic-lease',expiresAt:Date.now()+60000};
 const f=fixture(job,async()=>true);let attempts=0;
 f.adapter[method]=async()=>{attempts++;throw Error('OpenCode respondeu HTTP 503.');};
 try{await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();await f.client.tick();
  const receipt=f.calls.find(x=>x.path.endsWith('/complete')).body;
  assert.equal(receipt.status,'unknown');assert.match(receipt.result.error,/Não repita automaticamente/);assert.equal(attempts,1);
 }finally{f.client.stop();}
});
test('erro explícito de leitura continua sendo falha, sem alegar efeito de escrita',async()=>{
 const job={id:'job-read-failure',operation:'health',input:{},lease:'synthetic-lease',expiresAt:Date.now()+60000};const f=fixture(job);
 f.adapter.health=async()=>{throw Error('OpenCode respondeu HTTP 503.');};
 try{await f.client.pair({pairingCode:'synthetic',name:'test',adapter:f.adapter});await f.client.tick();assert.equal(f.calls.find(x=>x.path.endsWith('/complete')).body.status,'failed');}finally{f.client.stop();}
});
