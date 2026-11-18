# PredictBot

O PredictBot é o projeto da W1 Capital para reunir a experiência do OpenMausBot e do GrokBot, o OpenBot, a área de agentes do INFINITUM, o Hermes 3D e o PredictLM. A versão desktop atual oferece sessões, tarefas e a conexão OpenCode/MCP. A área de agentes, o Hermes e os módulos do PredictLM ainda estão no [INFINITUM](https://github.com/W1CAPITAL/Infinitum).

<!-- W1_DISTRIBUICAO_INICIO -->
## Instalar no Windows

Abra a [versão estável da Central de Apps](https://github.com/W1CAPITAL/Central-de-Apps/releases/latest) e baixe o arquivo `PredictBot-Setup-…-x64.exe` para usar o aplicativo independente. Para abrir pelo catálogo W1, baixe o instalador da Central na mesma página.

A partir da versão 0.1.129, **Configurar automaticamente** procura a CLI também na pasta `%LOCALAPPDATA%\Programs\ai.opencode.desktop`. Em instalações personalizadas, cole o caminho da pasta ou escolha o arquivo `opencode-cli.exe`. O PredictBot verifica a versão do executável antes da conexão.
<!-- W1_DISTRIBUICAO_FIM -->

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

A versão 0.2 acrescenta MCP HTTP, validação OAuth/MFA, pareamento e fila remota descritos abaixo. Interface Hermes 3D, migração dos chats e integração autorizada com PredictLM continuam com a frente de plataforma. A API OpenCode não é uma API pública de inferência gratuita.

O timeout de transporte não prova cancelamento do trabalho no servidor. Consulte a sessão e use `opencode_abort_session` se necessário. Não repita automaticamente um prompt cujo aceite ficou incerto.

Veja [a auditoria e o plano](docs/auditoria-integracao.md).

## Ponte remota 0.2

A ponte remota usa conexão de saída do computador, sem publicar a porta do OpenCode. O servidor MCP HTTP está em:

`https://predictbot-opencode.daviconcentrix.workers.dev/mcp`

O pareamento é feito em [Conectar OpenCode](https://predictbot-opencode.daviconcentrix.workers.dev/connect), usando a conta Supabase existente e o autenticador. A empresa precisa estar com MCP ativado. Clientes OAuth precisam estar na lista autorizada da empresa e possuir o grant MFA válido já usado pelo INFINITUM. Nenhuma política ou tabela do CRM foi alterada.

Na Central: conecte primeiro o OpenCode, abra **Usar este OpenCode à distância**, gere o código na página, cole no aplicativo e confirme o dispositivo na página. Códigos valem cinco minutos e são de uso único; o dispositivo precisa da confirmação do usuário autenticado. As permissões de leitura são o padrão; escrita é opcional e cada operação ainda pede confirmação no computador. A credencial do dispositivo fica no processo principal, expira em 24 horas e pode ser revogada. Fechar/reabrir a Central exige novo pareamento; perda temporária de internet durante a sessão tem reconexão automática.

O MCP remoto devolve um ID de operação. Use `opencode_get_task` para obter o resultado; `succeeded` significa que a chamada à API do OpenCode respondeu, não que o modelo concluiu o trabalho. `opencode_list_devices` mostra seus dispositivos. Cada chamada enfileirada exige `deviceId` e `requestId` UUID, para idempotência. O transporte local STDIO continua disponível.

A fila usa um Durable Object SQLite separado por empresa e usuário. Entradas/resultados são temporários e expiram em até 15 minutos; esse armazenamento não é arquivo de clientes, WhatsApp ou memória de agentes. Código de pareamento e tokens são assinados; segredos do dispositivo são guardados como hash no servidor. Nenhuma ferramenta de shell ou de configuração arbitrária de MCP é oferecida à nuvem. Sessões para tarefas remotas usam a aprovação nativa do OpenCode.

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run build:relay
```

O teste de runtime exercita o Worker e o SQLite reais no Miniflare, com identidade sintética. Para testar a ponte inteira com um binário OpenCode real, defina `W1_OPENCODE_EXECUTABLE` e execute `node scripts/relay-live-smoke.mjs`. O teste não envia prompt de inferência.

Veja [contrato de integração e divisão de trabalho](docs/OPENCODE-CONTRATO.md).
