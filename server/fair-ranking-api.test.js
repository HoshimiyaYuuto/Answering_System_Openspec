// add-fair-ranking task 2.1、2.2：開始時設定公平順位、所有結果呼叫端共用判定、3 秒批次結束通知老師
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from './index.js';

const PASSWORD = 'test-password';
const json = { 'content-type': 'application/json' };
const START = Date.parse('2026-11-27T01:00:00.000Z');

// 以注入的時鐘與計時器控制時間；送出時間也由同一個時鐘產生
async function startApp() {
  let clock = START;
  const timers = [];
  const server = createApplication({
    environment: 'development',
    teacherPassword: PASSWORD,
    now: () => clock,
    scheduleTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, dueAt: clock + milliseconds, cancelled: false, fired: false };
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

  async function startOk(cookie, body) {
    const response = await start(cookie, body);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  const control = (cookie, action) => fetch(`${url}/api/session/${action}`, { method: 'POST', headers: { cookie } });
  const summary = async () => (await (await fetch(`${url}/api/session`)).json()).data;

  async function enter(studentId, groupId) {
    const response = await fetch(`${url}/api/student/entry`, { method: 'PUT', headers: json, body: JSON.stringify({ studentId, groupId }) });
    assert.equal(response.status, 200);
  }

  async function submitOk(studentId, questionId, answers = [`${studentId} 第 ${questionId} 題`]) {
    const response = await fetch(`${url}/api/student/submissions`, { method: 'POST', headers: json, body: JSON.stringify({ studentId, questionId, answers }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return (await response.json()).data;
  }

  async function voidOk(cookie, questionId, rank) {
    const response = await fetch(`${url}/api/teacher/submissions/void`, {
      method: 'POST', headers: { cookie, ...json }, body: JSON.stringify({ questionId, rank }),
    });
    assert.equal(response.status, 200);
  }

  async function monitor(cookie) {
    const response = await fetch(`${url}/api/teacher/monitor`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function csvRows(cookie) {
    const response = await fetch(`${url}/api/teacher/results/csv`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const text = await response.text();
    return text.replace(/^﻿/, '').split('\r\n').slice(1, -1).map((line) => line.split(','));
  }

  async function studentResults(studentId) {
    const response = await fetch(`${url}/api/student/results?studentId=${studentId}`);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function connect(cookie) {
    const response = await fetch(`${url}/api/events${cookie ? '?role=teacher' : ''}`, { headers: cookie ? { cookie } : {} });
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
        // 逾時後未完成的 read 要留給下一次使用，否則之後送達的事件會被丟掉
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
          if (error.message === 'SSE timeout') return blocks;
          throw error;
        }
      }
    }
    assert.equal(await next(2000), 'retry: 3000');
    return { eventsWithin, close: () => reader.cancel().catch(() => {}) };
  }

  // 讓時鐘前進並依到期順序觸發計時器（觸發時可能再排新的計時器）
  function advance(milliseconds) {
    const target = clock + milliseconds;
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && !timer.fired && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!due) break;
      clock = Math.max(clock, due.dueAt);
      due.fired = true;
      due.callback();
    }
    clock = target;
  }

  const activeTimers = () => timers.filter((timer) => !timer.cancelled && !timer.fired);

  return {
    server, login, start, startOk, control, summary, enter, submitOk, voidOk, monitor, csvRows, studentResults, connect, advance, timers, activeTimers,
  };
}

// 斷言失敗時 SSE 連線可能沒關，強制關閉避免測試卡住
const close = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });

function parse(block) {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? 'null');
  return { event, data };
}

const questionOf = (monitorData, id) => monitorData.questions.find((question) => question.id === id);

// 第 1 組先贏第 1、2 題（每題間隔超過 3 秒）；第 3 題第 1 組先送、第 2 組 1 秒內再送
async function playTwoWinsThenRace(app) {
  await app.enter('stu-fair-g1', 1);
  await app.enter('stu-fair-g2', 2);
  await app.submitOk('stu-fair-g1', 1);
  app.advance(5000);
  await app.submitOk('stu-fair-g1', 2);
  app.advance(5000);
  await app.submitOk('stu-fair-g1', 3);
  app.advance(800);
  await app.submitOk('stu-fair-g2', 3);
}

test('fair ranking defaults to false and is reported in summary, start response and phase event', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    assert.equal((await app.summary()).fairRankingEnabled, false);
    const events = await app.connect();
    const started = await app.startOk(cookie, { fairRankingEnabled: true });
    assert.equal(started.fairRankingEnabled, true);
    assert.equal((await app.summary()).fairRankingEnabled, true);
    const [phase] = await events.eventsWithin(300);
    assert.equal(phase.event, 'phase');
    assert.equal(phase.data.fairRankingEnabled, true);
    events.close();
  } finally {
    await close(app.server);
  }
});

