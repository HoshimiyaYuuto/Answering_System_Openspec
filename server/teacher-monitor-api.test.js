import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';
import { createSubmissions } from './submissions.js';

const PASSWORD = 'test-password';
const json = { 'content-type': 'application/json' };

async function startApp({ submissions = createSubmissions() } = {}) {
  const server = createApplication({ environment: 'development', teacherPassword: PASSWORD, submissions }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const teacher = (path, options = {}) => fetch(`${url}${path}`, { ...options, headers: { ...options.headers, cookie } });
  return {
    server,
    url,
    teacher,
    async monitor() {
      const response = await teacher('/api/teacher/monitor');
      assert.equal(response.status, 200);
      return (await response.json()).data;
    },
    async generateGroups(count) {
      const response = await teacher('/api/groups/generate', { method: 'POST', headers: json, body: JSON.stringify({ count }) });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    },
    async enter(studentId, groupId) {
      const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId, groupId }) });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    },
    async submit(studentId, questionId, answers) {
      const response = await fetch(`${url}/api/student/submissions`, { method: 'POST', headers: json, body: JSON.stringify({ studentId, questionId, answers }) });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    },
    async phase(action) {
      const response = await teacher(`/api/session/${action}`, { method: 'POST' });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    },
  };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

test('monitor requires teacher login', async () => {
  const { server, url } = await startApp();
  try {
    const response = await fetch(`${url}/api/teacher/monitor`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' } });
  } finally {
    await close(server);
  }
});

test('before starting every group is not submitted for every question', async () => {
  const app = await startApp();
  try {
    await app.generateGroups(3);
    const data = await app.monitor();
    assert.equal(data.phase, '準備中');
    assert.equal(data.groupCount, 3);
    assert.equal(data.questions.length, 50);
    for (const question of data.questions) {
      assert.deepEqual(question.entries, []);
      assert.equal(question.notSubmitted.length, 3);
      assert.equal(question.winner, null);
    }
  } finally {
    await close(app.server);
  }
});

test('places, answers and winner follow arrival order and stay after ending', async () => {
  const app = await startApp();
  try {
    await app.generateGroups(3);
    await app.enter('stu-aaaa1111', 1);
    await app.enter('stu-bbbb2222', 2);
    const summaryBefore = await (await fetch(`${app.url}/api/session`)).json();
    await app.phase('start');
    await app.submit('stu-aaaa1111', 1, ['  甲  ']);
    await app.submit('stu-bbbb2222', 1, ['乙']);
    await app.submit('stu-bbbb2222', 10, ['丙', '丁']);

    const during = await app.monitor();
    const q1 = during.questions.find(({ id }) => id === 1);
    assert.equal(during.phase, '搶答中');
    assert.equal(q1.submittedCount, 2);
    assert.deepEqual(q1.entries.map(({ groupName, place, answers, status }) => [groupName, place, answers, status]), [
      ['第 1 組', 1, ['甲'], 'valid'],
      ['第 2 組', 2, ['乙'], 'valid'],
    ]);
    assert.deepEqual(q1.winner, { groupId: 1, groupName: '第 1 組', answers: ['甲'] });
    assert.deepEqual(q1.notSubmitted, [{ groupId: 3, groupName: '第 3 組' }]);
    assert.deepEqual(during.questions.find(({ id }) => id === 10).winner.answers, ['丙', '丁']);

    const summaryAfterRead = await (await fetch(`${app.url}/api/session`)).json();
    assert.equal(summaryAfterRead.data.phase, '搶答中');
    assert.equal(summaryAfterRead.data.questionCount, summaryBefore.data.questionCount);
    assert.equal(summaryAfterRead.data.groupCount, summaryBefore.data.groupCount);

    await app.phase('end');
    const after = await app.monitor();
    assert.equal(after.phase, '已結束');
    assert.deepEqual(after.questions, during.questions);
  } finally {
    await close(app.server);
  }
});

test('50 groups x 50 questions are monitored within 200 ms', async () => {
  const submissions = createSubmissions();
  const app = await startApp({ submissions });
  try {
    await app.generateGroups(50);
    for (let questionId = 1; questionId <= 50; questionId += 1) {
      const blanksCount = [10, 20, 30, 40, 50].includes(questionId) ? 2 : 1;
      for (let groupId = 1; groupId <= 50; groupId += 1) {
        const result = submissions.submit({ questionId, groupId, answers: Array(blanksCount).fill(`第${groupId}組`), blanksCount });
        assert.equal(result.ok, true);
      }
    }
    await app.monitor();
    const started = performance.now();
    const data = await app.monitor();
    const elapsed = performance.now() - started;
    assert.equal(data.questions.length, 50);
    for (const question of data.questions) {
      assert.equal(question.submittedCount, 50);
      assert.deepEqual(question.entries.map(({ place }) => place), Array.from({ length: 50 }, (_, index) => index + 1));
    }
    assert.ok(elapsed < 200, `monitor took ${elapsed} ms`);
  } finally {
    await close(app.server);
  }
});
