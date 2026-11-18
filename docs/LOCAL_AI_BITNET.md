# IA local W1 — instalação gerenciada pela Central

A instalação do Microsoft BitNet deixou de ser uma configuração manual dentro deste repositório. O **Central de Apps da W1** gerencia o download, a verificação e a inicialização do motor local, compartilhado com o PredictBot independente.

## Como funciona

- No primeiro uso do PredictBot, a Central inicia automaticamente a preparação e exibe o progresso.
- Baixa o executável CPU x64 do llama.cpp e o modelo oficial Microsoft BitNet b1.58 2B-4T em GGUF.
- Confere o tamanho e o SHA-256 dos dois arquivos antes de instalar.
- Armazena os arquivos em `%LOCALAPPDATA%\W1 Capital\Local AI`, compartilhados entre as janelas W1.
- Inicia o motor apenas em `127.0.0.1`, com chave local, contexto de 1.024 tokens, até duas threads e uma geração por vez.
- Descarrega os pesos da memória após cinco minutos sem uso.
- Configura o provedor OpenCode em arquivo isolado, sem alterar o modelo padrão nem a configuração global do usuário.

## Uso no PredictBot

Depois da preparação, conecte ou reconecte o OpenCode. O modelo `w1-local/bitnet-2b` aparece no seletor de modelo da sessão. É possível usar BitNet em uma sessão e manter GPT 6.2 Astra em outra.

BitNet está configurado como modelo de texto, sem tool-calling. Use Astra ou outro modelo com suporte a ferramentas para agentes, programação e operações MCP.

## Custos e limites

- A primeira instalação baixa aproximadamente 1,22 GB.
- Depois do download, a inferência é local e não consome créditos de API.
- O computador continua usando CPU e RAM; isso não representa computação infinita.
- O modelo tem cerca de 2 bilhões de parâmetros e **não equivale ao Grok 4.6 ou ao GPT 6.2 Astra**.
- O Central usa o executável CPU do llama.cpp com os pesos GGUF oficiais. O runtime otimizado bitnet.cpp da Microsoft não está incluído nesta distribuição Windows.

## Fontes oficiais

- Microsoft BitNet: https://github.com/microsoft/BitNet
- Modelo Microsoft BitNet GGUF: https://huggingface.co/microsoft/bitnet-b1.58-2B-4T-gguf
- llama.cpp: https://github.com/ggml-org/llama.cpp

Não execute scripts de compilação ou inicialização manual deste repositório para preparar a IA local. A Central é responsável por isso.
