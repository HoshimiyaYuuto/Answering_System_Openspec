import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTH_EXPIRED_MESSAGE,
  COUNTDOWN_RANGE_MESSAGE,
  createConsoleState,
  describeAction,
  describeSummary,
  formatRemaining,
  getConsoleControls,
  getSetupBlockedReason,
  isAuthExpired,
  parseCountdown,
  reduceConsole,
} from './console-logic.js';

const summary = (phase, groupCount = 5, questionCount = 6) => ({ phase, groupCount, questionCount, serverTime: 'x' });

function consoleIn(phase) {
  let state = reduceConsole(createConsoleState(), { type: 'authLoaded', authenticated: true, passwordConfigured: true });
  state = reduceConsole(state, { type: 'summaryLoaded', summary: summary(phase) });
  return state;
}

test('auth status selects checking, not configured, login or console', () => {
  const initial = createConsoleState();
  assert.equal(initial.view, 'checking');
  assert.equal(reduceConsole(initial, { type: 'authLoaded', authenticated: false, passwordConfigured: false }).view, 'notConfigured');
  assert.equal(reduceConsole(initial, { type: 'authLoaded', authenticated: false, passwordConfigured: true }).view, 'login');
  assert.equal(reduceConsole(initial, { type: 'authLoaded', authenticated: true, passwordConfigured: true }).view, 'console');
});

test('login failures show a reason and stay on the login screen', () => {
  let state = reduceConsole(createConsoleState(), { type: 'authLoaded', authenticated: false, passwordConfigured: true });
  state = reduceConsole(state, { type: 'requestLogin' });
  assert.equal(getConsoleControls(state).canLogin, false);
  const wrong = reduceConsole(state, { type: 'loginFailed', code: 'WRONG_PASSWORD' });
  assert.equal(wrong.view, 'login');
  assert.match(wrong.loginError, /密碼錯誤/);
  assert.equal(getConsoleControls(wrong).canLogin, true);
  assert.match(reduceConsole(state, { type: 'loginFailed', code: 'TOO_MANY_ATTEMPTS' }).loginError, /稍後再試/);
  assert.match(reduceConsole(state, { type: 'loginFailed' }).loginError, /伺服器沒有回應/);
  assert.equal(reduceConsole(state, { type: 'loginFailed', code: 'TEACHER_PASSWORD_NOT_SET' }).view, 'notConfigured');
});

test('successful login shows the console and the summary', () => {
  let state = reduceConsole(createConsoleState(), { type: 'authLoaded', authenticated: false, passwordConfigured: true });
  state = reduceConsole(state, { type: 'requestLogin' });
  state = reduceConsole(state, { type: 'loggedIn' });
  assert.equal(state.view, 'console');
  assert.deepEqual(describeSummary(state.summary), { phase: '讀取中…', counts: '' });
  state = reduceConsole(state, { type: 'summaryLoaded', summary: summary('準備中', 0, 0) });
  assert.deepEqual(describeSummary(state.summary), { phase: '準備中', counts: '0 組、0 題' });
});

test('start is only available during preparation and reports failures', () => {
  const preparing = consoleIn('準備中');
  assert.equal(getConsoleControls(preparing).canStart, true);
  assert.equal(getConsoleControls(preparing).canEnd, false);
  assert.equal(getConsoleControls(preparing).canSetup, true);

  const starting = reduceConsole(preparing, { type: 'requestStart' });
  assert.equal(getConsoleControls(starting).canStart, false);
  assert.equal(describeAction(starting), '開始搶答中…');

  const failed = reduceConsole(starting, { type: 'startFailed', message: '請先匯入學習單。' });
  assert.equal(failed.summary.phase, '準備中');
  assert.equal(describeAction(failed), '請先匯入學習單。');
  assert.equal(getConsoleControls(failed).canStart, true);

  const started = reduceConsole(starting, { type: 'startDone', phase: '搶答中' });
  assert.equal(started.summary.phase, '搶答中');
  assert.equal(getConsoleControls(started).canStart, false);
  assert.equal(getConsoleControls(started).canSetup, false);
  assert.equal(getConsoleControls(started).canEnd, true);
});

