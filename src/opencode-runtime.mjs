import {access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute,delimiter,win32} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {OpenCodeAdapter} from './opencode-adapter.mjs';
const exec=promisify(execFile);
function desktopCliPaths(directory) {
 return ['', 'resources', 'bin', join('resources', 'bin')].map(folder => join(directory, folder, 'opencode-cli.exe'));
}
function windowsCliPaths(env) {
 const candidates = [];
 const add = (base, ...parts) => {
  if (base && isAbsolute(base)) candidates.push(join(base, ...parts));
 };
 for (const folder of ['ai.opencode.desktop', '@opencodedesktop', '@opencode-aidesktop', 'OpenCode']) {
  if (env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA)) candidates.push(...desktopCliPaths(join(env.LOCALAPPDATA, 'Programs', folder)));
  if (env.ProgramFiles && isAbsolute(env.ProgramFiles)) candidates.push(...desktopCliPaths(join(env.ProgramFiles, folder)));
 }
 add(env.LOCALAPPDATA, 'OpenCode', 'opencode-cli.exe');
 add(env.USERPROFILE, '.opencode', 'bin', 'opencode.exe');
 add(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'opencode.exe');
 add(env.USERPROFILE, 'scoop', 'apps', 'opencode', 'current', 'opencode.exe');
 const arch = process.arch;
 for (const suffix of ['', '-baseline']) {
   add(env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'node_modules', 'opencode-windows-' + arch + suffix, 'bin', 'opencode.exe');
   add(env.APPDATA, 'npm', 'node_modules', 'opencode-windows-' + arch + suffix, 'bin', 'opencode.exe');
 }
 return candidates;
}
export function createLocalAIEnvironment(localAI){
 if(localAI===undefined||localAI===null)return {};
 if(!localAI||typeof localAI!=='object'||Array.isArray(localAI))throw Error('Configuração de IA local inválida.');
 const configPath=localAI.configPath,apiKey=localAI.apiKey;
 if(typeof configPath!=='string'||configPath.includes('\0')||!(isAbsolute(configPath)||win32.isAbsolute(configPath)))throw Error('Caminho da configuração de IA local deve ser absoluto.');
 if(typeof apiKey!=='string'||!/^[a-f0-9]{48,128}$/i.test(apiKey))throw Error('Chave da IA local inválida.');
 return {OPENCODE_CONFIG:configPath,W1_LOCAL_AI_KEY:apiKey};
}
export async function detectOpenCode({executable,path=process.env.PATH||'',platform=process.platform}={}){
 const name=platform==='win32'?'opencode.exe':'opencode';
 if (typeof executable === 'string') executable = executable.trim().replace(/^"(.*)"$/, '$1');
 const explicitDirectory = executable && platform === 'win32' && isAbsolute(executable) && !/\.exe$/i.test(executable);
 const candidates=executable?(explicitDirectory?desktopCliPaths(executable):[executable]):path.split(delimiter).filter(p=>isAbsolute(p)).map(p=>join(p,name));
 if(!executable && platform==='win32') candidates.unshift(...windowsCliPaths(process.env));
 let foundFile=false;
 for(const candidate of new Set(candidates)){
  if(!isAbsolute(candidate)||candidate.includes('\0')||(platform==='win32'&&!/\.exe$/i.test(candidate)))continue;
  try{await access(candidate,constants.X_OK);const binary=await realpath(candidate);foundFile=true;
   const {stdout}=await exec(binary,['--version'],{shell:false,windowsHide:true,timeout:5000,maxBuffer:8192});
   const version=stdout.trim().replace(/^opencode v?/,'').replace(/^v/,'');if(!/^[12]\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))continue;
   return {installed:true,executable:binary,version};
  }catch{}
 }
 return {installed:false,message:foundFile?'O executável foi encontrado, mas não respondeu com uma versão compatível. Selecione o arquivo da CLI do OpenCode.':'Não encontrei a CLI do OpenCode. Informe o caminho completo de opencode-cli.exe ou opencode.exe.'};
}
async function freePort(){const server=createServer();await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
export class OpenCodeRuntime {
 #child;#record;#starting;
 async start({executable,directory,principal,stateDirectory,localAI}={}){
  if(this.#starting)return this.#starting;
  if(this.#record){await this.#record.adapter.health();return this.#record;}
  this.#starting=this.#start({executable,directory,principal,stateDirectory,localAI}).finally(()=>{this.#starting=null});return this.#starting;
 }
 async #start({executable,directory,principal,stateDirectory,localAI}){
  const found=await detectOpenCode({executable});if(!found.installed)throw Error(found.message);
  const port=await freePort(),password=randomBytes(32).toString('base64url');
  const env={...process.env,...createLocalAIEnvironment(localAI),OPENCODE_PASSWORD:password,OPENCODE_SERVER_PASSWORD:password};
  for(const name of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','OPENCODE_SERVER_USERNAME'])delete env[name];
  const child=spawn(found.executable,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  this.#child=child;let failure;
  child.once('error',()=>{failure=Error('O executável OpenCode não pôde iniciar.');});
  // Drain output; OpenCode can print its password. Never forward it to logs/UI.
  child.stdout.resume();child.stderr.resume();
  const adapter=new OpenCodeAdapter({url:'http://127.0.0.1:'+port,password,directory,principal,stateDirectory,serverIdentity:'local:'+found.executable});
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
