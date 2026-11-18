/**
 * W1 Local AI: local-only OpenAI-compatible proxy for BitNet, Colibri, Ollama.
 * It never calls cloud inference endpoints.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function validateLocalUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL local inválida'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('Somente URL HTTP loopback local sem credenciais é permitida');
  }
  return url.origin;
}

export function validateChat(payload) {
  if (!payload || typeof payload !== 'object' || payload.stream === true ||
      !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 40) {
    throw new Error('Informe de 1 a 40 mensagens; streaming ainda não é suportado');
  }
  let total = 0;
  for (const message of payload.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('Formato de mensagem não suportado');
    }
    total += message.content.length;
  }
  if (total > 12000) throw new Error('Texto acima do limite de 12.000 caracteres para o modo econômico');
  if (payload.max_tokens !== undefined && (!Number.isInteger(payload.max_tokens) || payload.max_tokens < 1 || payload.max_tokens > 512)) {
    throw new Error('max_tokens deve estar entre 1 e 512');
  }
  if (payload.temperature !== undefined && (typeof payload.temperature !== 'number' || payload.temperature < 0 || payload.temperature > 2)) {
    throw new Error('temperature deve estar entre 0 e 2');
  }
  return { messages: payload.messages, max_tokens: payload.max_tokens ?? 256, stream: false, ...(payload.temperature === undefined ? {} : { temperature: payload.temperature }) };
}

export function createLocalRouter({ engines = [], timeoutMs = 90000, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw new Error('Timeout inválido');
  const local = engines.map(engine => {
    if (!engine || typeof engine.name !== 'string' || !/^[a-z0-9-]{1,32}$/.test(engine.name)) throw new Error('Motor inválido');
    return { name: engine.name, baseUrl: validateLocalUrl(engine.baseUrl), model: engine.model || null };
  });

  async function chat(payload) {
    const body = validateChat(payload);
    if (!local.length) throw new Error('Nenhum motor local configurado');
    for (const engine of local) {
      try {
        const options = { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' };
        let model = engine.model;
        if (!model) {
          const lookup = await fetchImpl(`${engine.baseUrl}/v1/models`, options);
          if (!lookup.ok) continue;
          const models = await lookup.json();
          model = models?.data?.[0]?.id;
          if (typeof model !== 'string' || !model) continue;
        }
        const response = await fetchImpl(`${engine.baseUrl}/v1/chat/completions`, {
          ...options, method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, model }),
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (!data || !Array.isArray(data.choices)) continue;
        return { engine: engine.name, data };
      } catch { /* local offline, timeout or malformed response; try next local engine */ }
    }
    throw new Error('Todos os motores locais estão indisponíveis ou falharam');
  }
  return { chat, engines: local.map(({ name }) => name) };
}

async function readJson(request, maxBytes = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error('Corpo acima do limite');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON inválido'); }
}

function authorized(provided, key) {
  if (!provided?.startsWith('Bearer ')) return false;
  const a = Buffer.from(provided.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startLocalGateway({ port = 8765, key = randomBytes(24).toString('hex'), engines = [], timeoutMs = 90000 } = {}) {
  if (typeof key !== 'string' || key.length < 8) throw new Error('Chave local muito curta');
  const router = createLocalRouter({ engines, timeoutMs });
  let busy = false;
  const server = createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/health' && request.method === 'GET') {
      send(200, { ok: true, type: 'w1-local-ai', mode: 'offline-only' });
      return;
    }
    if (!authorized(request.headers.authorization, key)) { send(401, { error: { message:'Chave local obrigatória' } }); return; }
    if (request.url === '/v1/models' && request.method === 'GET') {
      send(200, { object:'list', data: [{ id:'w1-local-auto', object:'model', owned_by:'w1capital-local' }] });
      return;
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') { send(404, {error:{message:'Rota não encontrada'}}); return; }
    if (busy) { send(429, { error: { message: 'Aguarde a inferência local terminar' } }); return; }
    busy = true;
    try {
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new Error('Content-Type deve ser application/json');
      const payload = await readJson(request);
      const { engine, data } = await router.chat(payload);
      response.setHeader('x-w1-engine', engine);
      send(200, data);
    } catch (err) {
      const inputError = /JSON|Corpo|Informe|max_tokens|streaming|Formato|Texto|temperature|Content-Type/.test(err.message);
      send(inputError ? 400 : 503, { error: { message: err.message } });
    } finally { busy = false; }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, key, close: () => new Promise(resolve => server.close(resolve)) };
}