test('ending asks for confirmation and can be cancelled', () => {
  const running = consoleIn('搶答中');
  const asking = reduceConsole(running, { type: 'requestEnd' });
  assert.equal(getConsoleControls(asking).showEndConfirm, true);
  assert.equal(getConsoleControls(asking).canEnd, false);
  assert.equal(getConsoleControls(asking).canConfirmEnd, true);

  const cancelled = reduceConsole(asking, { type: 'cancelEnd' });
  assert.equal(getConsoleControls(cancelled).showEndConfirm, false);
  assert.equal(cancelled.summary.phase, '搶答中');

  const ending = reduceConsole(asking, { type: 'confirmEnd' });
  assert.equal(describeAction(ending), '結束搶答中…');
  assert.equal(getConsoleControls(ending).canConfirmEnd, false);
  const ended = reduceConsole(ending, { type: 'endDone', phase: '已結束' });
  assert.equal(ended.summary.phase, '已結束');
  assert.deepEqual(
    [getConsoleControls(ended).canStart, getConsoleControls(ended).canEnd, getConsoleControls(ended).canSetup],
    [false, false, false],
  );
});

test('ending twice shows 已結束 without an error', () => {
  const ending = reduceConsole(reduceConsole(consoleIn('搶答中'), { type: 'requestEnd' }), { type: 'confirmEnd' });
  const raced = reduceConsole(ending, {
    type: 'endFailed', code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能結束搶答。', phase: '已結束',
  });
  assert.equal(raced.summary.phase, '已結束');
  assert.equal(describeAction(raced), '');

  const other = reduceConsole(ending, { type: 'endFailed', code: 'INTERNAL_ERROR', message: '伺服器發生錯誤。', phase: '搶答中' });
  assert.equal(describeAction(other), '伺服器發生錯誤。');
});

test('phase changes from SSE update the summary and close the end confirmation', () => {
  const asking = reduceConsole(consoleIn('搶答中'), { type: 'requestEnd' });
  const ended = reduceConsole(asking, { type: 'phaseChanged', phase: '已結束' });
  assert.equal(ended.summary.phase, '已結束');
  assert.equal(getConsoleControls(ended).showEndConfirm, false);
  const started = reduceConsole(consoleIn('準備中'), { type: 'phaseChanged', phase: '搶答中' });
  assert.equal(getConsoleControls(started).canEnd, true);
});

test('expired login and logout return to the login screen', () => {
  const expired = reduceConsole(consoleIn('搶答中'), { type: 'authExpired' });
  assert.equal(expired.view, 'login');
  assert.equal(expired.loginError, AUTH_EXPIRED_MESSAGE);
  assert.equal(expired.summary, null);
  assert.equal(getConsoleControls(expired).canLogout, false);

  const loggedOut = reduceConsole(consoleIn('準備中'), { type: 'loggedOut' });
  assert.equal(loggedOut.view, 'login');
  assert.equal(loggedOut.loginError, '');
  assert.equal(isAuthExpired('TEACHER_AUTH_REQUIRED'), true);
  assert.equal(isAuthExpired('WRONG_PASSWORD'), false);
});

test('logout is always available inside the console', () => {
  const ending = reduceConsole(reduceConsole(consoleIn('搶答中'), { type: 'requestEnd' }), { type: 'confirmEnd' });
  assert.equal(getConsoleControls(ending).canLogout, true);
});

test('setup panels explain why they are locked', () => {
  assert.equal(getSetupBlockedReason('準備中'), '');
  assert.equal(getSetupBlockedReason(undefined), '');
  assert.match(getSetupBlockedReason('搶答中'), /搶答中.*只能在準備中/);
});
test('reset is offered only after the activity ends and needs confirmation', () => {
  for (const phase of ['準備中', '搶答中']) {
    const controls = getConsoleControls(consoleIn(phase));
    assert.equal(controls.canReset, false);
    assert.equal(controls.canConfirmReset, false);
  }
  let state = consoleIn('已結束');
  assert.equal(getConsoleControls(state).canReset, true);
  state = reduceConsole(state, { type: 'requestReset' });
  assert.deepEqual(
    [getConsoleControls(state).canReset, getConsoleControls(state).showResetConfirm, getConsoleControls(state).canConfirmReset],
    [false, true, true],
  );
  const cancelled = reduceConsole(state, { type: 'cancelReset' });
  assert.equal(cancelled.confirmingReset, false);
  assert.equal(getConsoleControls(cancelled).canReset, true);
  assert.equal(cancelled.summary.phase, '已結束');

  state = reduceConsole(state, { type: 'confirmReset' });
  assert.equal(describeAction(state), '重設活動中…');
  assert.equal(getConsoleControls(state).canConfirmReset, false);
  state = reduceConsole(state, { type: 'resetDone', phase: '準備中' });
  assert.equal(state.summary.phase, '準備中');
  assert.equal(state.action, null);
  assert.equal(getConsoleControls(state).canStart, true);
  assert.equal(getConsoleControls(state).canSetup, true);
});

