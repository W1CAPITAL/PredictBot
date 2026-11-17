import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join,isAbsolute,resolve,win32} from 'node:path';

export function validateEndpoint(value){
 const url=new URL(value);
 const local=['127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(local&&url.protocol==='http:')))
  throw Error('Use uma URL HTTPS sem credenciais ou HTTP no endereço 127.0.0.1.');
 return url;
}
export function validateMcpConfig(config,allowLocal=false){
 if(!config||!['local','remote'].includes(config.type))throw Error('Tipo MCP inválido.');
 const allowed=new Set(['type','command','cwd','environment','url','headers','oauth','disabled','timeout']);
 if(Object.keys(config).some(k=>!allowed.has(k)))throw Error('Campo MCP não autorizado.');
 if(config.type==='local'){
  if(!allowLocal)throw Error('Comandos MCP locais exigem aprovação no aplicativo local.');
  if(!Array.isArray(config.command)||!config.command.length||config.command.length>30||config.command.some(v=>typeof v!=='string'||!v||v.length>2048||v.includes('\0')))throw Error('Comando MCP inválido.');
 }else{
  const url=new URL(config.url);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('MCP remoto exige HTTPS sem credenciais na URL.');
 }
 if(config.disabled!==undefined&&typeof config.disabled!=='boolean')throw Error('disabled deve ser booleano.');
 // Secrets belong to the OpenCode process environment, never JSONC or tool arguments.
 for(const [key,value] of Object.entries({...config.headers,...config.environment})){
  if(typeof value!=='string'||value.length>2048||/[\r\n\0]/.test(value))throw Error('Variável MCP inválida.');
  if(!/^(?:Bearer |Basic )?\{env:[A-Z][A-Z0-9_]*\}$/.test(value))throw Error('Use referências {env:NOME} para cabeçalhos e variáveis.');
  if(!/^[A-Za-z0-9_-]+$/.test(key))throw Error('Nome de variável inválido.');
 }
 if(config.oauth!==undefined&&config.oauth!==false)throw Error('OAuth é automático; configure o login no OpenCode.');
 return structuredClone(config);
}
const V1={health:['get','/global/health'],providers:['get','/provider'],projects:['get','/project'],create:['post','/session'],get:['get','/session/{id}'],messages:['get','/session/{id}/message'],diff:['get','/session/{id}/diff'],prompt:['post','/session/{id}/prompt_async'],abort:['post','/session/{id}/abort'],mcp:['get','/mcp'],events:['get','/event']};
const V2={events:'event.subscribe',health:'server.info',models:'model.list',providers:'provider.list',projects:'project.list',create:'session.create',get:'session.get',messages:'session.message.list',diff:'session.diff',prompt:'session.prompt',abort:'session.interrupt',mcp:'mcp.list',mcpAdd:'experimental.mcp.add',mcpRemove:'experimental.mcp.remove',mcpConnect:'experimental.mcp.connect',mcpDisconnect:'experimental.mcp.disconnect'};
export class OpenCodeAdapter {
 #url;#password;#fetch;#principal;#directory;#ledger;#sessions=new Set();#routes;#version;#save=Promise.resolve();#audit;#connecting;
 constructor({url,password,directory,principal,stateDirectory,serverIdentity,fetch:fetchFn=globalThis.fetch,audit=()=>{}}){
  this.#url=validateEndpoint(url);if(typeof password!=='string'||!password)throw Error('Informe a senha do servidor OpenCode.');
  if(!directory||!(isAbsolute(directory)||win32.isAbsolute(directory)))throw Error('Informe uma pasta de projeto absoluta.');
  if(!principal?.userId||!principal?.companyId)throw Error('Usuário e empresa são obrigatórios.');
  this.#principal=Object.freeze({...principal});this.#directory=isAbsolute(directory)?resolve(directory):win32.normalize(directory);this.#password=password;this.#fetch=fetchFn;this.#audit=audit;
  if(stateDirectory){const key=createHash('sha256').update(JSON.stringify([serverIdentity||this.#url.href,this.#directory,principal.userId,principal.companyId])).digest('hex');this.#ledger=join(stateDirectory,key+'.json');}
 }
 async #json(path,{method='GET',body,timeout=20000}={}){
  const started=Date.now();
  const target=new URL(path,this.#url);if(target.origin!==this.#url.origin)throw Error('Contrato OpenCode tentou trocar a origem.');
  const response=await this.#fetch(target,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeout),headers:{Authorization:'Basic '+Buffer.from('opencode:'+this.#password).toString('base64'),Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  this.#audit({type:'opencode.http',method,status:response.status,durationMs:Date.now()-started,userId:this.#principal.userId,companyId:this.#principal.companyId});
  if(!response.ok){await response.body?.cancel();throw Error('OpenCode respondeu HTTP '+response.status+'.');}
  if(response.status===204)return {accepted:true};
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw Error('Resposta OpenCode excede 8 MB.');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 async #connect(){
  if(this.#routes)return;
  if(this.#connecting)return this.#connecting;
  this.#connecting=this.#loadContract().finally(()=>{this.#connecting=null});return this.#connecting;
 }
 async #loadContract(){
  let spec;try{spec=await this.#json('/doc');}catch(error){if(!(error instanceof SyntaxError))throw error;spec=await this.#json('/openapi.json');}
  if(!spec?.openapi||!spec.paths)throw Error('OpenCode não publicou um contrato OpenAPI válido.');
  const routes={};
  for(const [path,methods] of Object.entries(spec.paths))for(const [method,op] of Object.entries(methods)){
   if(!['get','post','put','patch','delete'].includes(method)||!op?.operationId)continue;
   const key=Object.keys(V2).find(k=>V2[k]===op.operationId);if(key)routes[key]=[method,path];
  }
  if(!routes.health){for(const [key,[method,path]] of Object.entries(V1)){if(spec.paths[path]?.[method])routes[key]=[method,path];}
   // V1 templates use :id or {sessionID}, depending on the released spec.
   for(const [key,[method,path]] of Object.entries(V1)){if(routes[key])continue;const match=Object.keys(spec.paths).find(p=>p.replace(/\{[^}]+\}/g,'{id}')===path&&spec.paths[p]?.[method]);if(match)routes[key]=[method,match];}
  }
  if(!routes.health)throw Error('Versão OpenCode não suportada pelo contrato instalado.');
  const info=await this.#json(routes.health[1]);
  if(info?.healthy===false)throw Error('OpenCode informou serviço indisponível.');
  if(!/^[12]\./.test(info?.version||''))throw Error('Versão OpenCode não suportada.');
  this.#version=info.version;
  if(this.#ledger){try{const data=JSON.parse(await readFile(this.#ledger,'utf8'));this.#sessions=new Set(data.sessions);}catch(e){if(e.code!=='ENOENT')throw Error('Registro de sessões inválido.');}}
  this.#routes=routes;
 }
 async #call(key,{id,name,body,scoped=false}={}){
  await this.#connect();const route=this.#routes[key];if(!route)throw Error('Operação '+key+' não disponível nesta versão do OpenCode.');
  let path=route[1].replace(/\{(?:id|sessionID)\}/g,()=>encodeURIComponent(id)).replace(/\{server\}/g,()=>encodeURIComponent(name));
  const url=new URL(path,this.#url);
  if(scoped)url.searchParams.set(this.#version.startsWith('2.')?'location[directory]':'directory',this.#directory);
  return this.#json(url.pathname+url.search,{method:route[0].toUpperCase(),body});
 }
 async #own(id){
  if(typeof id!=='string'||!/^ses[a-zA-Z0-9_-]{1,180}$/.test(id))throw Error('Sessão não autorizada.');
  // Load only this principal's ledger, never trust IDs supplied by a model.
  if(!this.#sessions.has(id)&&this.#ledger)await this.#connect();
  if(!this.#sessions.has(id))throw Error('Sessão não autorizada para este usuário e empresa.');
 }
 async health(){await this.#connect();const info=await this.#call('health');if(info?.healthy===false||typeof info?.version!=='string')throw Error('OpenCode informou serviço indisponível.');return {healthy:true,version:info.version,api:this.#version.startsWith('2.')?'v2':'v1',capabilities:Object.keys(this.#routes)};}
 async listProviders(){return this.#call('providers',{scoped:true});}
 async listModels(){return this.#call('models',{scoped:true});}
 listProjects(){return Promise.resolve([{directory:this.#directory}]);}
 async listSessions(){await this.#connect();return [...this.#sessions].map(id=>({id}));}
 async createSession({title='W1 Capital',mode='restricted'}={}){
  if(!['restricted','review'].includes(mode))throw Error('Modo de execução inválido.');
  if(typeof title!=='string'||title.length>200)throw Error('Título inválido.');
  await this.#connect();
  // Restricted means all tool use denied; review asks via native OpenCode approval.
  const effect=mode==='review'?'ask':'deny';
  const body=this.#version.startsWith('2.')?{title,location:{directory:this.#directory},permissions:[{action:'*',resource:'*',effect}]}:{title,permission:[{permission:'*',pattern:'*',action:effect}]};
  const response=await this.#call('create',{body});const session=response?.data||response;
  if(!session?.id||!/^ses[a-zA-Z0-9_-]+$/.test(session.id))throw Error('OpenCode retornou uma sessão inválida.');
  this.#sessions.add(session.id);
  if(this.#ledger){const path=this.#ledger;this.#save=this.#save.then(async()=>{await mkdir(join(path,'..'),{recursive:true,mode:0o700});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({sessions:[...this.#sessions]}),{mode:0o600});await rename(temp,path);});await this.#save;}
  return session;
 }
 async getSession(id){await this.#own(id);const response=await this.#call('get',{id});return response?.data||response;}
 async getMessages(id){await this.#own(id);return this.#call('messages',{id});}
 async getDiff(id){await this.#own(id);return this.#call('diff',{id});}
 async abortSession(id){await this.#own(id);return this.#call('abort',{id});}
 async sendPrompt(id,text){await this.#own(id);if(typeof text!=='string'||!text.trim()||text.length>32000)throw Error('Prompt deve ter entre 1 e 32.000 caracteres.');await this.#connect();return this.#call('prompt',{id,body:this.#version.startsWith('2.')?{text}:{parts:[{type:'text',text}]}});}
 async *streamEvents(id,{signal}={}){
  await this.#own(id);await this.#connect();const route=this.#routes.events;
  if(!route)throw Error('Operação events não disponível nesta versão do OpenCode.');
  const url=new URL(route[1],this.#url);if(url.origin!==this.#url.origin)throw Error('Origem OpenCode inválida.');
  const response=await this.#fetch(url,{redirect:'error',signal:signal||AbortSignal.timeout(30*60*1000),headers:{Authorization:'Basic '+Buffer.from('opencode:'+this.#password).toString('base64'),Accept:'text/event-stream'}});
  if(!response.ok){await response.body?.cancel();throw Error('OpenCode respondeu HTTP '+response.status+'.');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>1048576)throw Error('Evento OpenCode muito grande.');
   let boundary;while((boundary=buffer.search(/\r?\n\r?\n/))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary).replace(/^\r?\n\r?\n/,'');
    const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;
    let event;try{event=JSON.parse(data);}catch{continue;}
    const eventSession=event?.data?.sessionID||event?.properties?.sessionID||event?.properties?.info?.sessionID;
    if(eventSession===id)yield event;
   }
  }}finally{await reader.cancel();}
 }
 async listMcpServers(){return this.#call('mcp',{scoped:true});}
 async configureMcp(name,config,{allowLocal=false}={}){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw Error('Nome MCP inválido.');const checked=validateMcpConfig(config,allowLocal);await this.#connect();if(!this.#version.startsWith('2.'))throw Error('Gerenciamento MCP requer OpenCode V2.');return this.#call('mcpAdd',{name,body:{config:checked},scoped:true});}
 async manageMcp(name,action){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name)||!['mcpConnect','mcpDisconnect','mcpRemove'].includes(action))throw Error('Ação MCP inválida.');return this.#call(action,{name,scoped:true});}
}
