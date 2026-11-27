import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './index.js';

const TEST_PASSWORD = 'test-password';

async function startApp(environment = 'development') {
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
  const loginBody = await login.clone().text();
  assert.equal(login.status, 200, loginBody);
  const teacher = login.headers.get('set-cookie').split(';')[0];
  const postTeacher = (path) => fetch(`${url}${path}`, { method: 'POST', headers: { cookie: teacher } });
  return { server, url, postTeacher };
}

async function expectStatus(responsePromise, expectedStatus) {
  const response = await responsePromise;
  assert.equal(response.status, expectedStatus, await response.clone().text());
  return response;
}

async function enter(url, studentId, groupId) {
  return expectStatus(fetch(`${url}/api/student/entry`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId, groupId }),
  }), 200);
}

async function setPhase(url, phase) {
  return expectStatus(fetch(`${url}/api/dev/phase/${encodeURIComponent(phase)}`, { method: 'POST' }), 200);
}

async function getResults(url, studentId) {
  return fetch(`${url}/api/student/results?studentId=${encodeURIComponent(studentId)}`);
}

async function submit(url, studentId, questionId, answers) {
  return expectStatus(fetch(`${url}/api/student/submissions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId, questionId, answers }),
  }), 200);
}

test('student results enforce entry before phase and are available only after end', async () => {
  const { server, url } = await startApp();
  try {
    const malformed = await expectStatus(getResults(url, 'bad!'), 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_STUDENT_ID');

    const notEntered = await expectStatus(getResults(url, 'student-99'), 403);
    assert.equal((await notEntered.json()).error.code, 'STUDENT_NOT_ENTERED');

    await enter(url, 'student-01', 1);
    let preparing = await expectStatus(getResults(url, 'student-01'), 409);
    let preparingBody = await preparing.json();
    assert.equal(preparingBody.error.code, 'RESULTS_NOT_AVAILABLE');
    assert.equal('data' in preparingBody, false);
    assert.equal('questions' in preparingBody, false);

    await setPhase(url, '搶答中');
    const buzzer = await expectStatus(getResults(url, 'student-01'), 409);
    const buzzerBody = await buzzer.json();
    assert.equal(buzzerBody.error.code, 'RESULTS_NOT_AVAILABLE');
    assert.equal('data' in buzzerBody, false);
    assert.equal('questions' in buzzerBody, false);

    await setPhase(url, '已結束');
    const ended = await expectStatus(getResults(url, 'student-01'), 200);
    const endedBody = await ended.json();
    assert.equal(endedBody.data.questions.length, 50);
    assert.equal(endedBody.data.questions.every(({ winner, own }) => winner === null && own === null), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('student results share winners while returning each group own result only', async () => {
  const { server, url, postTeacher } = await startApp();
  try {
    await enter(url, 'student-01', 1);
    await enter(url, 'student-01b', 1);
    await enter(url, 'student-02', 2);
    await expectStatus(postTeacher('/api/session/start'), 200);

    await submit(url, 'student-01', 1, ['group one wins']);
    await submit(url, 'student-02', 1, ['group two private losing answer']);
    await submit(url, 'student-02', 2, ['group two wins only here']);
    await submit(url, 'student-01', 10, ['first blank', 'second blank']);
    await expectStatus(postTeacher('/api/session/end'), 200);

    const firstResponse = await expectStatus(getResults(url, 'student-01'), 200);
    const secondResponse = await expectStatus(getResults(url, 'student-02'), 200);
    const sameGroupResponse = await expectStatus(getResults(url, 'student-01b'), 200);
    const firstResults = (await firstResponse.json()).data.questions;
    const secondResults = (await secondResponse.json()).data.questions;
    const sameGroupResults = (await sameGroupResponse.json()).data.questions;

    assert.equal(firstResults.length, 50);
    assert.deepEqual(firstResults.map(({ questionId }) => questionId), Array.from({ length: 50 }, (_, index) => index + 1));
    assert.deepEqual(firstResults, sameGroupResults);

    assert.deepEqual(firstResults[0].winner, secondResults[0].winner);
    assert.deepEqual(firstResults[0].winner, { groupName: '第 1 組', answers: ['group one wins'], byFairRanking: false });
    assert.deepEqual(firstResults[0].own, { place: 1, isWinner: true, answers: ['group one wins'] });
    assert.deepEqual(secondResults[0].own, { place: 2, isWinner: false, answers: ['group two private losing answer'] });

    assert.equal(firstResults[1].own, null);
    assert.deepEqual(firstResults[1].winner, { groupName: '第 2 組', answers: ['group two wins only here'], byFairRanking: false });
    assert.equal(firstResults[2].winner, null);
    assert.equal(firstResults[2].own, null);
    assert.deepEqual(firstResults[9].winner.answers, ['first blank', 'second blank']);
    assert.deepEqual(firstResults[9].own.answers, ['first blank', 'second blank']);

    const serialized = JSON.stringify(firstResults);
    for (const forbidden of ['rank', 'groupId', 'placings', 'settled', 'winnerSource', 'group two private losing answer']) {
      assert.equal(serialized.includes(forbidden), false, `response unexpectedly contained ${forbidden}`);
    }
    assert.equal(serialized.includes('group one wins'), true);
    assert.equal(serialized.includes('group two wins only here'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