test('a duplicate reset that finds the activity in preparation shows no error', () => {
  let state = reduceConsole(reduceConsole(consoleIn('已結束'), { type: 'requestReset' }), { type: 'confirmReset' });
  state = reduceConsole(state, { type: 'resetFailed', code: 'INVALID_PHASE_TRANSITION', message: '只能在已結束時重設活動。', phase: '準備中' });
  assert.equal(state.summary.phase, '準備中');
  assert.equal(describeAction(state), '');
  const other = reduceConsole(reduceConsole(consoleIn('已結束'), { type: 'confirmReset' }),
    { type: 'resetFailed', code: undefined, message: '伺服器沒有回應，請稍後再試。', phase: '已結束' });
  assert.equal(describeAction(other), '伺服器沒有回應，請稍後再試。');
  assert.equal(other.summary.phase, '已結束');
});

test('leaving the ended phase closes the reset confirmation', () => {
  const confirming = reduceConsole(consoleIn('已結束'), { type: 'requestReset' });
  const reset = reduceConsole(confirming, { type: 'phaseChanged', phase: '準備中' });
  assert.equal(reset.confirmingReset, false);
  assert.equal(getConsoleControls(reset).showResetConfirm, false);
});

test('countdown inputs are editable only while preparing', () => {
  assert.equal(getConsoleControls(consoleIn('準備中')).canEditCountdown, true);
  assert.equal(getConsoleControls(consoleIn('搶答中')).canEditCountdown, false);
  assert.equal(getConsoleControls(consoleIn('已結束')).canEditCountdown, false);
  const starting = reduceConsole(consoleIn('準備中'), { type: 'requestStart' });
  assert.equal(getConsoleControls(starting).canEditCountdown, false);
});

test('parseCountdown converts minutes and seconds and enforces 10 to 3600 seconds', () => {
  assert.deepEqual(parseCountdown({ enabled: false, minutes: 'abc', seconds: '' }), { ok: true, countdownSeconds: null });
  assert.deepEqual(parseCountdown({ enabled: true, minutes: '1', seconds: '30' }), { ok: true, countdownSeconds: 90 });
  assert.deepEqual(parseCountdown({ enabled: true, minutes: '', seconds: '10' }), { ok: true, countdownSeconds: 10 });
  assert.deepEqual(parseCountdown({ enabled: true, minutes: '60', seconds: '0' }), { ok: true, countdownSeconds: 3600 });
  for (const input of [
    { minutes: '0', seconds: '5' },
    { minutes: '61', seconds: '0' },
    { minutes: '60', seconds: '1' },
    { minutes: '-1', seconds: '30' },
    { minutes: '1.5', seconds: '0' },
    { minutes: '', seconds: '' },
  ]) {
    assert.deepEqual(parseCountdown({ enabled: true, ...input }), { ok: false, message: COUNTDOWN_RANGE_MESSAGE }, JSON.stringify(input));
  }
});

test('formatRemaining uses the given server time, rounds up and never goes below zero', () => {
  const endsAt = '2026-11-26T01:01:30.000Z';
  const at = (iso) => Date.parse(iso);
  assert.equal(formatRemaining(endsAt, at('2026-11-26T01:00:00.000Z')), '1:30');
  assert.equal(formatRemaining(endsAt, at('2026-11-26T01:01:29.100Z')), '0:01');
  assert.equal(formatRemaining(endsAt, at('2026-11-26T01:01:30.000Z')), '0:00');
  assert.equal(formatRemaining(endsAt, at('2026-11-26T01:05:00.000Z')), '0:00');
  assert.equal(formatRemaining('2026-11-26T02:00:00.000Z', at('2026-11-26T01:00:00.000Z')), '60:00');
  assert.equal(formatRemaining(null, at('2026-11-26T01:00:00.000Z')), '');
});
