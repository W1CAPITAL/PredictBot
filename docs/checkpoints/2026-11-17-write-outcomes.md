# Revisão de resultados de escrita — 17/11/2026

## Falha reproduzida

A ponte classificava como `failed` um erro comum emitido pelo adaptador depois de iniciar `create`, `prompt` ou `abort`. Um HTTP 503 após a chamada não prova que o servidor deixou de produzir efeitos. Esse resultado deve permanecer `unknown`, sem retentativa automática de escrita.

## Correção

O cliente registra se chegou a chamar o adaptador. Após uma tentativa de escrita, erro sem resultado confirmado vira `unknown`. Recusa humana antes da chamada continua `failed`, assim como erro explícito de uma leitura. O controle de sessão, MFA e autorização não foi ampliado. O Worker e o banco não mudaram; a correção pertence ao cliente executado na Central.

## Evidência

Três regressões novas (prompt/create/abort com erro HTTP após tentativa) falharam antes da alteração: obtido `failed`, esperado `unknown`. Após a correção, a suíte completa passou com 40 testes locais e build do Worker; sintaxe e diff também passaram. Os testes usam identidade e respostas sintéticas, sem execução de modelo pago ou conta real.

## Estado das outras frentes observado

- PredictBot: main ba8c1e7; sem PR aberta antes desta revisão; CI main com sucesso.
- Central: main 93c1c0f; CI rápido aprovado, build Windows 44172450194 falhou no smoke dos servidores empacotados. PR #3 de staging permanece ativa e foi preservada. Não declarar EXE pronto nem publicar atualização com base nesta correção.
- Infinitum: main 4b25d19, sem PR aberta e CI retornando sucesso.
- LexisPredict: main 95ca57a, correção da fila incorporada e CI com sucesso; propostas antigas permanecem abertas.
- PredictLM: main 5261c55, correções de ledger/autenticação incorporadas; último run main retornou failure. A causa não foi revalidada por esta revisão, portanto não atribuir automaticamente a cobrança.
- SITE: main d9ade99, CI recuperado com sucesso; PRs de mídia antigas não foram integradas.

## Continuidade

Atualizar o SHA do pacote na Central para distribuir a correção. Preservar as mudanças de empacotamento da PR #3. Depois de instalado o pacote atualizado e feito o pareamento real, verificar a apresentação de `unknown` na supervisão e reconciliar a sessão antes de criar uma nova tentativa. Não confundir aceite de prompt com conclusão do trabalho do modelo.
