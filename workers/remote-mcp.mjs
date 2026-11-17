import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {OPERATIONS} from '../src/relay/protocol.mjs';
export async function serveMcp(request,stub,principal,ctx){
 const server=new McpServer({name:'w1-opencode-remote',version:'0.2.0'});
 server.registerTool('opencode_list_devices',{description:'Lista apenas seus dispositivos pareados e o estado real da ponte.'},async()=>({content:[{type:'text',text:JSON.stringify(await stub.owner('devices',{},principal))}]}));
 server.registerTool('opencode_get_task',{description:'Consulta resultado ou falha de uma operação OpenCode previamente enfileirada. succeeded significa resposta da API, não conclusão da tarefa pelo modelo.',inputSchema:{jobId:z.string().min(8).max(180)}},async x=>{try{return {content:[{type:'text',text:JSON.stringify(await stub.owner('task',x,principal))}]};}catch{return {isError:true,content:[{type:'text',text:'Tarefa indisponível para esta identidade.'}]};}});
 const names={health:'health',version:'version',providers:'list_providers',models:'list_models',projects:'list_projects',sessions:'list_sessions',get:'get_session',messages:'get_messages',diff:'get_diff',mcp:'list_mcp_servers',create:'create_session',prompt:'send_prompt',abort:'abort_session'};
 for(const [operation,definition]of Object.entries(OPERATIONS)){
  server.registerTool('opencode_'+names[operation],{description:'Enfileira operação '+operation+' no seu OpenCode. Consulte opencode_get_task pelo ID retornado. Escritas exigem permissão e confirmação local.',inputSchema:{deviceId:z.string().uuid(),requestId:z.string().uuid(),...definition.schema.shape},annotations:{readOnlyHint:definition.scope==='read',destructiveHint:definition.scope!=='read',openWorldHint:true}},async({deviceId,requestId,...input})=>{
   try{return {content:[{type:'text',text:JSON.stringify(await stub.owner('submit',{deviceId,operation,input,key:requestId},principal))}]};}
   catch{return {isError:true,content:[{type:'text',text:'Operação não enfileirada. Confira dispositivo, permissão e chave de tarefa.'}]};}
  });
 }
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:65536});await server.connect(transport);
 const response=await transport.handleRequest(request);ctx.waitUntil(server.close());return response;
}
