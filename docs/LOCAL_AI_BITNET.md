# IA local W1: BitNet + Colibri + Ollama

Esta integração oferece a API de chat `/v1/chat/completions`, compatível com clientes OpenAI, sem utilizar inferência paga. Ela **não roda Grok 4.6**, nem promete inteligência equivalente. O BitNet b1.58 2B-4T possui 2,4 bilhões de parâmetros. Em um i3 com 8 GB, desempenho e compatibilidade dependem da geração do processador e da versão do binário.

## Passo 1: preparar o BitNet da Microsoft

Repositório oficial: https://github.com/microsoft/BitNet

Baixe o projeto em `%USERPROFILE%\BitNet`. O upstream exige Python, CMake, Visual Studio 2022 com ferramentas C++/Clang no Windows. Recomenda-se compilar em outro computador ou num job de CI específico de compilação (não de inferência contínua), pois compilar no i3 consome bastante memória.

Modelo GGUF oficial: https://huggingface.co/microsoft/BitNet-b1.58-2B-4T-gguf

O script espera o arquivo `models\BitNet-b1.58-2B-4T\ggml-model-i2_s.gguf` e o executável `build\bin\Release\llama-server.exe` dentro da pasta do BitNet. Os pesos **não estão incluídos** no PredictBot. O iniciador verifica a presença dos arquivos e não tenta downloads inesperados.

No PowerShell, na pasta do PredictBot:

```powershell
powershell -NoProfile -File .\bin\start-bitnet-windows.ps1 -BitNetDir "$env:USERPROFILE\BitNet" -Threads 2 -Context 1024
```

O servidor oficial será iniciado em `http://127.0.0.1:8080`. Se o seu i3 for antigo, verifique suporte a instruções x86 exigidas pelo binário, especialmente AVX2.

## Passo 2: iniciar a ponte local do PredictBot

Em um segundo terminal, com Node.js 22+:

```powershell
npm run start:local-ai
```

A URL-base será `http://127.0.0.1:8765/v1`; use o modelo `w1-local-auto` e a chave exibida pelo terminal para configurar um cliente compatível com OpenAI. A chave aleatória não deve ser publicada. Para persistir uma chave local, utilize a variável de ambiente `W1_LOCAL_AI_KEY`.

O gateway prefere o BitNet e permite os seguintes motores opcionais:

- Colibri: `W1_COLIBRI_URL=http://127.0.0.1:PORTA`; exige endpoints compatíveis com `/v1/models` e `/v1/chat/completions`.
- Ollama: defina `W1_OLLAMA_MODEL` com um modelo instalado; usa a API local da porta 11434.
- BitNet: `W1_BITNET_URL` substitui a porta 8080, quando necessário.

Somente URLs HTTP no próprio computador são aceitas. **Nada é enviado a provedores externos pelo gateway**. A porta não é publicada na internet, as chamadas exigem uma chave e apenas uma geração ocorre por vez.

## Limitações atuais

- Sem streaming de tokens; no máximo 12 mil caracteres de entrada e 512 tokens de saída por resposta.
- Requer que BitNet, Ollama ou Colibri estejam instalados e funcionando separadamente. Esta contribuição adiciona a ponte e o iniciador, mas não instala pesos nem compila o BitNet no PC.
- Colibri com modelos grandes é inadequado para a meta de 8 GB em uso normal; ainda requer SSD, RAM e CPU.
- O serviço é executado localmente, portanto consome CPU e RAM. **Gratuidade de API não significa computação infinita sem hardware.**
- GitHub é usado para código, builds e releases, e Cloudflare pode servir como transporte dentro das franquias. Nenhum dos dois é servidor de inferência ilimitado e gratuito.
- Testes: `node --test test/local-ai.test.mjs`. São testes com motores falsos locais e **não substituem um teste real em Windows i3**.

Fontes: https://github.com/microsoft/BitNet e https://github.com/JustVugg/colibri.
