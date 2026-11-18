# Recibo de resposta grande na ponte

Revisão da main `7d17c2f`: a proteção anterior para escritas com resultado incerto foi preservada. Uma resposta confirmada com mais de 240.000 caracteres, porém, era convertida em `failed` apenas pelo tamanho. O teste de regressão reproduziu `failed` onde a API havia confirmado sucesso.

A ponte agora mantém `succeeded` para a chamada confirmada e sinaliza `truncated`. O recibo limitado preserva somente o booleano `accepted` e identificadores de sessão curtos e válidos. O conteúdo completo continua no OpenCode local. Isso confirma o retorno da API, não a conclusão de uma tarefa pelo modelo.

Validação: check sintático e 41 testes aprovados, incluindo Worker em Miniflare, persistência após reinício, autorização e repetição sem nova execução. O novo teste usa adaptador sintético; nenhuma inferência paga ou conta real foi executada. Não exige mudança no Worker. O EXE 0.1.46 publicado anteriormente contém a revisão anterior; a distribuição da correção depende de um novo pacote da Central.
