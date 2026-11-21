import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTH_EXPIRED_MESSAGE,
  createConsoleState,
  describeAction,
  describeSummary,
  getConsoleControls,
  getSetupBlockedReason,
  isAuthExpired,
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
