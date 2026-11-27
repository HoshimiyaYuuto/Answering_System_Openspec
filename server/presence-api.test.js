// add-projector-board task 1.1：各組在線狀態只給老師，連線與進場變化時通知老師
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

  const logout = (cookie) => fetch(`${url}/api/teacher/logout`, { method: 'POST', headers: { cookie } });

  async function enter(studentId, groupId) {
    const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId, groupId }) });
    assert.equal(response.status, 200);
  }

  async function presence(cookie) {
    const response = await fetch(`${url}/api/teacher/presence`, { headers: cookie ? { cookie } : {} });
    return { status: response.status, body: await response.json() };
  }

  async function onlineIds(cookie) {
    const { body } = await presence(cookie);
    return body.data.groups.filter(({ online }) => online).map(({ id }) => id);
  }

  // 等 server 察覺連線關閉（close 事件是非同步的）
  async function waitForOnline(cookie, expected, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    let ids = [];
    while (Date.now() < deadline) {
      ids = await onlineIds(cookie);
      if (JSON.stringify(ids) === JSON.stringify(expected)) return ids;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual(ids, expected);
    return ids;
  }

  const control = (cookie, action) => fetch(`${url}/api/session/${action}`, { method: 'POST', headers: { cookie } });

  async function connect({ cookie, studentId } = {}) {
    const query = studentId ? `?studentId=${studentId}` : cookie ? '?role=teacher' : '';
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events${query}`, { headers: cookie ? { cookie } : {}, signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pending = null;
    async function next(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const split = buffer.indexOf('\n\n');
        if (split !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          return block;
        }
        // 逾時後未完成的 read 留給下一次，避免之後送達的事件被丟掉
        pending ??= reader.read();
        let timer;
        const result = await Promise.race([
          pending,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE timeout')), deadline - Date.now()); }),
        ]).finally(() => clearTimeout(timer));
        pending = null;
        if (result.done) throw new Error('SSE stream closed');
        buffer += decoder.decode(result.value, { stream: true });
      }
      throw new Error('SSE timeout');
    }
    async function eventsWithin(ms) {
      const blocks = [];
      for (;;) {
        try {
          blocks.push(parse(await next(ms)));
        } catch (error) {
          if (error.message === 'SSE timeout' || error.message === 'SSE stream closed') return blocks;
          throw error;
        }
      }
    }
    assert.equal(await next(2000), 'retry: 3000');
    return { eventsWithin, close: () => controller.abort() };
  }

  return { server, url, login, logout, enter, presence, onlineIds, waitForOnline, control, connect };
}

// 斷言失敗時 SSE 連線可能沒關，強制關閉避免測試卡住
const close = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });

function parse(block) {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null');
  return { event, data };
}

const presenceEvents = (blocks) => blocks.filter(({ event }) => event === 'presence');

test('presence requires a teacher login', async () => {
  const app = await startApp();
  try {
    const { status, body } = await app.presence();
    assert.equal(status, 401);
    assert.equal(body.error.code, 'TEACHER_AUTH_REQUIRED');
  } finally {
    await close(app.server);
  }
});

test('a group is online while one of its students has an event connection', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const { body } = await app.presence(cookie);
    assert.equal(body.data.groups.length, 100);
    assert.deepEqual(body.data.groups[0], { id: 1, name: '第 1 組', online: false });
    assert.equal(typeof body.data.serverTime, 'string');

    await app.enter('stu-presence-a', 2);
    assert.deepEqual(await app.onlineIds(cookie), [], 'entering alone is not online');
    const first = await app.connect({ studentId: 'stu-presence-a' });
    assert.deepEqual(await app.onlineIds(cookie), [2]);

    await app.enter('stu-presence-b', 2);
    const second = await app.connect({ studentId: 'stu-presence-b' });
    first.close();
    await app.waitForOnline(cookie, [2]);
    second.close();
    await app.waitForOnline(cookie, []);
  } finally {
    await close(app.server);
  }
});

test('switching groups while preparing moves the presence', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.enter('stu-presence-c', 2);
    const student = await app.connect({ studentId: 'stu-presence-c' });
    assert.deepEqual(await app.onlineIds(cookie), [2]);
    await app.enter('stu-presence-c', 5);
    assert.deepEqual(await app.onlineIds(cookie), [5]);
    student.close();
  } finally {
    await close(app.server);
  }
});

test('only teacher connections are notified when students connect and disconnect', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.enter('stu-presence-d', 3);
    const teacher = await app.connect({ cookie });
    const publicClient = await app.connect();
    await app.enter('stu-presence-e', 4);
    const other = await app.connect({ studentId: 'stu-presence-e' });
    await teacher.eventsWithin(200);
    await publicClient.eventsWithin(100);
    await other.eventsWithin(100);

    const student = await app.connect({ studentId: 'stu-presence-d' });
    const onConnect = presenceEvents(await teacher.eventsWithin(300));
    assert.equal(onConnect.length, 1);
    assert.deepEqual(Object.keys(onConnect[0].data), ['serverTime']);
    student.close();
    assert.equal(presenceEvents(await teacher.eventsWithin(500)).length, 1);

    assert.deepEqual(presenceEvents(await publicClient.eventsWithin(100)), []);
    assert.deepEqual(presenceEvents(await other.eventsWithin(100)), []);
    teacher.close();
    publicClient.close();
    other.close();
  } finally {
    await close(app.server);
  }
});

test('entry, group setup and reset notify teachers; reset leaves every group offline', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const teacher = await app.connect({ cookie });
    await teacher.eventsWithin(100);

    await app.enter('stu-presence-f', 1);
    assert.equal(presenceEvents(await teacher.eventsWithin(300)).length, 1, 'entry');

    const generated = await fetch(`${app.url}/api/groups/generate`, { method: 'POST', headers: { cookie, ...json }, body: JSON.stringify({ count: 10 }) });
    assert.equal(generated.status, 200);
    assert.equal(presenceEvents(await teacher.eventsWithin(300)).length, 1, 'generate');

    const replaced = await fetch(`${app.url}/api/groups`, {
      method: 'PUT', headers: { cookie, ...json }, body: JSON.stringify({ groups: [{ id: 1, name: '甲組' }, { id: 2, name: '乙組' }] }),
    });
    assert.equal(replaced.status, 200);
    assert.equal(presenceEvents(await teacher.eventsWithin(300)).length, 1, 'replace');

    const student = await app.connect({ studentId: 'stu-presence-f' });
    assert.deepEqual(await app.onlineIds(cookie), [1]);
    await teacher.eventsWithin(200);
    assert.equal((await app.control(cookie, 'start')).status, 200);
    assert.equal((await app.control(cookie, 'end')).status, 200);
    await teacher.eventsWithin(200);
    assert.equal((await app.control(cookie, 'reset')).status, 200);
    assert.ok(presenceEvents(await teacher.eventsWithin(300)).length >= 1, 'reset');
    assert.deepEqual(await app.onlineIds(cookie), []);
    student.close();
    teacher.close();
  } finally {
    await close(app.server);
  }
});

test('a teacher connection stops receiving presence after logout', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const teacher = await app.connect({ cookie });
    await teacher.eventsWithin(100);
    assert.equal((await app.logout(cookie)).status, 200);
    await app.enter('stu-presence-g', 1);
    assert.deepEqual(presenceEvents(await teacher.eventsWithin(300)), []);
    teacher.close();
  } finally {
    await close(app.server);
  }
});

test('the public session summary has no presence', async () => {
  const app = await startApp();
  try {
    await app.enter('stu-presence-h', 1);
    const student = await app.connect({ studentId: 'stu-presence-h' });
    const summary = await (await fetch(`${app.url}/api/session`)).json();
    assert.deepEqual(Object.keys(summary.data).sort(), ['activityId', 'countdownEndsAt', 'fairRankingEnabled', 'groupCount', 'phase', 'questionCount', 'serverTime']);
    assert.doesNotMatch(JSON.stringify(summary), /online/);
    student.close();
  } finally {
    await close(app.server);
  }
});
