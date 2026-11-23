import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySubmission, getAnsweringScreen, getEntryNextStep, getEventErrorNextStep, getPhaseDisplay, getQuestionStatus, getStoredEntryNextStep, getSubmitErrorNextStep, isReconnecting, isStaleRequest, validateAnswers } from './logic.js';

test('connection is considered stale only after forty seconds without an event', () => {
  assert.equal(isReconnecting(10_000, 50_000), false);
  assert.equal(isReconnecting(10_000, 50_001), true);
  assert.equal(isReconnecting(null, 50_001), true);
});

test('request sequence identifies responses that have become stale', () => {
  assert.equal(isStaleRequest(4, 5), true);
  assert.equal(isStaleRequest(5, 5), false);
});

test('valid entry proceeds to waiting screen', () => {
  const entry = { valid: true, phase: '準備中', group: { id: 1, name: '第 1 組' } };
  assert.deepEqual(getEntryNextStep({ data: entry }), { screen: 'waiting', entry });
});

test('stored student id determines whether entry response should be restored or explained', () => {
  assert.deepEqual(getStoredEntryNextStep(false, null), {
    screen: 'select-group', message: '', shouldExplain: false,
  });
  const valid = { valid: true, phase: '準備中', group: { id: 1, name: '第一組' } };
  assert.deepEqual(getStoredEntryNextStep(true, { data: valid }), {
    screen: 'waiting', entry: valid, shouldExplain: false,
  });
  assert.equal(getStoredEntryNextStep(true, { data: { valid: false, reason: 'entry_reset' } }).message,
    '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別');
  assert.equal(getStoredEntryNextStep(true, { data: { valid: false, reason: 'group_removed' } }).message,
    '你原本的組別已被老師移除，請重新選擇組別');
});

test('invalidated entry returns to group selection with reason-specific guidance', () => {
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'group_removed' } }), {
    screen: 'select-group', reason: 'group_removed', message: '你原本的組別已被老師移除，請重新選擇組別',
  });
  assert.deepEqual(getEntryNextStep({ data: { valid: false, reason: 'entry_reset' } }), {
    screen: 'select-group', reason: 'entry_reset', message: '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別',
  });
  assert.notEqual(
    getEntryNextStep({ data: { valid: false, reason: 'group_removed' } }).message,
    getEntryNextStep({ data: { valid: false, reason: 'entry_reset' } }).message,
  );
});

test('phase display exposes preparation, active, and ended messages with switching only in preparation', () => {
  assert.deepEqual(getPhaseDisplay('準備中'), { message: '請稍候，老師開始活動後再繼續。', canChangeGroup: true });
  assert.deepEqual(getPhaseDisplay('搶答中'), { message: '搶答已開始，請作答', canChangeGroup: false });
  assert.deepEqual(getPhaseDisplay('已結束'), { message: '活動已結束', canChangeGroup: false });
});

test('answering screen and question status cover all states', () => {
  assert.deepEqual(['select-group', 'waiting', 'answering', 'ended'], [
    getAnsweringScreen(false, '搶答中'), getAnsweringScreen(true, '準備中'),
    getAnsweringScreen(true, '搶答中'), getAnsweringScreen(true, '已結束'),
  ]);
  assert.deepEqual(['unanswered', 'draft', 'submitted'], [
    getQuestionStatus(false, false), getQuestionStatus(false, true), getQuestionStatus(true, true),
  ]);
});

test('validates trimmed answers using Unicode code point length', () => {
  assert.deepEqual(validateAnswers(['  答案😀  '], 1), { ok: true, answers: ['答案😀'] });
  assert.equal(validateAnswers(['x'.repeat(200)], 1).ok, true);
  assert.deepEqual(validateAnswers(['x'.repeat(201)], 1).errors, [{ index: 0, reason: 'too-long' }]);
  assert.deepEqual(validateAnswers(['   '], 1).errors, [{ index: 0, reason: 'empty' }]);
  assert.deepEqual(validateAnswers(['a'], 2).errors, [{ index: null, reason: 'wrong-count' }]);
  assert.deepEqual(validateAnswers(['😀'.repeat(201)], 1).errors, [{ index: 0, reason: 'too-long' }]);
});

test('submission updates are idempotent and do not mutate their inputs', () => {
  const original = [{ questionId: 1, answers: ['old'] }];
  const incoming = { questionId: 1, answers: ['new'] };
  const replaced = applySubmission(original, incoming);
  assert.deepEqual(replaced, [incoming]);
  assert.notEqual(replaced, original);
  assert.deepEqual(original[0].answers, ['old']);
  assert.deepEqual(applySubmission(replaced, incoming), replaced);
  assert.deepEqual(applySubmission([], { questionId: 2, answers: ['two'] }), [{ questionId: 2, answers: ['two'] }]);
});

test('submission errors map to the documented next steps', () => {
  assert.equal(getSubmitErrorNextStep({ code: 'ALREADY_SUBMITTED' }).action, 'refresh-submissions');
  assert.equal(getSubmitErrorNextStep({ code: 'SUBMISSION_NOT_ALLOWED' }).action, 'refresh-session');
  assert.equal(getSubmitErrorNextStep({ code: 'STUDENT_NOT_ENTERED' }).action, 'restore-entry');
  assert.equal(getSubmitErrorNextStep({ code: 'INVALID_ANSWER' }).action, 'show-message');
  assert.equal(getSubmitErrorNextStep({ code: 'QUESTION_NOT_FOUND' }).action, 'reload-questions');
  assert.equal(getSubmitErrorNextStep({ name: 'TimeoutError' }).action, 'retry');
});

test('event errors distinguish closed and connecting states without browser globals', () => {
  assert.deepEqual(getEventErrorNextStep(2), { action: 'restore-entry' });
  assert.deepEqual(getEventErrorNextStep(0), { action: 'wait' });
});
