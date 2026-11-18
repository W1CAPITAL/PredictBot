import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLocalRouter, startLocalGateway, validateLocalUrl } from '../src/local-ai.mjs';

async function fixture(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const sample = { model: 'w1-local-auto', messages: [{ role: 'user', content: 'teste' }], max_tokens: 40 };

test('refuses external or credential-bearing inference URLs', () => {
  for (const url of [
    'https://api.openai.com/v1', 'http://192.168.1.2:11434', 'http://localhost.evil.com',
    'http://u:p@127.0.0.1:8080', 'file:///etc/passwd', 'http://127.0.0.1:8080/?x=1',
  ]) assert.throws(() => validateLocalUrl(url), /local|loopback|http|URL/i, url);
  assert.equal(validateLocalUrl('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080');
});

test('chooses first healthy local engine and preserves model identity', async () => {
  const first = await fixture((_req, res) => { res.writeHead(503); res.end('unavailable'); });
  const second = await fixture(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{id:'bitnet-2b'}] })); return; }
    let body=''; for await (const c of req) body += c;
    assert.equal(JSON.parse(body).model, 'bitnet-2b');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id:'chatcmpl-test', model:'bitnet-2b', choices:[{message:{role:'assistant',content:'resposta local'}}] }));
  });
  try {
    const router = createLocalRouter({ engines: [{ name:'failed', baseUrl:first.url }, {name:'bitnet',baseUrl:second.url}], timeoutMs:2000 });
    const result = await router.chat(sample);
    assert.equal(result.engine,'bitnet');
    assert.equal(result.data.model,'bitnet-2b');
    assert.equal(result.data.choices[0].message.content,'resposta local');
  } finally { await first.close(); await second.close(); }
});

test('never dials a remote endpoint even if configured as a fallback', () => {
  assert.throws(() => createLocalRouter({ engines: [{name:'remote', baseUrl:'https://api.example.com'}] }), /local|loopback|http/i);
});

test('reports failure instead of inventing a response', async () => {
  const router = createLocalRouter({ engines: [] });
  await assert.rejects(() => router.chat(sample), /Nenhum motor local/);
});

test('gateway requires bearer token and rejects invalid input', async () => {
  const upstream = await fixture(async (req,res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({data:[{id:'bitnet'}]})); return; }
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({id:'1',model:'bitnet',choices:[{message:{role:'assistant',content:'OK'}}]}));
  });
  const gateway = await startLocalGateway({port:0,key:'secret-local',engines:[{name:'bitnet',baseUrl:upstream.url}], timeoutMs:3000});
  try {
    const base = `http://127.0.0.1:${gateway.port}`;
    const unauthorized = await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sample)});
    assert.equal(unauthorized.status,401);
    const malformed = await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer secret-local'},body:JSON.stringify({...sample,messages:[]})});
    assert.equal(malformed.status,400);
    const response = await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer secret-local'},body:JSON.stringify(sample)});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-w1-engine'),'bitnet');
    assert.equal((await response.json()).choices[0].message.content,'OK');
  } finally { await gateway.close(); await upstream.close(); }
});

test('does not duplicate the API prefix when backend URL includes /v1', async () => {
  const upstream = await fixture((req, res) => {
    if (req.url === '/v1/chat/completions') {
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({model:'bitnet',choices:[{message:{content:'funciona'}}]}));
    } else { res.writeHead(404); res.end(); }
  });
  try {
    const router = createLocalRouter({ engines: [{name:'bitnet',baseUrl:upstream.url+'/v1',model:'bitnet'}], timeoutMs:1000 });
    assert.equal((await router.chat(sample)).data.choices[0].message.content,'funciona');
  } finally {await upstream.close();}
});

test('does not allow concurrent inference on low-memory machines', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started;
  const seen = new Promise(resolve => { started=resolve; });
  const upstream = await fixture(async (req,res) => {
    if (req.url === '/v1/chat/completions') { started(); await pending; res.setHeader('content-type','application/json'); res.end(JSON.stringify({model:'local',choices:[{message:{content:'ok'}}]})); return; }
    res.writeHead(404);res.end();
  });
  const gateway = await startLocalGateway({port:0,key:'secret-local',engines:[{name:'bitnet',baseUrl:upstream.url,model:'local'}],timeoutMs:3000});
  const base=`http://127.0.0.1:${gateway.port}/v1/chat/completions`;
  const opts={method:'POST',headers:{authorization:'Bearer secret-local','content-type':'application/json'},body:JSON.stringify(sample)};
  try {
    const p=fetch(base,opts); await seen;
    const second=await fetch(base,opts);assert.equal(second.status,429);
    release();assert.equal((await p).status,200);
  } finally {release();await gateway.close();await upstream.close();}
});