test('starting without a body leaves fair ranking disabled', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    assert.equal((await app.startOk(cookie)).fairRankingEnabled, false);
    assert.equal((await app.summary()).fairRankingEnabled, false);
  } finally {
    await close(app.server);
  }
});

test('a non-boolean fair ranking setting is rejected and the phase stays ready', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    for (const value of ['yes', 1, null]) {
      const response = await app.start(cookie, { fairRankingEnabled: value });
      assert.equal(response.status, 400);
      assert.deepEqual((await response.json()).error, { code: 'INVALID_FAIR_RANKING', message: '公平順位設定必須是是或否。' });
      assert.equal((await app.summary()).phase, '準備中');
    }
  } finally {
    await close(app.server);
  }
});

test('countdown is checked before fair ranking', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    const response = await app.start(cookie, { countdownSeconds: 5, fairRankingEnabled: 'yes' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'COUNTDOWN_OUT_OF_RANGE');
  } finally {
    await close(app.server);
  }
});

test('reset turns fair ranking back off', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    assert.equal((await app.control(cookie, 'end')).status, 200);
    assert.equal((await app.summary()).fairRankingEnabled, true);
    assert.equal((await app.control(cookie, 'reset')).status, 200);
    assert.equal((await app.summary()).fairRankingEnabled, false);
  } finally {
    await close(app.server);
  }
});

test('fair ranking re-judges the third question for monitor, csv and student results', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await playTwoWinsThenRace(app);
    assert.equal((await app.control(cookie, 'end')).status, 200);

    const monitored = await app.monitor(cookie);
    const third = questionOf(monitored, 3);
    assert.equal(third.settled, true);
    assert.equal(third.winner.groupId, 2);
    assert.equal(third.winnerSource, 'fair');
    assert.equal(questionOf(monitored, 1).winnerSource, 'arrival');

    const rows = await app.csvRows(cookie);
    const thirdRows = rows.filter(([questionId]) => questionId === '3');
    const byGroup = Object.fromEntries(thirdRows.map((row) => [row[2], row]));
    assert.equal(byGroup['第 2 組'][4], '1');
    assert.equal(byGroup['第 2 組'][5], '是');
    assert.equal(byGroup['第 1 組'][4], '2');
    assert.ok(thirdRows.every((row) => row[7] === '是（改判）'));
    assert.ok(rows.filter(([questionId]) => questionId !== '3').every((row) => row[7] === '是'));

    const own = await app.studentResults('stu-fair-g1');
    assert.equal(own.fairRankingEnabled, true);
    const ownThird = own.questions.find(({ questionId }) => questionId === 3);
    assert.equal(ownThird.winner.byFairRanking, true);
    assert.equal(ownThird.winner.groupName, '第 2 組');
    assert.deepEqual({ place: ownThird.own.place, isWinner: ownThird.own.isWinner }, { place: 2, isWinner: false });
    assert.equal(own.questions.find(({ questionId }) => questionId === 1).winner.byFairRanking, false);
    const serialized = JSON.stringify(own);
    for (const hidden of ['"rank"', '"groupId"', 'placings', 'winnerSource']) assert.equal(serialized.includes(hidden), false, hidden);
  } finally {
    await close(app.server);
  }
});

test('a question is judging within its batch while answering and judged after ending', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await app.enter('stu-fair-g1', 1);
    await app.submitOk('stu-fair-g1', 1);
    app.advance(900);
    const during = questionOf(await app.monitor(cookie), 1);
    assert.equal(during.settled, false);
    assert.equal(during.winner, null);
    assert.equal((await app.control(cookie, 'end')).status, 200);
    const after = questionOf(await app.monitor(cookie), 1);
    assert.equal(after.settled, true);
    assert.equal(after.winner.groupId, 1);
  } finally {
    await close(app.server);
  }
});

