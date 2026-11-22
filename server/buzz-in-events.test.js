import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './index.js';

const PASSWORD = 'test-password';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startApp() {
  const server = createApplication({ environment: 'development', teacherPassword: PASSWORD }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  async function start() {
    const response = await fetch(`${url}/api/session/start`, { method: 'POST', headers: { cookie } });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }
  async function enter(studentId, groupId) {
    const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, groupId }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }
  async function connect(studentId) {
    const response = await fetch(`${url}/api/events${studentId === undefined ? '' : `?studentId=${studentId}`}`);
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const split = buffer.indexOf('\n\n');
        if (split !== -1) { const block = buffer.slice(0, split); buffer = buffer.slice(split + 2); return block; }
        let timer;
        const result = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE timeout')), deadline - Date.now()); })]).finally(() => clearTimeout(timer));
        if (result.done) throw new Error('SSE stream closed');
        buffer += decoder.decode(result.value, { stream: true });
      }
      throw new Error('SSE timeout');
    }
    assert.equal(await next(), 'retry: 3000');
    return { next, close: () => reader.cancel() };
  }
  async function submit(questionId = 1, answer = 'answer', studentId = 'student-01') {
    const response = await fetch(`${url}/api/student/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, questionId, answers: [answer] }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  }
  return { server, url, enter, connect, start, submit };
}

async function closeServer(server) { await new Promise((resolve) => server.close(resolve)); }

test('events without studentId retain phase and heartbeat only; invalid entries are rejected before SSE', async () => {
  const { server, url, connect } = await startApp();
  try {
    const badFormat = await fetch(`${url}/api/events?studentId=bad!`);
    assert.equal(badFormat.status, 400);
    assert.equal((await badFormat.json()).error.code, 'INVALID_STUDENT_ID');
    const missing = await fetch(`${url}/api/events?studentId=student-01`);
    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error.code, 'STUDENT_NOT_ENTERED');
    const publicStream = await connect();
    await publicStream.close();
  } finally { await closeServer(server); }
});

test('submission events go only to current group subscribers and leave public session unchanged', async () => {
  const { server, url, enter, connect, start, submit } = await startApp();
  const streams = [];
  try {
    await enter('student-01', 1); await enter('student-02', 1); await enter('student-03', 2);
    streams.push(await connect('student-01'), await connect('student-02'), await connect('student-03'), await connect());
    await start();
    const before = await fetch(`${url}/api/session`); assert.equal(before.status, 200);
    const beforeBody = await before.json();
    for (const stream of streams) assert.match(await stream.next(), /^event: phase/);
    await submit(1, 'secret answer');
    const [one, two] = await Promise.all([streams[0].next(), streams[1].next()]);
    for (const block of [one, two]) {
      assert.match(block, /^event: submission\ndata: /);
      const data = JSON.parse(block.split('\n')[1].slice(6));
      assert.deepEqual(Object.keys(data).sort(), ['answers', 'questionId', 'submittedAt']);
      assert.equal(data.questionId, 1); assert.deepEqual(data.answers, ['secret answer']);
      assert.equal('rank' in data, false);
    }
    const after = await fetch(`${url}/api/session`); assert.equal(after.status, 200);
    const afterBody = await after.json();
    assert.deepEqual(Object.keys(afterBody.data).sort(), Object.keys(beforeBody.data).sort());
    for (const key of ['phase', 'questionCount', 'groupCount']) assert.equal(afterBody.data[key], beforeBody.data[key]);
    for (const stream of [streams[2], streams[3]]) {
      await assert.rejects(stream.next(300), { message: 'SSE timeout' });
    }
    await streams[0].close();
    await submit(2, 'next answer');
    assert.match(await streams[1].next(), /^event: submission/);
  } finally { await Promise.all(streams.map((stream) => stream.close().catch(() => {}))); await closeServer(server); }
});

test('a student reconnecting after changing groups receives updates for the new group', async () => {
  const { server, enter, connect, start, submit } = await startApp();
  const streams = [];
  try {
    await enter('student-01', 1); await enter('student-02', 1); await enter('student-03', 2);
    streams.push(await connect('student-01'), await connect('student-02'), await connect('student-03'));
    await streams[0].close();
    const changed = await fetch(`http://127.0.0.1:${server.address().port}/api/student/entry`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId: 'student-01', groupId: 2 }) });
    assert.equal(changed.status, 200);
    streams.push(await connect('student-01'));
    await start();
    for (const stream of [streams[1], streams[2], streams[3]]) assert.match(await stream.next(), /^event: phase/);
    await submit();
    assert.match(await streams[2].next(), /^event: submission/);
    assert.match(await streams[3].next(), /^event: submission/);
    await assert.rejects(streams[1].next(300), { message: 'SSE timeout' });
  } finally { await Promise.all(streams.map((stream) => stream.close().catch(() => {}))); await closeServer(server); }
});
