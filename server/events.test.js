import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

function createRecordingLogger() {
  const lines = [];
  return { lines, error: (...args) => lines.push(args.map(String).join(' ')) };
}

async function withErrorServer(logger, run) {
  const errorServer = createApplication({ environment: 'test', exposeTestErrorRoute: true, logger }).listen(0, '127.0.0.1');
  await new Promise((resolve) => errorServer.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${errorServer.address().port}`);
  } finally {
    await new Promise((resolve) => errorServer.close(resolve));
  }
}

test('unexpected errors are logged with method, path and stack', async () => {
  const logger = createRecordingLogger();
  await withErrorServer(logger, async (url) => {
    const response = await fetch(`${url}/api/__test__/error`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: '伺服器發生未預期錯誤。' } });
  });
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /^\[\d{4}-\d{2}-\d{2}T[^\]]+Z\] GET \/api\/__test__\/error 500 INTERNAL_ERROR\n/);
  assert.match(logger.lines[0], /Error: test-only-secret-marker\n\s+at /);
});

test('error log excludes query string, cookies and body', async () => {
  const logger = createRecordingLogger();
  await withErrorServer(logger, async (url) => {
    const response = await fetch(`${url}/api/__test__/error?studentId=stu-secret-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'teacher_session=cookie-secret' },
      body: JSON.stringify({ password: 'body-secret' }),
    });
    assert.equal(response.status, 500);
  });
  assert.equal(logger.lines.length, 1);
  assert.match(logger.lines[0], /POST \/api\/__test__\/error 500/);
  assert.doesNotMatch(logger.lines[0], /stu-secret-query|cookie-secret|body-secret/);
});

test('client errors are not logged', async () => {
  const logger = createRecordingLogger();
  await withErrorServer(logger, async (url) => {
    const json = { 'Content-Type': 'application/json' };
    const responses = await Promise.all([
      fetch(`${url}/api/groups`, { method: 'PUT', headers: json, body: '{bad json' }),
      fetch(`${url}/api/groups`, { method: 'PUT', headers: json, body: JSON.stringify({ text: 'x'.repeat(17 * 1024) }) }),
      fetch(`${url}/api/not-a-route`),
      fetch(`${url}/api/session/start`, { method: 'POST' }),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [400, 413, 404, 401]);
  });
  assert.deepEqual(logger.lines, []);
});

test('unexpected errors return a sanitized JSON error envelope', async () => {
  const errorServer = createApplication({ environment: 'test', exposeTestErrorRoute: true, logger: createRecordingLogger() }).listen(0, '127.0.0.1');
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

const TEST_PASSWORD = 'test-password';

async function startTeacherApp(environment = 'test') {
  const app = createApplication({ environment, teacherPassword: TEST_PASSWORD }).listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  const url = `http://127.0.0.1:${app.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (path, { json, raw, auth = true } = {}) => fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      ...(auth ? { Cookie: cookie } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
    },
    body: json ? JSON.stringify(json) : raw,
  });
  return { app, url, post };
}

async function readUntilBlock(reader, decoder, buffer) {
  while (!buffer.includes('\n\n')) buffer += decoder.decode((await reader.read()).value, { stream: true });
  return buffer;
}

test('session control requires teacher login even from loopback and publishes nothing when rejected', async () => {
  const { app, url, post } = await startTeacherApp();
  const stream = await fetch(`${url}/api/events`);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  try {
    assert.equal(await readUntilBlock(reader, decoder, ''), 'retry: 3000\n\n');
    for (const path of ['/api/session/start', '/api/session/end']) {
      const response = await post(path, { auth: false });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' },
      });
    }
    const next = await Promise.race([
      reader.read().then(() => 'event'),
      new Promise((resolve) => setTimeout(() => resolve('none'), 300)),
    ]);
    assert.equal(next, 'none', 'rejected requests must not publish a phase event');
    assert.equal((await fetch(`${url}/api/session`).then((response) => response.json())).data.phase, '準備中');
  } finally {
    await reader.cancel();
    await new Promise((resolve) => app.close(resolve));
  }
});

test('starting requires groups, then questions, and the phase is checked first', async () => {
  const { app, url, post } = await startTeacherApp();
  try {
    const noGroups = await post('/api/session/start');
    assert.equal(noGroups.status, 409);
    assert.deepEqual(await noGroups.json(), { error: { code: 'NO_GROUPS', message: '請先設定組別。' } });

    assert.equal((await post('/api/groups/generate', { json: { count: 2 } })).status, 200);
    const noQuestions = await post('/api/session/start');
    assert.equal(noQuestions.status, 409);
    assert.deepEqual(await noQuestions.json(), { error: { code: 'QUESTIONS_REQUIRED', message: '請先匯入學習單。' } });
    assert.equal((await fetch(`${url}/api/session`).then((response) => response.json())).data.phase, '準備中');

    const workbook = await readFile(new URL('../fixtures/guided-notes/01-official-single.xlsx', import.meta.url));
    const preview = await post('/api/teacher/guided-notes/preview/file', { raw: workbook }).then((response) => response.json());
    assert.equal((await post('/api/teacher/guided-notes/confirm', { json: { previewId: preview.data.previewId } })).status, 200);

    const stream = await fetch(`${url}/api/events`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    try {
      let buffer = await readUntilBlock(reader, decoder, '');
      buffer = buffer.slice(buffer.indexOf('\n\n') + 2);
      const startedAt = Date.now();
      const started = await post('/api/session/start');
      assert.equal(started.status, 200);
      assert.equal((await started.json()).data.phase, '搶答中');
      buffer = await readUntilBlock(reader, decoder, buffer);
      assert.ok(Date.now() - startedAt < 2_000, 'phase event must arrive within two seconds');
      assert.match(buffer, /^event: phase\ndata: \{"phase":"搶答中"/);
    } finally {
      await reader.cancel();
    }

    const repeated = await post('/api/session/start');
    assert.equal(repeated.status, 409);
    assert.equal((await repeated.json()).error.code, 'INVALID_PHASE_TRANSITION');
    const ended = await post('/api/session/end');
    assert.equal(ended.status, 200);
    assert.equal((await ended.json()).data.phase, '已結束');
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

test('development phase route needs no teacher login and stays mounted only in development', async () => {
  const { app, url } = await startTeacherApp('development');
  try {
    const response = await fetch(`${url}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.phase, '搶答中');
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

test('production has no development seeds or phase-control route', async () => {
  const productionServer = createApplication({ environment: 'production' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => productionServer.once('listening', resolve));
  const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
  try {
    const summary = await fetch(`${productionUrl}/api/session`).then((response) => response.json());
    assert.equal(summary.data.questionCount, 0);
    assert.equal(summary.data.groupCount, 0);
    const devRoute = await fetch(`${productionUrl}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
    assert.equal(devRoute.status, 404);
    assert.deepEqual(await devRoute.json(), { error: { code: 'NOT_FOUND', message: '找不到此 API 路徑。' } });
  } finally {
    await new Promise((resolve) => productionServer.close(resolve));
  }
});
