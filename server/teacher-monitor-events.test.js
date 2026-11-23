import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';

const PASSWORD = 'test-password';
const json = { 'content-type': 'application/json' };

async function startApp() {
  const server = createApplication({ environment: 'development', teacherPassword: PASSWORD }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function login() {
    const response = await fetch(`${url}/api/teacher/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  async function connect(query = '', cookie) {
    const response = await fetch(`${url}/api/events${query}`, { headers: cookie ? { cookie } : {} });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const split = buffer.indexOf('\n\n');
        if (split !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          return block;
        }
        let timer;
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE timeout')), deadline - Date.now()); }),
        ]).finally(() => clearTimeout(timer));
        if (result.done) throw new Error('SSE stream closed');
        buffer += decoder.decode(result.value, { stream: true });
      }
      throw new Error('SSE timeout');
    }
    // 在期限內收集所有事件名稱（心跳間隔 15 秒，不會出現在短時間的收集中）
    async function eventsWithin(ms) {
      const names = [];
      for (;;) {
        try {
          const block = await next(ms);
          names.push(block.match(/^event: (.+)$/m)?.[1]);
        } catch (error) {
          if (error.message === 'SSE timeout') return names;
          throw error;
        }
      }
    }
    assert.equal(await next(), 'retry: 3000');
    return { next, eventsWithin, close: () => reader.cancel() };
  }

  async function enter(studentId, groupId) {
    const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId, groupId }) });
    assert.equal(response.status, 200);
  }

  async function submit(studentId, questionId = 1) {
    const response = await fetch(`${url}/api/student/submissions`, { method: 'POST', headers: json, body: JSON.stringify({ studentId, questionId, answers: ['答案'] }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }

  async function start(cookie) {
    const response = await fetch(`${url}/api/session/start`, { method: 'POST', headers: { cookie } });
    assert.equal(response.status, 200);
  }

  return { server, url, login, connect, enter, submit, start };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

function parse(block) {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null');
  return { event, data };
}

test('unauthenticated role=teacher connection is rejected with 401', async () => {
  const app = await startApp();
  try {
    const response = await fetch(`${app.url}/api/events?role=teacher`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' } });
  } finally {
    await close(app.server);
  }
});

test('teacher connection receives phase and a content-free monitor notice within 2 seconds', async () => {
  const app = await startApp();
  const cookie = await app.login();
  const teacher = await app.connect('?role=teacher', cookie);
  try {
    await app.enter('stu-aaaa1111', 2);
    await app.start(cookie);
    assert.equal(parse(await teacher.next()).event, 'phase');
    const startedAt = Date.now();
    await app.submit('stu-aaaa1111');
    const { event, data } = parse(await teacher.next(2000));
    assert.equal(event, 'monitor');
    assert.deepEqual(Object.keys(data), ['serverTime']);
    assert.ok(Date.now() - startedAt < 2000);
  } finally {
    await teacher.close();
    await close(app.server);
  }
});

test('a logged-out teacher connection stops receiving monitor notices', async () => {
  const app = await startApp();
  const cookie = await app.login();
  const teacher = await app.connect('?role=teacher', cookie);
  try {
    await app.enter('stu-aaaa1111', 1);
    await app.start(cookie);
    assert.equal(parse(await teacher.next()).event, 'phase');
    const logout = await fetch(`${app.url}/api/teacher/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    await app.submit('stu-aaaa1111');
    assert.deepEqual(await teacher.eventsWithin(500), []);
  } finally {
    await teacher.close();
    await close(app.server);
  }
});

test('student and public connections never receive monitor notices', async () => {
  const app = await startApp();
  const cookie = await app.login();
  await app.enter('stu-aaaa1111', 1);
  await app.enter('stu-bbbb2222', 2);
  const own = await app.connect('?studentId=stu-aaaa1111');
  const other = await app.connect('?studentId=stu-bbbb2222');
  const publicStream = await app.connect();
  try {
    await app.start(cookie);
    for (const stream of [own, other, publicStream]) assert.equal(parse(await stream.next()).event, 'phase');
    await app.submit('stu-aaaa1111');
    assert.deepEqual(await own.eventsWithin(500), ['submission']);
    assert.deepEqual(await other.eventsWithin(200), []);
    assert.deepEqual(await publicStream.eventsWithin(200), []);
  } finally {
    await Promise.all([own.close(), other.close(), publicStream.close()]);
    await close(app.server);
  }
});
