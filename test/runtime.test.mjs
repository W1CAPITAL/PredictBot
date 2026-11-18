import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectOpenCode,OpenCodeRuntime} from '../src/opencode-runtime.mjs';
test('detecção não executa strings de shell nem caminhos relativos',async()=>{assert.equal((await detectOpenCode({executable:'echo secret; whoami'})).installed,false);assert.equal((await detectOpenCode({path:''})).installed,false);});
test('parar runtime sem processo próprio é inofensivo',()=>{new OpenCodeRuntime().stop();});
test('reconhece formato real de versão do OpenCode', {skip:process.platform==='win32'},async()=>{const root=await mkdtemp(join(tmpdir(),'w1-bin-'));try{const binary=join(root,'opencode');await writeFile(binary,'#!/bin/sh\necho "opencode v2.3.0"\n');await chmod(binary,0o700);assert.equal((await detectOpenCode({executable:binary})).version,'2.3.0');}finally{await rm(root,{recursive:true,force:true});}});

import {createLocalAIEnvironment} from '../src/opencode-runtime.mjs';

test('injeta somente o config local e a chave W1 na sessão OpenCode',()=>{
 const result=createLocalAIEnvironment({configPath:'C:\\Users\\Test\\AppData\\Roaming\\W1\\local-ai\\opencode.json',apiKey:'a'.repeat(48)});
 assert.deepEqual(result,{OPENCODE_CONFIG:'C:\\Users\\Test\\AppData\\Roaming\\W1\\local-ai\\opencode.json',W1_LOCAL_AI_KEY:'a'.repeat(48)});
});

test('não injeta configuração local quando não foi solicitada',()=>{
 assert.deepEqual(createLocalAIEnvironment(undefined),{});
 assert.deepEqual(createLocalAIEnvironment(null),{});
});

test('recusa caminho relativo, caminho vazio ou chave fraca para IA local',()=>{
 for(const input of [
  {configPath:'relative/opencode.json',apiKey:'a'.repeat(48)},
  {configPath:'',apiKey:'a'.repeat(48)},
  {configPath:'C:\\W1\\opencode.json',apiKey:'short'},
  {configPath:'C:\\W1\\opencode.json',apiKey:'a'.repeat(200)},
  {configPath:'C:\\W1\\opencode.json',apiKey:'bad\\nkey'.repeat(8)}
 ]) assert.throws(()=>createLocalAIEnvironment(input));
});
