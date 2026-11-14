import assert from 'node:assert/strict';
import { createApplication } from './index.js';

const server = createApplication({ environment: 'development' }).listen(0, '127.0.0.1');
const clients = [];

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const summary = (await fetch(`${baseUrl}/api/session`)).json();
  const { questionCount } = (await summary).data;
  assert.ok(questionCount >= 50, `expected at least 50 seeded questions, got ${questionCount}`);

  const connectClient = async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const nextBlock = async (timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          return block;
        }
        let timeout;
        const next = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('timed out waiting for SSE data')), deadline - Date.now());
          }),
        ]).finally(() => clearTimeout(timeout));
        if (next.done) throw new Error('SSE connection closed before phase event');
        buffer += decoder.decode(next.value, { stream: true });
      }
      throw new Error('timed out waiting for SSE event');
    };

    const client = { controller, reader, nextBlock };
    clients.push(client);
    assert.equal(await nextBlock(), 'retry: 3000');
    return client;
  };

  const connectedClients = await Promise.all(Array.from({ length: 100 }, connectClient));
  const emittedAt = Date.now();
  const phaseResponse = await fetch(`${baseUrl}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
  assert.equal(phaseResponse.status, 200);

  const latencies = await Promise.all(connectedClients.map(async (client, index) => {
    const event = await client.nextBlock(2_000);
    const latencyMs = Date.now() - emittedAt;
    assert.match(event, /^event: phase\ndata: \{"phase":"搶答中","serverTime":"[^"\n]+"\}$/);
    return { client: index + 1, latencyMs };
  }));

  const maxLatency = Math.max(...latencies.map(({ latencyMs }) => latencyMs));
  console.log(JSON.stringify({ clients: latencies.length, questionCount, maxLatencyMs: maxLatency, allWithin2Seconds: maxLatency < 2_000 }));
  assert.equal(latencies.length, 100);
  assert.ok(maxLatency < 2_000, `all 100 clients must receive phase event within 2 seconds; max was ${maxLatency}ms`);
} finally {
  await Promise.all(clients.map(async ({ reader, controller }) => {
    await reader.cancel().catch(() => {});
    controller.abort();
  }));
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
