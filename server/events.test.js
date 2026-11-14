import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApplication } from './index.js';

let server;
let baseUrl;

before(async () => {
  server = createApplication({ environment: 'test' }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function openEventStream() {
  const response = await fetch(`${baseUrl}/api/events`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async nextBlock(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const separator = buffer.indexOf('\n\n');
        if (separator !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          return block;
        }
        const remaining = deadline - Date.now();
        let timeout;
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('SSE event timed out')), remaining);
          }),
        ]).finally(() => clearTimeout(timeout));
        if (result.done) throw new Error('SSE stream closed unexpectedly');
        buffer += decoder.decode(result.value, { stream: true });
      }
      throw new Error('SSE event timed out');
    },
    close() {
      reader.cancel();
    },
  };
}

test('development phase change emits the documented phase event promptly', async () => {
  const devServer = createApplication({ environment: 'development' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => devServer.once('listening', resolve));
  const devUrl = `http://127.0.0.1:${devServer.address().port}`;
  const response = await fetch(`${devUrl}/api/events`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!buffer.includes('\n\n')) {
      const { value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
    }
    const retryBlock = buffer.slice(0, buffer.indexOf('\n\n'));
    assert.equal(retryBlock, 'retry: 3000');
    buffer = buffer.slice(buffer.indexOf('\n\n') + 2);
    const startedAt = Date.now();
    const changed = await fetch(`${devUrl}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    assert.equal(changed.status, 200);
    while (!buffer.includes('\n\n')) {
      const { value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
    }
    const eventBlock = buffer.slice(0, buffer.indexOf('\n\n'));
    assert.ok(Date.now() - startedAt < 2_000, 'phase event must arrive within two seconds');
    assert.match(eventBlock, /^event: phase\ndata: \{"phase":"搶答中","serverTime":"[^"\n]+"\}$/);
    assert.ok(Number.isFinite(Date.parse(JSON.parse(eventBlock.split('\n')[1].slice(6)).serverTime)));
  } finally {
    await reader.cancel();
    await new Promise((resolve) => devServer.close(resolve));
  }
});

test('SSE emits a named heartbeat with serverTime at the documented 15 second interval', async () => {
  const stream = await openEventStream();
  try {
    assert.equal(await stream.nextBlock(), 'retry: 3000');
    const connectedAt = Date.now();
    const heartbeat = await stream.nextBlock(17_000);
    const elapsed = Date.now() - connectedAt;
    assert.ok(elapsed >= 14_500 && elapsed <= 17_000, `heartbeat arrived after ${elapsed}ms`);
    assert.match(heartbeat, /^event: heartbeat\ndata: \{"serverTime":"[^"\n]+"\}$/);
    assert.ok(Number.isFinite(Date.parse(JSON.parse(heartbeat.split('\n')[1].slice(6)).serverTime)));
  } finally {
    stream.close();
  }
});

test('malformed JSON returns the documented JSON error envelope', async () => {
  const response = await fetch(`${baseUrl}/api/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('content-type').split(';')[0], 'application/json');
  const body = await response.json();
  assert.deepEqual(body, { error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤或請求欄位無效。' } });
  assert.doesNotMatch(JSON.stringify(body), /stack|secret|Error:/i);
});

test('JSON body larger than 16 KiB returns the documented JSON error envelope', async () => {
  const response = await fetch(`${baseUrl}/api/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(16 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('content-type').split(';')[0], 'application/json');
  const body = await response.json();
  assert.deepEqual(body, { error: { code: 'BODY_TOO_LARGE', message: 'JSON body 超過 16 KiB 上限。' } });
  assert.doesNotMatch(JSON.stringify(body), /stack|secret|Error:/i);
});

test('unknown API paths return the documented JSON error envelope', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type').split(';')[0], 'application/json');
  const body = await response.json();
  assert.deepEqual(body, { error: { code: 'NOT_FOUND', message: '找不到此 API 路徑。' } });
  assert.doesNotMatch(JSON.stringify(body), /stack|secret|Error:/i);
});

test('unexpected errors return a sanitized JSON error envelope', async () => {
  const errorServer = createApplication({ environment: 'test', exposeTestErrorRoute: true }).listen(0, '127.0.0.1');
  await new Promise((resolve) => errorServer.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${errorServer.address().port}/api/__test__/error`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type').split(';')[0], 'application/json');
    const body = await response.json();
    assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: '伺服器發生未預期錯誤。' } });
    assert.doesNotMatch(JSON.stringify(body), /stack|secret|Error:|test-only-secret-marker/i);
  } finally {
    await new Promise((resolve) => errorServer.close(resolve));
  }
});
