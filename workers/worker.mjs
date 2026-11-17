import {OpenCodeRelay} from './relay-object.mjs';
import {authorize} from '../src/relay/auth.mjs';
import {fail,tokenMatches} from '../src/relay/protocol.mjs';
import {serveMcp} from './remote-mcp.mjs';
import page from '../web/connect.html';
import style from '../web/connect.css';
import client from '../dist/connect.txt';
export {OpenCodeRelay};
const encoder=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const b64=value=>btoa(String.fromCharCode(...encoder.encode(JSON.stringify(value)))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
async function hmac(text,key){const imported=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',imported,encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function seal(value,env){const payload=b64(value);return payload+'.'+await hmac(payload,env.RELAY_SIGNING_KEY);}
async function unseal(value,kind,env){
 if(typeof value!=='string'||value.length>2000)fail('Credencial inválida.',401);const [encoded,signature,...extra]=value.split('.');
 if(extra.length||!signature||!tokenMatches(await hmac(encoded,env.RELAY_SIGNING_KEY),signature))fail('Credencial inválida.',401);
 let data;try{data=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('Credencial inválida.',401);}
 if(data.kind!==kind||data.exp<Date.now()||!/^([a-f0-9]{64})$/.test(data.channel))fail('Credencial expirada.',401);return data;
}
async function input(request){
 if(!request.headers.get('content-type')?.includes('application/json'))fail('JSON obrigatório.',415);
 const reader=request.body?.getReader();if(!reader)fail('Corpo ausente.',400);let bytes=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)fail('Solicitação muito grande.',413);chunks.push(value);}}finally{await reader.cancel();}
 const buffer=new Uint8Array(bytes);let at=0;for(const chunk of chunks){buffer.set(chunk,at);at+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(buffer));}catch{fail('JSON inválido.',400);}
}
const staticHeaders=env=>({'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' "+new URL(env.SUPABASE_URL).origin+"; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
async function handle(request,env,ctx){
 const url=new URL(request.url),origin=request.headers.get('origin');
 const allowed=[url.origin,...(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)];
 const resource=url.origin+'/mcp',metadata=url.origin+'/.well-known/oauth-protected-resource/mcp';
 try{
  if(env.PUBLIC_ORIGIN&&url.origin!==env.PUBLIC_ORIGIN)fail('Origem inválida.');
  if(origin&&!allowed.includes(origin))fail('Origem não autorizada.');
  if(url.pathname==='/health'&&request.method==='GET')return json({service:'w1-opencode-relay',version:'0.2.0',configured:!!(env.RELAY&&env.RELAY_SIGNING_KEY&&env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY),modelInference:false});
  if(url.pathname==='/.well-known/oauth-protected-resource'||url.pathname==='/.well-known/oauth-protected-resource/mcp')return json({resource,authorization_servers:[env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1'],bearer_methods_supported:['header'],resource_name:'W1 Capital · OpenCode'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type,mcp-protocol-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'}:{}});
  if(request.method==='GET'&&['/','/connect','/connect.js','/connect.css','/public-config'].includes(url.pathname)){
   const headers=staticHeaders(env);
   if(url.pathname==='/public-config')return json({url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY});
   const text=url.pathname==='/connect.js'?client:url.pathname==='/connect.css'?style:page;
   return new Response(text,{headers:{...headers,'Content-Type':url.pathname==='/connect.js'?'application/javascript':url.pathname==='/connect.css'?'text/css':'text/html;charset=utf-8'}});
  }
  if(!env.RELAY_SIGNING_KEY||!env.RELAY||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)fail('Serviço não configurado.',503);
  const path=url.pathname;
  if(path==='/v1/claim'){
   if(request.method!=='POST')fail('Método inválido.',405);const body=await input(request),pair=await unseal(body.pairingCode,'pair',env);
   const stub=scope(env,pair.channel);const result=await stub.device('claim',{ticket:pair.ticket,name:body.name});
   const credential=await seal({kind:'device',channel:pair.channel,deviceId:result.deviceId,deviceToken:result.deviceToken,exp:Date.now()+86400000},env);
   return json({deviceId:result.deviceId,confirmation:result.confirmation,principal:result.principal,credential,expiresAt:Date.now()+86400000});
  }
  if(path==='/v1/device/poll'||path==='/v1/device/complete'){
   if(request.method!=='POST')fail('Método inválido.',405);const auth=request.headers.get('authorization')||'';const device=await unseal(auth.startsWith('Bearer ')?auth.slice(7):'', 'device',env);
   const body=await input(request);return json(await scope(env,device.channel).device(path.endsWith('/poll')?'poll':'complete',{...body,deviceId:device.deviceId,deviceToken:device.deviceToken}));
  }
  if(path==='/mcp'){
   const identity=await authorize(request,env,{oauth:true});return await serveMcp(request,scope(env,identity.channel),identity.principal,ctx);
  }
  if(path.startsWith('/v1/')){
   const identity=await authorize(request,env),stub=scope(env,identity.channel);
   if(request.method==='GET'&&path==='/v1/devices')return json(await stub.owner('devices',{},identity.principal));
   if(request.method!=='POST')fail('Método inválido.',405);const body=await input(request);
   if(path==='/v1/pair'){
    const pair=await stub.owner('pair',{scopes:body.scopes},identity.principal);return json({pairingCode:await seal({kind:'pair',channel:identity.channel,ticket:pair.ticket,exp:pair.expiresAt},env),expiresAt:pair.expiresAt,principal:identity.principal});
   }
   const action={'/v1/approve':'approve','/v1/revoke':'revoke','/v1/jobs':'submit','/v1/task':'task'}[path];
   if(!action)fail('Rota não encontrada.',404);return json(await stub.owner(action,body,identity.principal));
  }
  return json({error:'Rota não encontrada.'},404);
 }catch(error){
  const status=error.status|| (error.name==='ZodError'?400:503);
  const response=json({error:status===401?'Entre na sua conta para continuar.':status===403?'Acesso não autorizado.':status===400?'Solicitação inválida.':status===429?'Limite temporário atingido.':'Operação indisponível.'},status);
  if(status===401)response.headers.set('WWW-Authenticate',`Bearer resource_metadata="${metadata}"`);return response;
 }
 };
function scope(env,channel){const stub=env.RELAY.getByName(channel);const unwrap=result=>{if(!result?.ok)fail('Operação não autorizada ou indisponível.',result?.status||503);return result.value;};return {owner:async(...args)=>unwrap(await stub.owner(...args)),device:async(...args)=>unwrap(await stub.device(...args))};}
export default {async fetch(request,env,ctx){const response=await handle(request,env,ctx);const origin=request.headers.get('origin');if(origin&&[new URL(request.url).origin,...(env.ALLOWED_ORIGINS||'').split(',')].includes(origin)){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');}return response;}};
