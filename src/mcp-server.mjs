import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';

// Identity and scopes are supplied by the trusted local host, never tool input.
export function createOpenCodeMcpServer({adapter,scopes=['read'],approvedServers={},audit=()=>{}}){
 const allowed=new Set(scopes);const server=new McpServer({name:'w1-opencode',version:'0.1.0'});
 const id=z.string().regex(/^ses[a-zA-Z0-9_-]{1,180}$/);
 function tool(name,description,schema,scope,callback){
  if(!allowed.has(scope))return;
  server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:scope==='read',destructiveHint:scope!=='read',openWorldHint:true}},async input=>{
   const start=Date.now();try{const result=await callback(input);audit({tool:name,status:'succeeded',durationMs:Date.now()-start});return {content:[{type:'text',text:JSON.stringify(result)}]};}
   catch(error){audit({tool:name,status:'failed',durationMs:Date.now()-start});return {isError:true,content:[{type:'text',text:publicError(error)}]};}
  });
 }
 tool('opencode_health','Verifica a conexão autenticada e capacidades reais.',{},'read',()=>adapter.health());
 tool('opencode_version','Consulta a versão efetivamente conectada.',{},'read',async()=>({version:(await adapter.health()).version}));
 tool('opencode_list_providers','Lista provedores no projeto autorizado.',{},'read',()=>adapter.listProviders());
 tool('opencode_list_models','Lista modelos no projeto autorizado.',{},'read',()=>adapter.listModels());
 tool('opencode_list_projects','Mostra somente o projeto autorizado nesta ponte.',{},'read',()=>adapter.listProjects());
 tool('opencode_list_sessions','Lista sessões desta empresa e usuário.',{},'read',()=>adapter.listSessions());
 tool('opencode_get_session','Consulta uma sessão autorizada.',{sessionId:id},'read',x=>adapter.getSession(x.sessionId));
 tool('opencode_get_messages','Consulta mensagens reais de uma sessão autorizada.',{sessionId:id},'read',x=>adapter.getMessages(x.sessionId));
 tool('opencode_get_diff','Consulta alterações reais de uma sessão.',{sessionId:id},'read',x=>adapter.getDiff(x.sessionId));
 tool('opencode_list_mcp_servers','Consulta o estado real dos MCPs do projeto.',{},'read',()=>adapter.listMcpServers());
 tool('opencode_create_session','Cria sessão restrita, com ferramentas negadas por padrão.',{title:z.string().max(200).optional()},'execute',x=>adapter.createSession(x));
 tool('opencode_send_prompt','Envia tarefa uma única vez. O modelo pode consumir créditos configurados no OpenCode.',{sessionId:id,text:z.string().min(1).max(32000)},'execute',x=>adapter.sendPrompt(x.sessionId,x.text));
 tool('opencode_abort_session','Solicita interrupção de uma sessão autorizada.',{sessionId:id},'execute',x=>adapter.abortSession(x.sessionId));
 tool('opencode_configure_mcp','Registra somente MCP previamente aprovado pelo operador local.',{name:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)},'manage',x=>{if(!Object.hasOwn(approvedServers,x.name))throw Error('MCP não aprovado pelo operador local.');return adapter.configureMcp(x.name,approvedServers[x.name],{allowLocal:true});});
 return server;
}
export function publicError(error){const message=String(error?.message||'');return /^(?:OpenCode respondeu HTTP \d+\.|Sessão não autorizada|Operação \w+ não disponível|MCP não aprovado)/.test(message)?message:'A operação OpenCode falhou. Consulte o aplicativo local.';}
