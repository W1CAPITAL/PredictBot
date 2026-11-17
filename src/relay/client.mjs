import {validateEndpoint} from '../opencode-adapter.mjs';
import {validateOperation} from './protocol.mjs';
export class OpenCodeRelayClient{
 #url;#credential;#adapter;#approve;#onState;#timer;#active=false;#inFlight=false;#delay=5000;#seen=new Map();#pending=[];#fetch;#generation=0;
 constructor({url,approve=async()=>false,onState=()=>{},fetch:fetchFn=globalThis.fetch}){
  this.#url=validateEndpoint(url);if(this.#url.protocol!=='https:')throw Error('A ponte remota exige HTTPS.');this.#approve=approve;this.#onState=onState;this.#fetch=fetchFn;
 }
 async #request(path,body,{authenticated=true}={}){
  const response=await this.#fetch(new URL(path,this.#url),{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+this.#credential}:{})},body:JSON.stringify(body)});
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Ponte OpenCode respondeu HTTP '+response.status+'.'),{status:response.status});}return response.json();
 }
 async pair({pairingCode,name,adapter}){
  this.stop();const generation=this.#generation;const result=await this.#request('/v1/claim',{pairingCode,name},{authenticated:false});
  if(generation!==this.#generation)throw Error('Pareamento interrompido.');
  if(!result?.principal?.userId||!result?.principal?.companyId||!result.credential)throw Error('Pareamento retornou identidade inválida.');
  this.#adapter=adapter.forPrincipal(result.principal);this.#credential=result.credential;this.#active=true;
  const publicState={deviceId:result.deviceId,confirmation:result.confirmation,principal:result.principal,state:'pending'};this.#onState(publicState);this.#schedule(0);return publicState;
 }
 #schedule(delay=this.#delay){if(!this.#active)return;clearTimeout(this.#timer);this.#timer=setTimeout(()=>void this.tick().finally(()=>this.#schedule()),delay);this.#timer.unref?.();}
 async tick(){
  if(!this.#active||this.#inFlight)return;this.#inFlight=true;const generation=this.#generation;
  try{
   for(const receipt of [...this.#pending]){try{await this.#request('/v1/device/complete',receipt);}catch(error){if(![404,409].includes(error.status))throw error;}if(generation!==this.#generation)return;this.#pending.shift();}
   if(generation!==this.#generation||!this.#active)return;
   const response=await this.#request('/v1/device/poll',{});if(!this.#active||generation!==this.#generation)return;this.#delay=5000;this.#onState({state:response.state,connected:true});
   const job=response.job;if(!job)return;const checked=validateOperation(job.operation,job.input);
   if(this.#seen.has(job.id)){this.#pending.push({...this.#seen.get(job.id),lease:job.lease});return;}
   if(job.expiresAt<Date.now())return;
   const receipt={jobId:job.id,lease:job.lease,status:'unknown',result:{error:'Resultado não confirmado.'}};
   this.#seen.set(job.id,receipt);
   try{
    if(checked.scope==='execute'&&await this.#approve(structuredClone({...job,input:checked.input}))!==true)throw Error('Operação recusada no computador.');
    if(!this.#active||generation!==this.#generation)throw Error('Ponte encerrada antes da execução.');
    this.#onState({state:'executing',operation:checked.operation,jobId:job.id});
    receipt.result=await this.#execute(checked.operation,checked.input);receipt.status='succeeded';
    if(JSON.stringify(receipt.result).length>240000){receipt.status='failed';receipt.result={error:'Resultado maior que o limite da ponte. Consulte o OpenCode local.'};}
   }catch(error){receipt.status=error?.name==='TimeoutError'||error?.name==='TypeError'?'unknown':'failed';receipt.result={error:receipt.status==='unknown'?'O resultado da chamada não foi confirmado. Não repita automaticamente.':'A operação falhou ou foi recusada no computador.'};}
   if(generation!==this.#generation)return;
   if(this.#seen.size>500)this.#seen.delete(this.#seen.keys().next().value);
   this.#pending.push(receipt);await this.#request('/v1/device/complete',receipt);if(generation!==this.#generation)return;this.#pending.shift();this.#onState({state:'approved',lastOperation:checked.operation,lastStatus:receipt.status});
  }catch(error){if(generation!==this.#generation)return;this.#delay=Math.min(30000,this.#delay*2);this.#onState({state:'unavailable',message:error.status?'Ponte indisponível (HTTP '+error.status+').':'Falha de rede. A ponte tentará reconectar.'});if([401,403].includes(error.status))this.stop();}
  finally{this.#inFlight=false;}
 }
 async #execute(action,input){const a=this.#adapter;switch(action){case 'health':return a.health();case 'version':return {version:(await a.health()).version};case 'providers':return a.listProviders();case 'models':return a.listModels();case 'projects':return a.listProjects();case 'sessions':return a.listSessions();case 'get':return a.getSession(input.sessionId);case 'messages':return a.getMessages(input.sessionId);case 'diff':return a.getDiff(input.sessionId);case 'mcp':return a.listMcpServers();case 'create':return a.createSession({...input,mode:'review'});case 'prompt':return a.sendPrompt(input.sessionId,input.text);case 'abort':return a.abortSession(input.sessionId);default:throw Error('Operação não autorizada.');}}
 stop(){this.#generation++;this.#active=false;this.#credential=undefined;this.#adapter=undefined;this.#pending=[];this.#seen.clear();clearTimeout(this.#timer);this.#onState({state:'stopped'});}
}
