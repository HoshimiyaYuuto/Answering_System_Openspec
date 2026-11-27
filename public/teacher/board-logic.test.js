// add-projector-board task 2.1
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoardState, getBoardView, reduceBoard, LOGIN_REQUIRED_MESSAGE, NOT_REVEALED_TEXT } from './board-logic.js';

const NOW = Date.parse('2026-11-27T01:00:00.000Z');

function apply(state, ...events) {
  return events.reduce(reduceBoard, state);
}

const summary = (phase, extra = {}) => ({ phase, countdownEndsAt: null, fairRankingEnabled: false, serverTime: 'x', ...extra });
const groups = [
  { id: 1, name: '第 1 組', online: true },
  { id: 2, name: '第 2 組', online: false },
  { id: 3, name: '第 3 組', online: true },
];

function question(id, winner = null, extra = {}) {
  return {
    id,
    settled: true,
    winner,
    winnerSource: winner ? 'arrival' : null,
    submittedCount: winner ? 1 : 0,
    entries: winner ? [{ groupId: 1, groupName: winner.groupName, rank: 1, status: 'valid', place: 1, answers: winner.answers, submittedAt: 'x' }] : [],
    notSubmitted: [],
    ...extra,
  };
}

const endedQuestions = [
  question(3, { groupId: 2, groupName: '第 2 組', answers: ['牛頓'] }, { winnerSource: 'fair' }),
  question(1, { groupId: 1, groupName: '第 1 組', answers: ['H2O'] }),
  question(2),
  question(10, { groupId: 1, groupName: '第 1 組', answers: ['臺北', '新北'] }),
];

function loggedIn() {
  return apply(createBoardState(), { type: 'authChecked', authenticated: true });
}

// 讀到某階段的摘要後，模擬請求與回應完成
function inPhase(phase, extra = {}) {
  let state = apply(loggedIn(), { type: 'summaryLoaded', summary: summary(phase, extra) });
  if (state.presence.wantsRequest) {
    state = apply(state, { type: 'requestPresence' });
    state = apply(state, { type: 'presenceLoaded', seq: state.presence.seq, groups });
  }
  if (state.results.wantsRequest) {
    state = apply(state, { type: 'requestResults' });
    state = apply(state, { type: 'resultsLoaded', seq: state.results.seq, questions: endedQuestions });
  }
  return state;
}

test('checking, logged out and expired login views', () => {
  assert.equal(getBoardView(createBoardState(), NOW).view, 'checking');
  const out = apply(createBoardState(), { type: 'authChecked', authenticated: false });
  assert.deepEqual(getBoardView(out, NOW), { view: 'login', message: LOGIN_REQUIRED_MESSAGE });
  const expired = apply(inPhase('搶答中'), { type: 'authExpired' });
  assert.equal(getBoardView(expired, NOW).view, 'login');
  assert.equal(expired.presence.data, null);
});

test('preparing and buzzing list every group online or offline; ended does not', () => {
  for (const phase of ['準備中', '搶答中']) {
    const view = getBoardView(inPhase(phase), NOW);
    assert.equal(view.phaseText, phase);
    assert.deepEqual(view.groups, [
      { name: '第 1 組', online: true, statusText: '在線' },
      { name: '第 2 組', online: false, statusText: '離線' },
      { name: '第 3 組', online: true, statusText: '在線' },
    ]);
    assert.equal(view.onlineText, '在線 2／3 組');
    assert.equal(view.results, null);
  }
  const ended = getBoardView(inPhase('已結束'), NOW);
  assert.deepEqual(ended.groups, []);
  assert.equal(ended.onlineText, '');
});

test('countdown follows server time only while buzzing', () => {
  const endsAt = new Date(NOW + 90_500).toISOString();
  assert.equal(getBoardView(inPhase('搶答中', { countdownEndsAt: endsAt }), NOW).countdownText, '1:31');
  assert.equal(getBoardView(inPhase('搶答中'), NOW).countdownText, '');
  assert.equal(getBoardView(inPhase('準備中', { countdownEndsAt: endsAt }), NOW).countdownText, '');
});

test('the buzzing view carries no answer related fields', () => {
  const view = getBoardView(inPhase('搶答中'), NOW);
  assert.deepEqual(Object.keys(view).sort(), ['countdownText', 'groups', 'onlineText', 'phaseText', 'results', 'view']);
  assert.doesNotMatch(JSON.stringify(view), /答案|submitted|winner|名|H2O/);
  // 搶答中不會要求讀取結果
  assert.equal(inPhase('搶答中').results.wantsRequest, false);
});

