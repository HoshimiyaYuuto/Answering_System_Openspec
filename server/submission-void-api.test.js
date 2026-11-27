// add-submission-void tasks 2.1、2.2：老師作廢端點、作廢通知與本組作答狀態的 voided 欄位
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
          // 在線通知（add-projector-board）另由 presence-api.test.js 驗證，這裡略過
          if (block.startsWith('event: presence\n')) continue;
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
    // 在期限內收集所有事件（心跳間隔 15 秒，不會出現在短時間的收集中）
    async function eventsWithin(ms) {
      const blocks = [];
      for (;;) {
        try {
          blocks.push(parse(await next(ms)));
        } catch (error) {
          if (error.message === 'SSE timeout') return blocks;
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

  function submit(studentId, questionId = 1, answers = ['答案']) {
    return fetch(`${url}/api/student/submissions`, { method: 'POST', headers: json, body: JSON.stringify({ studentId, questionId, answers }) });
  }

  async function submitOk(studentId, questionId = 1, answers = ['答案']) {
    const response = await submit(studentId, questionId, answers);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }

  function voidRequest(cookie, body) {
    return fetch(`${url}/api/teacher/submissions/void`, {
      method: 'POST',
      headers: { ...json, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  async function phase(cookie, action) {
    const response = await fetch(`${url}/api/session/${action}`, { method: 'POST', headers: { cookie } });
    assert.equal(response.status, 200);
  }

  async function monitor(cookie) {
    const response = await fetch(`${url}/api/teacher/monitor`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function own(studentId) {
    const response = await fetch(`${url}/api/student/submissions?studentId=${studentId}`);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  return { server, url, login, connect, enter, submit, submitOk, voidRequest, phase, monitor, own };
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

// 第 2 組（stu-g2）與第 5 組（stu-g5）依序送出第 1 題，回傳已登入的 cookie
async function buzzingWithTwo(app) {
  const cookie = await app.login();
  await app.enter('stu-g2-aaaa', 2);
  await app.enter('stu-g5-aaaa', 5);
  await app.phase(cookie, 'start');
  await app.submitOk('stu-g2-aaaa', 1, ['甲']);
  await app.submitOk('stu-g5-aaaa', 1, ['乙']);
  return cookie;
}

test('void requires a logged-in teacher', async () => {
  const app = await startApp();
  try {
    await buzzingWithTwo(app);
    const response = await app.voidRequest(null, { questionId: 1, rank: 1 });
    assert.deepEqual(await errorOf(response), { status: 401, code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' });
    assert.equal((await app.own('stu-g2-aaaa')).submissions.length, 1);
  } finally {
    await close(app.server);
  }
});

test('void rejects malformed requests with 400 INVALID_VOID_REQUEST', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    for (const body of [{}, { questionId: 1 }, { questionId: '1', rank: 1 }, { questionId: 1, rank: 0 }, { questionId: 1.5, rank: 1 }, { questionId: 1, rank: -1 }]) {
      const { status, code } = await errorOf(await app.voidRequest(cookie, body));
      assert.deepEqual([status, code], [400, 'INVALID_VOID_REQUEST'], JSON.stringify(body));
    }
  } finally {
    await close(app.server);
  }
});

test('void is only allowed while buzzing', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const before = await errorOf(await app.voidRequest(cookie, { questionId: 1, rank: 1 }));
    assert.deepEqual([before.status, before.code], [409, 'VOID_NOT_ALLOWED']);

    await app.enter('stu-g2-aaaa', 2);
    await app.phase(cookie, 'start');
    await app.submitOk('stu-g2-aaaa', 1);
    await app.phase(cookie, 'end');
    const after = await errorOf(await app.voidRequest(cookie, { questionId: 1, rank: 1 }));
    assert.deepEqual([after.status, after.code], [409, 'VOID_NOT_ALLOWED']);
    const [entry] = (await app.monitor(cookie)).questions[0].entries;
    assert.equal(entry.status, 'valid', 'rejected void leaves the record unchanged');
  } finally {
    await close(app.server);
  }
});

test('void reports unknown questions, unknown ranks and repeated voids', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    const unknownQuestion = await errorOf(await app.voidRequest(cookie, { questionId: 999, rank: 1 }));
    assert.deepEqual([unknownQuestion.status, unknownQuestion.code], [404, 'QUESTION_NOT_FOUND']);
    const unknownRank = await errorOf(await app.voidRequest(cookie, { questionId: 1, rank: 3 }));
    assert.deepEqual([unknownRank.status, unknownRank.code], [404, 'SUBMISSION_NOT_FOUND']);
    const noneOnQuestion = await errorOf(await app.voidRequest(cookie, { questionId: 2, rank: 1 }));
    assert.deepEqual([noneOnQuestion.status, noneOnQuestion.code], [404, 'SUBMISSION_NOT_FOUND']);

    assert.equal((await app.voidRequest(cookie, { questionId: 1, rank: 1 })).status, 200);
    await app.submitOk('stu-g2-aaaa', 1, ['重送']);
    const repeated = await errorOf(await app.voidRequest(cookie, { questionId: 1, rank: 1 }));
    assert.deepEqual([repeated.status, repeated.code], [409, 'ALREADY_VOIDED']);
    const entries = (await app.monitor(cookie)).questions[0].entries;
    assert.deepEqual(entries.map(({ groupId, rank, status }) => [groupId, rank, status]), [[2, 1, 'voided'], [5, 2, 'valid'], [2, 3, 'valid']]);
  } finally {
    await close(app.server);
  }
});

test('successful void returns the voided record and moves the winner', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    const response = await app.voidRequest(cookie, { questionId: 1, rank: 1 });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['groupId', 'questionId', 'rank', 'voidedAt']);
    assert.equal(data.questionId, 1);
    assert.equal(data.groupId, 2);
    assert.equal(data.rank, 1);
    assert.match(data.voidedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const question = (await app.monitor(cookie)).questions[0];
    assert.equal(question.submittedCount, 1);
    assert.equal(question.winner.groupId, 5);
    const voided = question.entries.find(({ groupId }) => groupId === 2);
    assert.equal(voided.status, 'voided');
    assert.equal(voided.place, null);
    assert.deepEqual(voided.answers, ['甲']);
  } finally {
    await close(app.server);
  }
});

test('the voided group can resubmit after the current max rank', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    await app.voidRequest(cookie, { questionId: 1, rank: 1 });
    const other = await errorOf(await app.submit('stu-g5-aaaa', 1));
    assert.deepEqual([other.status, other.code], [409, 'ALREADY_SUBMITTED']);
    await app.submitOk('stu-g2-aaaa', 1, ['重送']);
    const question = (await app.monitor(cookie)).questions[0];
    const resent = question.entries.find(({ groupId, status }) => groupId === 2 && status === 'valid');
    assert.equal(resent.rank, 3);
    assert.equal(resent.place, 2);
    assert.equal(question.winner.groupId, 5);
  } finally {
    await close(app.server);
  }
});

test('voided submissions are left out of the results csv', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    await app.voidRequest(cookie, { questionId: 1, rank: 1 });
    await app.phase(cookie, 'end');
    const response = await fetch(`${app.url}/api/teacher/results/csv`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const csv = await response.text();
    assert.doesNotMatch(csv, /甲/);
    assert.match(csv, /1,0,第 5 組,乙,1,是,/);
  } finally {
    await close(app.server);
  }
});

test('void events reach the teacher and the voided group only, without rank', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    await app.enter('stu-g7-aaaa', 7);
    const teacher = await app.connect('?role=teacher', cookie);
    const voidedGroup = await app.connect('?studentId=stu-g2-aaaa');
    const otherGroup = await app.connect('?studentId=stu-g5-aaaa');
    const bystander = await app.connect('?studentId=stu-g7-aaaa');
    const publicChannel = await app.connect();
    try {
      const response = await app.voidRequest(cookie, { questionId: 1, rank: 1 });
      const { voidedAt } = (await response.json()).data;

      const studentEvent = parse(await voidedGroup.next(2000));
      assert.deepEqual(studentEvent, { event: 'void', data: { questionId: 1, voidedAt } });
      assert.equal(parse(await teacher.next(2000)).event, 'monitor');

      const [others, bystanders, publics] = await Promise.all([
        otherGroup.eventsWithin(500),
        bystander.eventsWithin(500),
        publicChannel.eventsWithin(500),
      ]);
      assert.deepEqual([others, bystanders, publics], [[], [], []]);
    } finally {
      await Promise.all([teacher, voidedGroup, otherGroup, bystander, publicChannel].map((connection) => connection.close()));
    }
  } finally {
    await close(app.server);
  }
});

