# PredictBot · integração OpenCode

Módulo independente da W1 Capital para conectar um OpenCode instalado ou um servidor próprio autenticado. A interface de agentes do INFINITUM ainda não foi migrada para este repositório.

## O que funciona neste lote

- Adaptador HTTP V1/V2 orientado ao contrato da versão instalada.
- Detecção do binário, versão e inicialização em loopback com senha aleatória.
- Sessões separadas por usuário, empresa, projeto e servidor, recuperáveis após reiniciar.
- Prompts, mensagens, diff e cancelamento; nenhuma repetição automática de escrita.
- SSE filtrado pela sessão autorizada; a Central de Apps usa consulta periódica de mensagens reais.
- Ponte MCP STDIO com schemas, escopos `read`, `execute`, `manage` e auditoria sem conteúdo ou credenciais.
- Gerenciamento MCP V2 com referências de ambiente para segredos.

## Instalar e verificar

Requer Node 22+ e OpenCode instalado separadamente. O OpenCode utiliza seus próprios provedores de IA: esta ponte não oferece créditos ou inferência ilimitada.

```sh
npm ci
npm run check
npm test
```

Para testar contra seu binário, defina `W1_OPENCODE_EXECUTABLE` e execute `npm run test:live`. O smoke cria uma sessão sintética e consulta APIs, sem enviar prompt a modelo nem alterar um projeto real.

## Configurar um cliente MCP local

Configure o cliente para iniciar `node` com o caminho absoluto de `src/cli.mjs` como argumento. Defina no ambiente do processo:

| Variável | Uso |
| --- | --- |
| `W1_OPENCODE_URL` | URL do servidor próprio; padrão `http://127.0.0.1:4096` |
| `OPENCODE_PASSWORD` | Senha do servidor, obtida no ambiente; não gravar no JSON do projeto |
| `W1_OPENCODE_DIRECTORY` | Pasta absoluta do projeto autorizado |
| `W1_USER_ID` | Identificador fixo do operador local |
| `W1_COMPANY_ID` | Identificador fixo da empresa local |
| `W1_OPENCODE_SCOPES` | `read` por padrão; `read,execute` permite criar sessões e enviar prompts |
| `W1_OPENCODE_STATE_DIRECTORY` | Diretório privado opcional dos registros de sessões |

O processo STDIO pertence à conta do sistema operacional. Esses identificadores separam os registros locais e **não substituem autenticação Supabase ou RLS**. Não publique este CLI como endpoint de internet. Um servidor OpenCode remoto deve ser próprio, HTTPS, autenticado e dedicado à fronteira de confiança autorizada.

Sessões criadas pelo MCP bloqueiam ferramentas por padrão. A Central permite criar sessões com aprovação nativa do OpenCode; aprovações pendentes devem ser respondidas no próprio OpenCode. A ponte não oferece ferramenta de shell nem aprovação automática.

`opencode_configure_mcp` aceita somente nomes de servidores aprovados previamente pelo host ao chamar `createOpenCodeMcpServer({approvedServers, scopes})`. O CLI não carrega comandos de arquivos não confiáveis e não concede `manage` por padrão. Use a Central para aprovar configurações locais.

## Ferramentas MCP

`opencode_health`, `opencode_version`, `opencode_list_providers`, `opencode_list_models`, `opencode_list_projects`, `opencode_list_sessions`, `opencode_get_session`, `opencode_get_messages`, `opencode_get_diff`, `opencode_list_mcp_servers`, `opencode_create_session`, `opencode_send_prompt`, `opencode_abort_session`, `opencode_configure_mcp`.

As dez ferramentas de leitura são o padrão. As demais exigem o respectivo escopo. Um recurso ausente na API instalada retorna erro explícito. O gerenciamento MCP deste lote requer V2; não grava formatos V1 na configuração V2.

## Limites atuais

Ainda não estão implementados: transporte MCP HTTP público/OAuth, pareamento com PredictBot na nuvem, fila remota, interface Hermes 3D, migração dos chats e integração autorizada com PredictLM. A API OpenCode não é uma API pública de inferência gratuita.

O timeout de transporte não prova cancelamento do trabalho no servidor. Consulte a sessão e use `opencode_abort_session` se necessário. Não repita automaticamente um prompt cujo aceite ficou incerto.

Veja [a auditoria e o plano](docs/auditoria-integracao.md).
