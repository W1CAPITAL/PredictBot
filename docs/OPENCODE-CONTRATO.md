# OpenCode/MCP — contrato de integração e divisão de trabalho

Atualização: 17/11/2026. O usuário informou que outra IA implementará o plano `W1-Capital-Analise-e-Plano-Tecnico-2026-11-17.md`.

## Responsabilidades preservadas

Esta frente implementa o adaptador OpenCode, a ponte MCP local e remota, pareamento/dispositivo, execução tipada e os controles correspondentes da Central. A outra frente mantém o empacotamento/staging Windows, banco/RLS, contadores e retornos jurídicos, WhatsApp, PredictLM e migração dos agentes/chats/Hermes. A ponte fornece um contrato para essa migração sem criar um segundo backend de chat.

Não reescrever `src/opencode-*`, `src/relay/*`, `workers/*` ou os respectivos testes para implementar M12/M13. Consumir os exports existentes ou registrar mudança de contrato. A Central usa o pacote por SHA imutável. Alterações na loja limitam-se aos controles OpenCode; esta frente não alterou `scripts/stage-next.mjs`, `scripts/verify-products.mjs` ou a lógica de assinatura e update.

As PRs iniciais PredictBot #1 e Central #2 foram incorporadas. A correção de origem `W1CAPITAL/Infinitum` coincide com M02 e já está na main; preservar a correção de staging que a outra frente está preparando.

## Superfícies

- `OpenCodeAdapter`: export principal do pacote. `forPrincipal(principal)` é exclusivo do host confiável e cria uma instância com histórico separado; não é ferramenta MCP nem argumento controlado por modelo.
- `OpenCodeRuntime`: export `./runtime`; detecta e inicia somente o executável autorizado em loopback e encerra somente processo próprio.
- `OpenCodeRelayClient`: export `./relay`; pareia por ticket temporário, recebe operações permitidas por conexão de saída e exige callback local de aprovação para escrita. Callback ausente recusa escrita.
- `createOpenCodeMcpServer`: export `./mcp`; transporte STDIO.
- Worker: `workers/worker.mjs`; transporte HTTP stateless pelo SDK MCP oficial, com autenticação por requisição.

## Endereços e autorização

- Portal: `https://predictbot-opencode.daviconcentrix.workers.dev/connect`
- MCP: `https://predictbot-opencode.daviconcentrix.workers.dev/mcp`
- Saúde/configuração: `/health`
- Descoberta: `/.well-known/oauth-protected-resource/mcp`

O servidor usa o projeto Supabase já existente. Faz `getUser` autenticado e consultas sujeitas à RLS a `usuarios` e `office_agent_company_policies`. Empresa vem do vínculo confirmado, nunca de argumento ou metadado editável do usuário. OAuth exige `client_id` na lista autorizada da empresa e RPC `killa_check_mcp_mfa_grant` retornando true. Para pareamento via sessão nativa, exige `aal2`. Sem política MCP habilitada, falha fechado.

Não foram criadas políticas, tabelas, funções ou credenciais administrativas no banco. Esta frente depende desses contratos preexistentes: avisar antes de renomear campos/RPC. Uma API sem acesso de leitura às políticas deve falhar fechada, não usar service_role para contornar a RLS.

## API para o futuro PredictBot

Usar o token de sessão existente e confirmado; não armazenar senha ou token do usuário nos jobs.

| Método e rota | Entrada | Retorno |
| --- | --- | --- |
| POST `/v1/pair` | `{scopes:["read"]}` ou `read,execute` | Código assinado de cinco minutos, principal verificado |
| GET `/v1/devices` | Bearer da sessão | Dispositivos do usuário/empresa, confirmação e última presença |
| POST `/v1/approve` | `deviceId, confirmation` | Confirma somente o dispositivo pendente exato |
| POST `/v1/revoke` | `deviceId` | Revoga e bloqueia jobs pendentes |
| POST `/v1/jobs` | `deviceId, operation, input, key` | Estado da operação; key UUID estável em retentativas |
| POST `/v1/task` | `jobId` | Resultado/erro real da chamada OpenCode |

A Central usa `/v1/claim` com o ticket e depois `/v1/device/poll` e `/v1/device/complete` com a credencial de dispositivo. Tickets e credenciais têm HMAC e prazo; assinatura é validada antes de criar/acessar o Durable Object. Assim, uma URL ou ID conhecido não concede execução.

## Operações permitidas

Leitura: `health`, `version`, `providers`, `models`, `projects`, `sessions`, `get`, `messages`, `diff`, `mcp`.

Escrita: `create`, `prompt`, `abort`. Cada escrita requer escopo do dispositivo e confirmação no computador. `create` abre sessão com aprovação nativa do OpenCode. Não existem comandos de shell, configuração arbitrária de provedor, instalação, merge ou deploy nessa API.

## Estados e recuperação

`queued → claimed → succeeded | failed | unknown`.

`succeeded` comprova resposta da API, inclusive aceite de prompt; o estado do trabalho do modelo deve ser consultado separadamente. Não converter aceite em conclusão de tarefa, review ou teste. O outro sistema deve persistir seu próprio run/step e recibo, porque a fila de transporte remove jobs após 15 minutos.

Recibos acima de 64.000 bytes UTF-8, contando o envelope completo, são resumidos antes do envio ao Worker (limite de 64 KiB). `result.truncated=true` informa que os detalhes devem ser consultados no OpenCode local. O resumo preserva `accepted` quando booleano e `id`/`sessionId` quando identificadores de sessão válidos e limitados. Uma resposta confirmada continua `succeeded`; truncamento não prova falha e não autoriza repetir a operação.

Lease expirado de leitura pode voltar à fila. Lease expirado de `create/prompt/abort` vira `unknown` e não é repetido automaticamente. Recibo tardio autenticado pode confirmar escrita sem executá-la novamente. Chave de idempotência reutilizada com conteúdo diferente recebe conflito. Revogação bloqueia polls e cancela trabalho ainda não executado. Operações já iniciadas no OpenCode precisam de cancelamento explícito; desligar a ponte não prova cancelamento do modelo.

A UI Hermes deve consumir esses estados reais. Não representar uma fila de transporte como memória permanente ou motor de workflows de negócio.

## Evidência e limites

- 36 testes do pacote passaram localmente, incluindo Worker/DO SQLite e persistência em reinício no Miniflare.
- Smoke da ponte inteira com OpenCode 2.3.0 real passou: Worker → fila → cliente local → API → recibo. A identidade desse teste é sintética; não foi feito login na conta do usuário.
- Nenhum prompt de inferência foi enviado, nenhum provedor pago ativado e nenhuma sessão Qoder iniciada.
- Upload do Worker foi confirmado pela API Cloudflare. Probes HTTP posteriores confirmaram `/health` 200/configurado, descoberta OAuth 200, MCP sem token 401 e ticket inválido 401. É necessário parear uma sessão real para homologar o acesso autenticado no navegador do usuário.
- O instalador Windows e o fluxo visual no PC do usuário não foram testados por esta frente. O código foi integrado preservando o lote de staging da outra IA.

Nenhum serviço é prometido como ilimitado. O novo Worker/DO utiliza o plano e as quotas já existentes da conta; não foi contratado upgrade.
