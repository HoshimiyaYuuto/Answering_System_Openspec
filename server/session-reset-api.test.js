// add-countdown-and-reset task 2.3：老師在已結束後重設活動、學生連線收到 reset 後關閉
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
    let closed = false;
    async function next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const split = buffer.indexOf('\n\n');
        if (split !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          // 在線通知（add-projector-board）另由 presence-api.test.js 驗證，這裡略過
          if (block.startsWith('event: presence\n')) continue;
          return block;
        }
        if (closed) throw new Error('SSE stream closed');
        let timer;
        const result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE timeout')), deadline - Date.now()); }),
        ]).finally(() => clearTimeout(timer));
        if (result.done) {
          closed = true;
          continue;
        }
        buffer += decoder.decode(result.value, { stream: true });
      }
      throw new Error('SSE timeout');
    }
    // 在期限內收集事件；串流被 server 關閉時回傳 { blocks, closed: true }
    async function eventsWithin(ms) {
      const blocks = [];
      for (;;) {
        try {
          blocks.push(parse(await next(ms)));
        } catch (error) {
          if (error.message === 'SSE timeout') return { blocks, closed: false };
          if (error.message === 'SSE stream closed') return { blocks, closed: true };
          throw error;
        }
      }
    }
    assert.equal(await next(), 'retry: 3000');
    return { eventsWithin, close: () => reader.cancel().catch(() => {}) };
  }

  async function enter(studentId, groupId) {
    const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId, groupId }) });
    assert.equal(response.status, 200);
  }

  function submit(studentId, questionId = 1, answers = ['答案']) {
    return fetch(`${url}/api/student/submissions`, { method: 'POST', headers: json, body: JSON.stringify({ studentId, questionId, answers }) });
  }

  async function submitOk(studentId, questionId = 1, answers = ['答案']) {
    const response = await submit(studentId, questionId, answers);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return (await response.json()).data;
  }

  const control = (cookie, action) => fetch(`${url}/api/session/${action}`, { method: 'POST', headers: cookie ? { cookie } : {} });

  async function phase(cookie, action) {
    const response = await control(cookie, action);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  const summary = async () => (await (await fetch(`${url}/api/session`)).json()).data;

  async function monitor(cookie) {
    const response = await fetch(`${url}/api/teacher/monitor`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function entryOf(studentId) {
    return (await (await fetch(`${url}/api/student/entry?studentId=${studentId}`)).json()).data;
  }

  return { server, url, login, connect, enter, submit, submitOk, control, phase, summary, monitor, entryOf };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

function parse(block) {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null');
  return { event, data };
}

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

// 第 1 組、第 2 組各送出第 1 題後結束，回傳已登入的 cookie
async function endedActivity(app) {
  const cookie = await app.login();
  await app.enter('stu-reset-g1', 1);
  await app.enter('stu-reset-g2', 2);
  await app.phase(cookie, 'start');
  await app.submitOk('stu-reset-g1', 1, ['甲']);
  await app.submitOk('stu-reset-g2', 1, ['乙']);
  await app.phase(cookie, 'end');
  return cookie;
}

test('reset requires a logged-in teacher', async () => {
  const app = await startApp();
  try {
    await endedActivity(app);
    const response = await app.control(undefined, 'reset');
    assert.deepEqual(await errorOf(response), { status: 401, code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' });
    assert.equal((await app.summary()).phase, '已結束');
    assert.equal((await app.entryOf('stu-reset-g1')).valid, true);
  } finally {
    await close(app.server);
  }
});

test('reset is rejected during preparation and buzzing without changing data', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.enter('stu-reset-g1', 1);
    const preparing = await app.control(cookie, 'reset');
    assert.deepEqual(await errorOf(preparing), { status: 409, code: 'INVALID_PHASE_TRANSITION', message: '只能在已結束時重設活動。' });
    await app.phase(cookie, 'start');
    await app.submitOk('stu-reset-g1');
    const buzzing = await app.control(cookie, 'reset');
    assert.equal((await errorOf(buzzing)).code, 'INVALID_PHASE_TRANSITION');
    assert.equal((await app.summary()).phase, '搶答中');
    assert.equal((await app.monitor(cookie)).questions[0].submittedCount, 1);
    assert.equal((await app.entryOf('stu-reset-g1')).valid, true);
  } finally {
    await close(app.server);
  }
});

test('reset returns to preparation, keeps groups, questions and login, and clears the activity', async () => {
  const app = await startApp();
  try {
    const cookie = await endedActivity(app);
    const before = await app.summary();
    const data = await app.phase(cookie, 'reset');
    assert.equal(data.phase, '準備中');
    const after = await app.summary();
    assert.equal(after.phase, '準備中');
    assert.equal(after.groupCount, before.groupCount);
    assert.equal(after.questionCount, before.questionCount);
    assert.equal(after.activityId, null);
    assert.equal(after.countdownEndsAt, null);
    const auth = await (await fetch(`${app.url}/api/teacher/auth`, { headers: { cookie } })).json();
    assert.equal(auth.data.authenticated, true);
    const board = await app.monitor(cookie);
    assert.equal(board.phase, '準備中');
    assert.ok(board.questions.every(({ submittedCount }) => submittedCount === 0));
  } finally {
    await close(app.server);
  }
});

test('voided submissions are cleared by a reset as well', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.enter('stu-reset-g1', 1);
    await app.phase(cookie, 'start');
    await app.submitOk('stu-reset-g1');
    const voided = await fetch(`${app.url}/api/teacher/submissions/void`, {
      method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ questionId: 1, rank: 1 }),
    });
    assert.equal(voided.status, 200);
    await app.phase(cookie, 'end');
    await app.phase(cookie, 'reset');
    await app.enter('stu-reset-g1', 1);
    const own = await (await fetch(`${app.url}/api/student/submissions?studentId=stu-reset-g1`)).json();
    assert.deepEqual(own.data, { submissions: [], voided: [] });
    const board = await app.monitor(cookie);
    assert.ok(board.questions.every(({ submittedCount }) => submittedCount === 0));
  } finally {
    await close(app.server);
  }
});

