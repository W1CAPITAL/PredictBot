import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpenCodeRuntime,detectOpenCode} from '../src/opencode-runtime.mjs';
const executable=process.env.W1_OPENCODE_EXECUTABLE;
if(!executable)throw Error('Defina W1_OPENCODE_EXECUTABLE para um binário OpenCode instalado.');
const root=await mkdtemp(join(tmpdir(),'w1-opencode-live-'));const runtime=new OpenCodeRuntime();
try{
 const detection=await detectOpenCode({executable});assert.equal(detection.installed,true);
 const {adapter}=await runtime.start({executable,directory:root,stateDirectory:join(root,'state'),principal:{userId:'smoke-only',companyId:'smoke-only'}});
 const health=await adapter.health();assert.equal(health.healthy,true);
 const session=await adapter.createSession({title:'W1 smoke test — sem IA'});
 assert.equal((await adapter.getSession(session.id)).id,session.id);
 await adapter.configureMcp('w1-smoke-disabled',{type:'remote',url:'https://example.invalid/mcp',disabled:true});
 await adapter.listMcpServers();await adapter.manageMcp('w1-smoke-disabled','mcpRemove');
 await adapter.listProviders();await adapter.listModels();await adapter.listMcpServers();await adapter.getMessages(session.id);
 assert.equal((await adapter.listSessions()).length,1);
 await assert.rejects(()=>adapter.getSession('ses_outro'),/não autorizada/);
 console.log(JSON.stringify({verified:true,version:health.version,sessionCreated:true,sessionRead:true,models:true,mcpStatus:true,modelPromptSent:false}));
}finally{runtime.stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
