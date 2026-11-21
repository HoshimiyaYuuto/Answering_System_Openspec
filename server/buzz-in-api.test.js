import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './index.js';

const TEST_PASSWORD = 'test-password';

async function startApp(environment = 'test') {
  const server = createApplication({ environment, teacherPassword: TEST_PASSWORD }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const teacher = login.headers.get('set-cookie').split(';')[0];
  const postTeacher = async (path) => {
    if (path === '/api/session/start') {
      await fetch(`${url}/api/groups/generate`, { method: 'POST', headers: { cookie: teacher, 'content-type': 'application/json' }, body: JSON.stringify({ count: 1 }) });
    }
    return fetch(`${url}${path}`, { method: 'POST', headers: { cookie: teacher } });
  };
  return { server, url, postTeacher };
}

async function enter(url, studentId = 'student-01') {
  return fetch(`${url}/api/student/entry`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId, groupId: 1 }),
  });
}

test('student questions enforce entry and availability checks', async () => {
  const { server, url, postTeacher } = await startApp('development');
  try {
    const malformed = await fetch(`${url}/api/student/questions?studentId=bad!`);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_STUDENT_ID');
    const notEntered = await fetch(`${url}/api/student/questions?studentId=student-01`);
    assert.equal(notEntered.status, 403);
    assert.equal((await notEntered.json()).error.code, 'STUDENT_NOT_ENTERED');
    await enter(url);
    const preparing = await fetch(`${url}/api/student/questions?studentId=student-01`);
    assert.equal(preparing.status, 409);
    assert.equal((await preparing.json()).error.code, 'QUESTIONS_NOT_AVAILABLE');
    assert.equal((await postTeacher('/api/session/start')).status, 200);
    assert.equal((await fetch(`${url}/api/student/questions?studentId=student-01`)).status, 200);
    assert.equal((await postTeacher('/api/session/end')).status, 200);
    assert.equal((await fetch(`${url}/api/student/questions?studentId=student-01`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('student questions expose only the documented whitelist and allow an empty list', async () => {
  const { server, url, postTeacher } = await startApp('development');
  try {
    await enter(url);
    await postTeacher('/api/session/start');
    const response = await fetch(`${url}/api/student/questions?studentId=student-01`);
    const questions = (await response.json()).data.questions;
    assert.deepEqual(Object.keys(questions[0]).sort(), ['blanks', 'id']);
    assert.deepEqual(Object.keys(questions[0].blanks[0]).sort(), ['index', 'prefix', 'prompt']);
    for (const question of questions) {
      assert.equal('prompt' in question, false);
      assert.equal('anchorCell' in question, false);
      assert.equal('answerCell' in question, false);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('development seeds 50 questions with five two-blank groups; production has none', async () => {
  const dev = createApplication({ environment: 'development', teacherPassword: TEST_PASSWORD });
  const devServer = dev.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { devServer.once('listening', resolve); devServer.once('error', reject); });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${devServer.address().port}/api/session`).then((response) => response.json())).data.questionCount, 50);
  } finally {
    await new Promise((resolve) => devServer.close(resolve));
  }

  const { server, url } = await startApp('production');
  try {
    assert.equal((await fetch(`${url}/api/session`).then((response) => response.json())).data.questionCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('development public question seed has the required single and grouped shapes', async () => {
  const { server, url, postTeacher } = await startApp('development');
  try {
    await enter(url);
    await postTeacher('/api/session/start');
    const questions = (await fetch(`${url}/api/student/questions?studentId=student-01`).then((response) => response.json())).data.questions;
    assert.equal(questions.length, 50);
    for (const question of questions) {
      assert.equal(question.blanks.length, [10, 20, 30, 40, 50].includes(question.id) ? 2 : 1);
      if (question.blanks.length === 2) assert.deepEqual(question.blanks.map(({ prefix }) => prefix), ['（1）', '（2）']);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