test('previous entries become activity_reset and student APIs refuse them', async () => {
  const app = await startApp();
  try {
    const cookie = await endedActivity(app);
    await app.phase(cookie, 'reset');
    assert.deepEqual(await app.entryOf('stu-reset-g1'), { valid: false, studentId: 'stu-reset-g1', reason: 'activity_reset' });
    assert.equal((await app.entryOf('stu-never-entered')).reason, 'entry_reset');
    assert.equal((await errorOf(await app.submit('stu-reset-g1'))).code, 'STUDENT_NOT_ENTERED');
    const questions = await fetch(`${app.url}/api/student/questions?studentId=stu-reset-g1`);
    assert.equal((await errorOf(questions)).code, 'STUDENT_NOT_ENTERED');
    const events = await fetch(`${app.url}/api/events?studentId=stu-reset-g1`);
    assert.equal((await errorOf(events)).code, 'STUDENT_NOT_ENTERED');
  } finally {
    await close(app.server);
  }
});

test('student streams receive reset and are closed; teacher and anonymous streams stay open', async () => {
  const app = await startApp();
  try {
    const cookie = await endedActivity(app);
    const student = await app.connect('?studentId=stu-reset-g1');
    const teacher = await app.connect('?role=teacher', cookie);
    const anonymous = await app.connect();
    const startedAt = Date.now();
    await app.phase(cookie, 'reset');

    const studentEvents = await student.eventsWithin(2000);
    assert.ok(Date.now() - startedAt < 2000);
    assert.equal(studentEvents.closed, true);
    assert.equal(studentEvents.blocks.length, 1);
    assert.equal(studentEvents.blocks[0].event, 'reset');
    assert.deepEqual(Object.keys(studentEvents.blocks[0].data), ['serverTime']);

    for (const stream of [teacher, anonymous]) {
      const { blocks, closed } = await stream.eventsWithin(500);
      assert.equal(closed, false);
      assert.deepEqual(blocks.map(({ event, data }) => [event, data.phase]), [['phase', '準備中']]);
      stream.close();
    }
  } finally {
    await close(app.server);
  }
});

test('starting again after a reset begins a fresh activity', async () => {
  const app = await startApp();
  try {
    const cookie = await endedActivity(app);
    const { activityId: previous } = await app.summary();
    await app.phase(cookie, 'reset');
    await app.enter('stu-reset-g2', 2);
    await app.phase(cookie, 'start');
    const { activityId } = await app.summary();
    assert.ok(activityId);
    assert.notEqual(activityId, previous);
    await app.submitOk('stu-reset-g2', 1, ['新的一場']);
    const board = await app.monitor(cookie);
    const first = board.questions.find(({ id }) => id === 1);
    assert.equal(first.submittedCount, 1);
    assert.equal(JSON.stringify(board).includes('甲'), false);
  } finally {
    await close(app.server);
  }
});

test('a second reset is rejected because the activity is already in preparation', async () => {
  const app = await startApp();
  try {
    const cookie = await endedActivity(app);
    const [first, second] = await Promise.all([app.control(cookie, 'reset'), app.control(cookie, 'reset')]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const rejected = first.status === 409 ? first : second;
    assert.equal((await errorOf(rejected)).code, 'INVALID_PHASE_TRANSITION');
    assert.equal((await app.summary()).phase, '準備中');
  } finally {
    await close(app.server);
  }
});
