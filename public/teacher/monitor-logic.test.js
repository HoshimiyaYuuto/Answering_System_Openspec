import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMonitorState, formatLocalTime, getMonitorView, reduceMonitor } from './monitor-logic.js';

function apply(state, ...events) {
  return events.reduce(reduceMonitor, state);
}

const SUBMITTED_AT = '2026-11-22T01:02:03.000Z';

function question(overrides = {}) {
  return {
    id: 1,
    prompt: '水的化學式是',
    settled: true,
    winner: { groupId: 1, groupName: '第 1 組', answers: ['H2O'] },
    winnerSource: 'arrival',
    submittedCount: 2,
    entries: [
      { groupId: 1, groupName: '第 1 組', rank: 1, status: 'valid', place: 1, answers: ['H2O'], submittedAt: SUBMITTED_AT },
      { groupId: 2, groupName: '第 2 組', rank: 2, status: 'valid', place: 2, answers: ['水', '冰'], submittedAt: SUBMITTED_AT },
    ],
    notSubmitted: [{ groupId: 3, groupName: '第 3 組' }],
    ...overrides,
  };
}

function view(phase, questions = [question()], groupCount = 3) {
  return getMonitorView({ ...createMonitorState(), data: { phase, groupCount, questions } });
}

test('changed requests a fetch when idle', () => {
  const state = apply(createMonitorState(), { type: 'changed' });
  assert.equal(state.wantsRequest, true);
  const requested = apply(state, { type: 'requestMonitor' });
  assert.equal(requested.loading, true);
  assert.equal(requested.wantsRequest, false);
  assert.equal(requested.requestSeq, 1);
});

test('many changes while loading lead to exactly one follow-up fetch', () => {
  let state = apply(createMonitorState(), { type: 'requestMonitor' }, { type: 'changed' }, { type: 'changed' }, { type: 'changed' });
  assert.equal(state.wantsRequest, false);
  assert.equal(state.dirty, true);
  state = apply(state, { type: 'monitorLoaded', seq: 1, data: { phase: '搶答中' } });
  assert.equal(state.wantsRequest, true);
  state = apply(state, { type: 'requestMonitor' }, { type: 'monitorLoaded', seq: 2, data: { phase: '搶答中' } });
  assert.equal(state.wantsRequest, false);
  assert.equal(state.loading, false);
});

test('stale responses are discarded', () => {
  const state = apply(
    createMonitorState(),
    { type: 'requestMonitor' },
    { type: 'monitorLoaded', seq: 1, data: { phase: '準備中' } },
    { type: 'requestMonitor' },
    { type: 'monitorLoaded', seq: 1, data: { phase: '已結束' } },
  );
  assert.equal(state.data.phase, '準備中');
  assert.equal(state.loading, true);
  const latest = apply(state, { type: 'monitorLoaded', seq: 2, data: { phase: '搶答中' } });
  assert.equal(latest.data.phase, '搶答中');
});

test('failed fetch keeps previous data and still honours pending changes', () => {
  let state = apply(createMonitorState(), { type: 'requestMonitor' }, { type: 'monitorLoaded', seq: 1, data: { phase: '搶答中' } });
  state = apply(state, { type: 'requestMonitor' }, { type: 'changed' }, { type: 'monitorFailed', seq: 2 });
  assert.equal(state.data.phase, '搶答中');
  assert.equal(state.loading, false);
  assert.equal(state.wantsRequest, true);
});

test('reset clears data', () => {
  const state = apply(createMonitorState(), { type: 'requestMonitor' }, { type: 'monitorLoaded', seq: 1, data: { phase: '搶答中' } }, { type: 'reset' });
  assert.deepEqual(state, createMonitorState());
});

test('before loading and during preparation only a hint is shown', () => {
  assert.deepEqual(getMonitorView(createMonitorState()), { title: '作答監看', hint: '讀取中…', rows: [] });
  assert.deepEqual(view('準備中'), { title: '作答監看', hint: '開始搶答後會顯示各組作答。', rows: [] });
  assert.equal(view('搶答中', []).hint, '尚未匯入題目。');
});

test('while buzzing each row shows submitted count and the first place', () => {
  const { title, rows } = view('搶答中');
  assert.equal(title, '作答監看');
  assert.equal(rows[0].label, '第 1 題');
  assert.equal(rows[0].prompt, '水的化學式是');
  assert.equal(rows[0].summary, '已送出 2／3 組，第 1 名：第 1 組 「H2O」');
  assert.equal(view('搶答中', [question({ winner: null, submittedCount: 0, entries: [] })]).rows[0].summary, '已送出 0／3 組');
});

test('after ending the title becomes results and shows winner or no answer', () => {
  const ended = view('已結束', [question(), question({ id: 3, winner: null, winnerSource: null, submittedCount: 0, entries: [] })]);
  assert.equal(ended.title, '搶答結果');
  assert.equal(ended.rows[0].summary, '第 1 組 「H2O」');
  assert.equal(ended.rows[1].summary, '無人作答');
});

test('unsettled questions show judging instead of a winner', () => {
  const unsettled = question({ settled: false, winner: null, winnerSource: null });
  assert.equal(view('已結束', [unsettled]).rows[0].summary, '判定中');
  assert.equal(view('搶答中', [unsettled]).rows[0].summary, '已送出 2／3 組，判定中');
});

test('details list places, voided entries, answers, local time and groups not submitted', () => {
  const voided = question({
    entries: [
      { groupId: 1, groupName: '第 1 組', rank: 1, status: 'voided', place: null, answers: ['錯'], submittedAt: SUBMITTED_AT },
      { groupId: 2, groupName: '第 2 組', rank: 2, status: 'valid', place: 1, answers: ['水', '冰'], submittedAt: SUBMITTED_AT },
    ],
  });
  const time = formatLocalTime(SUBMITTED_AT);
  assert.match(time, /^\d{2}:\d{2}:03$/);
  assert.deepEqual(view('搶答中', [voided]).rows[0].details, [
    { text: `已作廢　第 1 組　「錯」　${time}`, voided: true },
    { text: `第 1 名　第 2 組　「水／冰」　${time}`, voided: false },
    { text: '未送出：第 3 組', voided: false },
  ]);
});

test('invalid timestamps render as an empty time', () => {
  assert.equal(formatLocalTime('not-a-date'), '');
});
