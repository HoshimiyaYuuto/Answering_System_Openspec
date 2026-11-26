// add-countdown-and-reset task 2.1：開始搶答可帶倒數、時間到自動結束、摘要與 phase 事件帶 countdownEndsAt
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';

const PASSWORD = 'test-password';
const json = { 'content-type': 'application/json' };
const START = Date.parse('2026-11-26T01:00:00.000Z');

// 以注入的時鐘與計時器控制倒數，不必真的等待
async function startApp({ environment = 'development' } = {}) {
  let clock = START;
  const timers = [];
  const server = createApplication({
    environment,
    teacherPassword: PASSWORD,
    now: () => clock,
    scheduleTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancelTimeout: (timer) => { timer.cancelled = true; },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function login() {
    const response = await fetch(`${url}/api/teacher/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  function start(cookie, body) {
    return fetch(`${url}/api/session/start`, {
      method: 'POST',
      headers: { cookie, ...(body === undefined ? {} : json) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  const end = (cookie) => fetch(`${url}/api/session/end`, { method: 'POST', headers: { cookie } });
  const summary = async () => (await (await fetch(`${url}/api/session`)).json()).data;

  async function connect() {
    const response = await fetch(`${url}/api/events`);
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
    return { eventsWithin, close: () => reader.cancel() };
  }

  // 讓時鐘前進並觸發到期的計時器
  function advance(milliseconds) {
    clock += milliseconds;
    for (const timer of timers) {
      if (!timer.cancelled && !timer.fired && timer.milliseconds <= clock - START) {
        timer.fired = true;
        timer.callback();
      }
    }
  }

  return { server, url, login, start, end, summary, connect, advance, timers };
}

const close = (server) => new Promise((resolve) => server.close(resolve));

function parse(block) {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null');
  return { event, data };
}

test('starting without a countdown keeps countdownEndsAt null', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    assert.equal((await app.summary()).countdownEndsAt, null);
    const events = await app.connect();
    const response = await app.start(cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.countdownEndsAt, null);
    const [phase] = await events.eventsWithin(300);
    assert.deepEqual({ event: phase.event, phase: phase.data.phase, countdownEndsAt: phase.data.countdownEndsAt }, { event: 'phase', phase: '搶答中', countdownEndsAt: null });
    assert.equal((await app.summary()).countdownEndsAt, null);
    assert.equal(app.timers.length, 0);
    events.close();
  } finally {
    await close(app.server);
  }
});

test('a 60 second countdown is published in the summary and the phase event', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const events = await app.connect();
    const response = await app.start(cookie, { countdownSeconds: 60 });
    assert.equal(response.status, 200);
    const expected = new Date(START + 60_000).toISOString();
    const [phase] = await events.eventsWithin(300);
    assert.equal(phase.data.phase, '搶答中');
    assert.equal(phase.data.countdownEndsAt, expected);
    assert.equal(phase.data.serverTime, new Date(START).toISOString());
    const summary = await app.summary();
    assert.equal(summary.phase, '搶答中');
    assert.equal(summary.countdownEndsAt, expected);
    events.close();
  } finally {
    await close(app.server);
  }
});

test('countdowns outside 10 to 3600 whole seconds are rejected without a phase change', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const events = await app.connect();
    for (const countdownSeconds of [5, 9, 3601, 30.5, '60', true]) {
      const response = await app.start(cookie, { countdownSeconds });
      assert.equal(response.status, 400, `countdownSeconds=${JSON.stringify(countdownSeconds)}`);
      const { error } = await response.json();
      assert.equal(error.code, 'COUNTDOWN_OUT_OF_RANGE');
      assert.equal(error.message, '倒數時間需介於 10 秒到 60 分鐘。');
    }
    assert.equal((await app.summary()).phase, '準備中');
    assert.deepEqual(await events.eventsWithin(300), []);
    for (const countdownSeconds of [10, 3600]) {
      const response = await app.start(cookie, { countdownSeconds });
      assert.equal(response.status, 200);
      assert.equal((await app.end(cookie)).status, 200);
      await fetch(`${app.url}/api/dev/phase/${encodeURIComponent('準備中')}`, { method: 'POST' });
    }
    events.close();
  } finally {
    await close(app.server);
  }
});

test('missing groups or questions are reported before the countdown check', async () => {
  const app = await startApp({ environment: 'production' });
  try {
    const cookie = await app.login();
    const noGroups = await app.start(cookie, { countdownSeconds: 5 });
    assert.equal(noGroups.status, 409);
    assert.equal((await noGroups.json()).error.code, 'NO_GROUPS');
    const generated = await fetch(`${app.url}/api/groups/generate`, { method: 'POST', headers: { cookie, ...json }, body: JSON.stringify({ count: 2 }) });
    assert.equal(generated.status, 200);
    const noQuestions = await app.start(cookie, { countdownSeconds: 5 });
    assert.equal(noQuestions.status, 409);
    assert.equal((await noQuestions.json()).error.code, 'QUESTIONS_REQUIRED');
  } finally {
    await close(app.server);
  }
});

test('the countdown ends the session once and later submissions are rejected', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await fetch(`${app.url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId: 'stu-count-01', groupId: 1 }) });
    assert.equal((await app.start(cookie, { countdownSeconds: 10 })).status, 200);
    const events = await app.connect();
    app.advance(9_999);
    assert.equal((await app.summary()).phase, '搶答中');
    app.advance(1);
    const published = await events.eventsWithin(300);
    assert.equal(published.length, 1);
    assert.equal(published[0].data.phase, '已結束');
    assert.equal(published[0].data.countdownEndsAt, null);
    const summary = await app.summary();
    assert.equal(summary.phase, '已結束');
    assert.equal(summary.countdownEndsAt, null);

    const submission = await fetch(`${app.url}/api/student/submissions`, {
      method: 'POST', headers: json, body: JSON.stringify({ studentId: 'stu-count-01', questionId: 1, answers: ['太晚'] }),
    });
    assert.equal(submission.status, 409);
    assert.equal((await submission.json()).error.code, 'SUBMISSION_NOT_ALLOWED');

    const lateEnd = await app.end(cookie);
    assert.equal(lateEnd.status, 409);
    assert.equal((await lateEnd.json()).error.code, 'INVALID_PHASE_TRANSITION');
    assert.equal((await app.summary()).phase, '已結束');
    assert.deepEqual(await events.eventsWithin(300), []);
    events.close();
  } finally {
    await close(app.server);
  }
});

test('ending before zero cancels the countdown', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    assert.equal((await app.start(cookie, { countdownSeconds: 30 })).status, 200);
    const events = await app.connect();
    assert.equal((await app.end(cookie)).status, 200);
    assert.equal((await app.summary()).countdownEndsAt, null);
    assert.equal(app.timers[0].cancelled, true);
    app.advance(30_000);
    const published = await events.eventsWithin(300);
    assert.deepEqual(published.map(({ data }) => data.phase), ['已結束']);
    events.close();
  } finally {
    await close(app.server);
  }
});

test('a timer left over from an earlier activity does not end a later one', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    assert.equal((await app.start(cookie, { countdownSeconds: 10 })).status, 200);
    const stale = app.timers[0];
    assert.equal((await app.end(cookie)).status, 200);
    await fetch(`${app.url}/api/dev/phase/${encodeURIComponent('準備中')}`, { method: 'POST' });
    assert.equal((await app.start(cookie)).status, 200);
    stale.callback();
    assert.equal((await app.summary()).phase, '搶答中');
  } finally {
    await close(app.server);
  }
});
