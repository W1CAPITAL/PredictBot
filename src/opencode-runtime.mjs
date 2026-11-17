import {access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute,delimiter} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {OpenCodeAdapter} from './opencode-adapter.mjs';
const exec=promisify(execFile);
export async function detectOpenCode({executable,path=process.env.PATH||'',platform=process.platform}={}){
 const name=platform==='win32'?'opencode.exe':'opencode';
 const candidates=executable?[executable]:path.split(delimiter).filter(p=>isAbsolute(p)).map(p=>join(p,name));
 for(const candidate of candidates){
  if(!isAbsolute(candidate)||candidate.includes('\0')||(platform==='win32'&&!/\.exe$/i.test(candidate)))continue;
  try{await access(candidate,constants.X_OK);const binary=await realpath(candidate);
   const {stdout}=await exec(binary,['--version'],{shell:false,windowsHide:true,timeout:5000,maxBuffer:8192});
   const version=stdout.trim().replace(/^opencode v?/,'').replace(/^v/,'');if(!/^[12]\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))continue;
   return {installed:true,executable:binary,version};
  }catch{}
 }
 return {installed:false,message:'OpenCode não encontrado. Selecione o executável instalado.'};
}
async function freePort(){const server=createServer();await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
export class OpenCodeRuntime {
 #child;#record;#starting;
 async start({executable,directory,principal,stateDirectory}={}){
  if(this.#starting)return this.#starting;
  if(this.#record){await this.#record.adapter.health();return this.#record;}
  this.#starting=this.#start({executable,directory,principal,stateDirectory}).finally(()=>{this.#starting=null});return this.#starting;
 }
 async #start({executable,directory,principal,stateDirectory}){
  const found=await detectOpenCode({executable});if(!found.installed)throw Error(found.message);
  const port=await freePort(),password=randomBytes(32).toString('base64url');
  const env={...process.env,OPENCODE_PASSWORD:password,OPENCODE_SERVER_PASSWORD:password};
  for(const name of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','OPENCODE_SERVER_USERNAME'])delete env[name];
  const child=spawn(found.executable,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  this.#child=child;let failure;
  child.once('error',()=>{failure=Error('O executável OpenCode não pôde iniciar.');});
  // Drain output; OpenCode can print its password. Never forward it to logs/UI.
  child.stdout.resume();child.stderr.resume();
  const adapter=new OpenCodeAdapter({url:'http://127.0.0.1:'+port,password,directory,principal,stateDirectory});
  try{
   for(let i=0;i<60;i++){
    if(failure)throw failure;if(child.exitCode!==null||child.signalCode!==null)throw Error('OpenCode encerrou durante a inicialização.');
    try{await adapter.health();this.#record={adapter,url:'http://127.0.0.1:'+port,version:found.version,owned:true};return this.#record;}catch{}
    await delay(250);
   }
   throw Error('OpenCode não respondeu em /doc com autenticação.');
  }catch(e){this.stop();throw e;}
 }
 stop(){if(this.#child&&this.#child.exitCode===null&&this.#child.signalCode===null)this.#child.kill();this.#child=null;this.#record=null;}
}