test('a rejected void sends no events', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    const teacher = await app.connect('?role=teacher', cookie);
    const voidedGroup = await app.connect('?studentId=stu-g2-aaaa');
    try {
      assert.equal((await app.voidRequest(cookie, { questionId: 1, rank: 9 })).status, 404);
      const [teacherEvents, studentEvents] = await Promise.all([teacher.eventsWithin(500), voidedGroup.eventsWithin(500)]);
      assert.deepEqual([teacherEvents, studentEvents], [[], []]);
    } finally {
      await Promise.all([teacher.close(), voidedGroup.close()]);
    }
  } finally {
    await close(app.server);
  }
});

// ---- task 2.2：本組作答狀態的 voided ----

test('own submission state lists voided questions until they are resubmitted', async () => {
  const app = await startApp();
  try {
    const cookie = await buzzingWithTwo(app);
    assert.deepEqual((await app.own('stu-g2-aaaa')).voided, []);

    const { voidedAt } = (await (await app.voidRequest(cookie, { questionId: 1, rank: 1 })).json()).data;
    const afterVoid = await app.own('stu-g2-aaaa');
    assert.deepEqual(afterVoid, { submissions: [], voided: [{ questionId: 1, voidedAt }] });
    assert.deepEqual((await app.own('stu-g5-aaaa')).voided, [], 'other groups see no void');
    assert.doesNotMatch(JSON.stringify(afterVoid), /rank|groupId|乙/);

    await app.submitOk('stu-g2-aaaa', 1, ['重送']);
    const afterResend = await app.own('stu-g2-aaaa');
    assert.deepEqual(afterResend.voided, []);
    assert.deepEqual(afterResend.submissions.map(({ questionId, answers }) => [questionId, answers]), [[1, ['重送']]]);
    assert.deepEqual(Object.keys(afterResend.submissions[0]).sort(), ['answers', 'questionId', 'submittedAt']);
  } finally {
    await close(app.server);
  }
});