test('ended results start hidden and reveal in question order', () => {
  let state = inPhase('已結束');
  let view = getBoardView(state, NOW).results;
  assert.deepEqual(view.rows.map(({ label }) => label), ['第 1 題', '第 2 題', '第 3 題', '第 10 題']);
  assert.ok(view.rows.every(({ text, revealed }) => text === NOT_REVEALED_TEXT && !revealed));
  assert.equal(view.revealedText, '已揭曉 0／4 題');
  assert.equal(view.canRevealNext, true);

  state = apply(state, { type: 'revealNext' }, { type: 'revealNext' });
  view = getBoardView(state, NOW).results;
  assert.deepEqual(view.rows.map(({ text }) => text), ['第 1 組「H2O」', '無人作答', NOT_REVEALED_TEXT, NOT_REVEALED_TEXT]);
  assert.equal(view.revealedText, '已揭曉 2／4 題');

  state = apply(state, { type: 'revealAll' });
  view = getBoardView(state, NOW).results;
  assert.deepEqual(view.rows.map(({ text }) => text), [
    '第 1 組「H2O」',
    '無人作答',
    '第 2 組「牛頓」（公平順位改判）',
    '第 1 組「臺北／新北」',
  ]);
  assert.equal(view.canRevealNext, false);
  assert.equal(view.canRevealAll, false);
  assert.equal(apply(state, { type: 'revealNext' }).revealed, 4, 'never beyond the question count');
});

test('reveal buttons stay disabled until results arrive and unsettled shows judging', () => {
  const waiting = apply(loggedIn(), { type: 'summaryLoaded', summary: summary('已結束') });
  const view = getBoardView(waiting, NOW).results;
  assert.equal(view.loading, true);
  assert.equal(view.canRevealNext, false);
  assert.equal(apply(waiting, { type: 'revealNext' }).revealed, 0);

  let state = apply(waiting, { type: 'requestResults' });
  state = apply(state, { type: 'resultsLoaded', seq: state.results.seq, questions: [question(1, null, { settled: false })] });
  state = apply(state, { type: 'revealAll' });
  assert.equal(getBoardView(state, NOW).results.rows[0].text, '判定中');
});

test('leaving ended clears results and reveal; ending again starts from zero', () => {
  let state = apply(inPhase('已結束'), { type: 'revealAll' });
  state = apply(state, { type: 'summaryLoaded', summary: summary('準備中') });
  assert.equal(state.results.data, null);
  assert.equal(state.revealed, 0);
  assert.equal(state.presence.wantsRequest, true);
  assert.equal(getBoardView(state, NOW).results, null);

  state = apply(state, { type: 'summaryLoaded', summary: summary('搶答中') }, { type: 'summaryLoaded', summary: summary('已結束') });
  assert.equal(state.revealed, 0);
  assert.equal(state.results.wantsRequest, true);
});

test('stale presence and results responses are discarded', () => {
  let state = apply(loggedIn(), { type: 'summaryLoaded', summary: summary('準備中') }, { type: 'requestPresence' });
  const firstSeq = state.presence.seq;
  state = apply(state, { type: 'presenceChanged' });
  assert.equal(state.presence.dirty, true, 'changes during a request are queued');
  state = apply(state, { type: 'presenceLoaded', seq: firstSeq, groups });
  assert.equal(state.presence.wantsRequest, true);
  state = apply(state, { type: 'requestPresence' });
  state = apply(state, { type: 'presenceLoaded', seq: firstSeq, groups: [] });
  assert.deepEqual(state.presence.data, groups, 'old sequence ignored');

  let ended = apply(loggedIn(), { type: 'summaryLoaded', summary: summary('已結束') }, { type: 'requestResults' });
  const oldSeq = ended.results.seq;
  ended = apply(ended, { type: 'summaryLoaded', summary: summary('準備中') });
  ended = apply(ended, { type: 'resultsLoaded', seq: oldSeq, questions: endedQuestions });
  assert.equal(ended.results.data, null, 'results requested before a reset are dropped');
});

test('presence changes are ignored after the end', () => {
  const state = apply(inPhase('已結束'), { type: 'presenceChanged' });
  assert.equal(state.presence.wantsRequest, false);
});
