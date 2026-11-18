#!/usr/bin/env node
import { startLocalGateway } from '../src/local-ai.mjs';

const engines = [
  { name: 'bitnet', baseUrl: process.env.W1_BITNET_URL || 'http://127.0.0.1:8080', model: process.env.W1_BITNET_MODEL },
  ...(process.env.W1_COLIBRI_URL ? [{ name: 'colibri', baseUrl: process.env.W1_COLIBRI_URL, model: process.env.W1_COLIBRI_MODEL }] : []),
  ...(process.env.W1_OLLAMA_MODEL ? [{ name: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: process.env.W1_OLLAMA_MODEL }] : []),
];
try {
  const gateway = await startLocalGateway({
    port: Number(process.env.W1_LOCAL_AI_PORT || 8765),
    key: process.env.W1_LOCAL_AI_KEY || undefined,
    engines,
  });
  console.log(`W1 Local AI: http://127.0.0.1:${gateway.port}/v1`);
  console.log(`Chave local (não compartilhe): ${gateway.key}`);
  console.log('Somente inferência local; sem envio à nuvem e sem cobranças de API.');
} catch (error) {
  console.error(`Falha ao iniciar W1 Local AI: ${error.message}`);
  process.exitCode = 1;
}
