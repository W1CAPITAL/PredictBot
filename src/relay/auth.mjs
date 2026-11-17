import {digest,fail} from './protocol.mjs';
export async function authorize(request,env,{oauth=false,fetch:fetchFn=globalThis.fetch}={}){
 const header=request.headers.get('authorization')||'';if(!/^Bearer [A-Za-z0-9_.-]{20,12000}$/.test(header))fail('Entre na sua conta para continuar.',401);
 const token=header.slice(7),base=new URL(env.SUPABASE_URL);
 if(base.protocol!=='https:'||base.pathname!=='/')fail('Autenticação indisponível.',503);
 const read=async(path,body)=>{const res=await fetchFn(new URL(path,base),{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{authorization:header,apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!res.ok)fail('Não foi possível validar sua permissão.',res.status===401?401:403);return res.json();};
 const user=await read('/auth/v1/user');if(!user?.id||user.is_anonymous)fail('Usuário inválido.',401);
 let claims;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('Token inválido.',401);}
 if(claims.sub!==user.id||claims.iss!==base.origin+'/auth/v1'||typeof claims.exp!=='number'||claims.exp<=Date.now()/1000||!(claims.aud==='authenticated'||Array.isArray(claims.aud)&&claims.aud.includes('authenticated')))fail('Token inválido.',401);
 const members=await read('/rest/v1/usuarios?select=empresa_id&auth_user_id=eq.'+encodeURIComponent(user.id)+'&limit=2');
 if(!Array.isArray(members)||members.length!==1||!members[0].empresa_id)fail('Empresa não identificada.');
 const companyId=members[0].empresa_id;
 const rows=await read('/rest/v1/office_agent_company_policies?select=config&empresa_id=eq.'+encodeURIComponent(companyId)+'&limit=1');
 const policy=rows?.[0]?.config;
 if(!policy||policy.mcp_enabled!==true)fail('Ative o MCP nas regras da empresa.');
 if(oauth||claims.client_id){
  if(!claims.client_id||!Array.isArray(policy.mcp_allowed_client_ids)||!policy.mcp_allowed_client_ids.includes(claims.client_id))fail('Aplicativo OAuth não autorizado pela empresa.');
  if(await read('/rest/v1/rpc/killa_check_mcp_mfa_grant',{p_client_id:claims.client_id})!==true)fail('Confirme o segundo fator no aplicativo autorizado.');
 }else if(claims.aal!=='aal2')fail('Confirme o segundo fator para parear dispositivos.');
 const principal={userId:user.id,companyId};return {principal,channel:await digest(JSON.stringify([companyId,user.id])),clientId:claims.client_id||null};
}