test('without fair ranking existing results are unchanged and csv says 否', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie);
    await playTwoWinsThenRace(app);
    assert.equal(questionOf(await app.monitor(cookie), 3).settled, true);
    assert.equal((await app.control(cookie, 'end')).status, 200);
    const third = questionOf(await app.monitor(cookie), 3);
    assert.equal(third.winner.groupId, 1);
    assert.equal(third.winnerSource, 'arrival');
    assert.ok((await app.csvRows(cookie)).every((row) => row[7] === '否'));
    const own = await app.studentResults('stu-fair-g1');
    assert.equal(own.fairRankingEnabled, false);
    assert.ok(own.questions.filter(({ winner }) => winner).every(({ winner }) => winner.byFairRanking === false));
  } finally {
    await close(app.server);
  }
});

// ---- 2.2 批次結束通知 ----

test('a batch notice timer is scheduled 3050 ms after the first submission and notifies teachers', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await app.enter('stu-fair-g1', 1);
    const teacher = await app.connect(cookie);
    const student = await app.connect();
    const { submittedAt } = await app.submitOk('stu-fair-g1', 1);
    const timers = app.activeTimers();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].dueAt, Date.parse(submittedAt) + 3050);
    const onSubmit = await teacher.eventsWithin(300);
    assert.deepEqual(onSubmit.map(({ event }) => event), ['monitor']);

    app.advance(3050);
    const onBatch = await teacher.eventsWithin(300);
    assert.deepEqual(onBatch.map(({ event }) => event), ['monitor']);
    assert.equal(JSON.stringify(onBatch[0].data).includes('答案'), false);
    assert.deepEqual((await student.eventsWithin(200)).filter(({ event }) => event === 'monitor'), []);
    const judged = questionOf(await app.monitor(cookie), 1);
    assert.equal(judged.settled, true);
    assert.equal(judged.winner.groupId, 1);
    assert.equal(app.activeTimers().length, 0);
    teacher.close();
    student.close();
  } finally {
    await close(app.server);
  }
});

test('two pending questions are notified one after another', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await app.enter('stu-fair-g1', 1);
    const first = await app.submitOk('stu-fair-g1', 1);
    app.advance(1000);
    const second = await app.submitOk('stu-fair-g1', 2);
    assert.equal(app.activeTimers().length, 1);
    assert.equal(app.activeTimers()[0].dueAt, Date.parse(first.submittedAt) + 3050);
    app.advance(2100);
    const next = app.activeTimers();
    assert.equal(next.length, 1);
    assert.equal(next[0].dueAt, Date.parse(second.submittedAt) + 3050);
    app.advance(1000);
    assert.equal(app.activeTimers().length, 0);
  } finally {
    await close(app.server);
  }
});

test('voiding reschedules the batch notice', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await app.enter('stu-fair-g1', 1);
    await app.enter('stu-fair-g2', 2);
    await app.submitOk('stu-fair-g1', 1);
    app.advance(2000);
    const later = await app.submitOk('stu-fair-g2', 1);
    assert.equal(app.activeTimers().length, 1);
    await app.voidOk(cookie, 1, 1);
    const timers = app.activeTimers();
    assert.equal(timers.length, 1);
    // 第一個有效作答變成第 2 組那筆，批次結束時間往後移
    assert.equal(timers[0].dueAt, Date.parse(later.submittedAt) + 3050);
  } finally {
    await close(app.server);
  }
});

test('ending cancels the batch notice timer', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie, { fairRankingEnabled: true });
    await app.enter('stu-fair-g1', 1);
    await app.submitOk('stu-fair-g1', 1);
    const [timer] = app.activeTimers();
    assert.equal((await app.control(cookie, 'end')).status, 200);
    assert.equal(timer.cancelled, true);
    assert.equal(app.activeTimers().length, 0);
  } finally {
    await close(app.server);
  }
});

test('no batch notice timer without fair ranking', async () => {
  const app = await startApp();
  try {
    const cookie = await app.login();
    await app.startOk(cookie);
    await app.enter('stu-fair-g1', 1);
    const teacher = await app.connect(cookie);
    await app.submitOk('stu-fair-g1', 1);
    assert.equal(app.timers.length, 0);
    assert.deepEqual((await teacher.eventsWithin(300)).map(({ event }) => event), ['monitor']);
    app.advance(5000);
    assert.deepEqual(await teacher.eventsWithin(300), []);
    teacher.close();
  } finally {
    await close(app.server);
  }
});
