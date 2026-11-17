#!/usr/bin/env node
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {OpenCodeAdapter} from './opencode-adapter.mjs';
import {createOpenCodeMcpServer} from './mcp-server.mjs';
import {join} from 'node:path';
import {homedir} from 'node:os';
try{
 const adapter=new OpenCodeAdapter({url:process.env.W1_OPENCODE_URL||'http://127.0.0.1:4096',password:process.env.OPENCODE_PASSWORD||process.env.OPENCODE_SERVER_PASSWORD,directory:process.env.W1_OPENCODE_DIRECTORY,principal:{userId:process.env.W1_USER_ID,companyId:process.env.W1_COMPANY_ID},audit:event=>process.stderr.write(JSON.stringify(event)+'\n'),stateDirectory:process.env.W1_OPENCODE_STATE_DIRECTORY||join(homedir(),'.w1-predictbot','sessions')});
 const scopes=(process.env.W1_OPENCODE_SCOPES||'read').split(',');
 // STDIO is bound to the OS account. Do not publish this transport as an HTTP endpoint.
 const server=createOpenCodeMcpServer({adapter,scopes,audit:event=>process.stderr.write(JSON.stringify(event)+'\n')});
 await server.connect(new StdioServerTransport());
}catch{process.stderr.write('Não foi possível iniciar a ponte MCP. Confira URL, senha, pasta, usuário e empresa.\n');process.exitCode=1;}
