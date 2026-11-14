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
