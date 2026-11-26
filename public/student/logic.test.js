import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySubmission, buildResultsRows, formatAnswers, getAnsweringScreen, getEntryNextStep, getEventErrorNextStep, getPhaseDisplay, getQuestionStatus, getResultsLoadNextStep, getStoredEntryNextStep, getSubmitErrorNextStep, isReconnecting, isStaleRequest, mergeSubmissions, validateAnswers, mergeVoided, reconcileVoided, applyVoid } from './logic.js';

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

test('submission snapshots merge as a union and keep current submissions on duplicate questions', () => {
  const current = [
    { questionId: 1, answers: ['event answer'], submittedAt: 'event time' },
    { questionId: 3, answers: ['local answer'], submittedAt: 'local time' },
  ];
  const snapshot = [
    { questionId: 1, answers: ['stale answer'], submittedAt: 'stale time' },
    { questionId: 2, answers: ['snapshot answer'], submittedAt: 'snapshot time' },
  ];

  const merged = mergeSubmissions(current, snapshot);
  assert.deepEqual(merged, [
    { questionId: 1, answers: ['event answer'], submittedAt: 'event time' },
    { questionId: 2, answers: ['snapshot answer'], submittedAt: 'snapshot time' },
    { questionId: 3, answers: ['local answer'], submittedAt: 'local time' },
  ]);
  assert.deepEqual(current[0].answers, ['event answer']);
  assert.deepEqual(snapshot[0].answers, ['stale answer']);
  assert.deepEqual(mergeSubmissions([], snapshot), snapshot);
  assert.deepEqual(mergeSubmissions(current, []), current);
  assert.deepEqual(mergeSubmissions(null, null), []);
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

test('formats single answers and grouped answers in blank index order', () => {
  assert.equal(formatAnswers([{ index: 0, prefix: '', prompt: '化學式' }], ['H2O']), 'H2O');
  assert.equal(formatAnswers([
    { index: 1, prefix: '（2）', prompt: '第二空' },
    { index: 0, prefix: '（1）', prompt: '第一空' },
  ], ['巴黎', '倫敦']), '（1）巴黎；（2）倫敦');
});

test('formats missing answers as empty strings without throwing', () => {
  assert.equal(formatAnswers([
    { index: 0, prefix: '（1）', prompt: '第一空' },
    { index: 1, prefix: '（2）', prompt: '第二空' },
  ], ['巴黎']), '（1）巴黎；（2）');
});

test('builds result rows, own win summary, and sorted question labels', () => {
  const result = buildResultsRows({ questions: [
    {
      questionId: 2,
      blanks: [{ index: 0, prefix: '', prompt: '題目二' }],
      winner: { groupName: '第 2 組', answers: ['答案二'] },
      own: { place: 2, isWinner: false, answers: ['本組答案二'] },
    },
    {
      questionId: 1,
      blanks: [{ index: 0, prefix: '', prompt: '題目一' }],
      winner: { groupName: '第 1 組', answers: ['答案一'] },
      own: { place: 1, isWinner: true, answers: ['本組答案一'] },
    },
    { questionId: 3, blanks: [], winner: null, own: null },
    {
      questionId: 4,
      blanks: [{ index: 0, prefix: '', prompt: '題目四' }],
      winner: { groupName: '第 2 組', answers: ['答案四'] },
      own: null,
    },
  ] });

  assert.deepEqual(result.summary, { ownWins: 1, total: 4, text: '本組成功 1 題／共 4 題' });
  assert.deepEqual(result.rows.map(({ questionId, label }) => [questionId, label]), [
    [1, '第 1 題'], [2, '第 2 題'], [3, '第 3 題'], [4, '第 4 題'],
  ]);
  assert.equal(result.rows[0].winnerText, '第 1 組：答案一');
  assert.equal(result.rows[0].ownText, '本組第 1 名（成功）：本組答案一');
  assert.equal(result.rows[0].isOwnWinner, true);
  assert.equal(result.rows[1].winnerText, '第 2 組：答案二');
  assert.equal(result.rows[1].ownText, '本組第 2 名：本組答案二');
  assert.equal(result.rows[1].isOwnWinner, false);
  assert.equal(result.rows[2].winnerText, '無人作答');
  assert.equal(result.rows[2].ownText, '本組未作答');
  assert.equal(result.rows[3].winnerText, '第 2 組：答案四');
  assert.equal(result.rows[3].ownText, '本組未作答');
});

test('buildResultsRows returns an empty summary for null or empty input', () => {
  const empty = { summary: { ownWins: 0, total: 0, text: '本組成功 0 題／共 0 題' }, rows: [] };
  assert.deepEqual(buildResultsRows(null), empty);
  assert.deepEqual(buildResultsRows({}), empty);
  assert.deepEqual(buildResultsRows({ questions: [] }), empty);
});

test('results load errors map status codes to the documented actions', () => {
  const message = '無法載入結果，請稍後再試';
  assert.deepEqual(getResultsLoadNextStep(403), { action: 'restore-entry', message });
  assert.deepEqual(getResultsLoadNextStep(409), { action: 'refresh-session', message });
  for (const status of [null, undefined, 400, 404, 500]) {
    assert.deepEqual(getResultsLoadNextStep(status), { action: 'show-message', message });
  }
});

test('result answer formatting preserves HTML characters as plain text content', () => {
  const answer = '<b>x</b>';
  assert.equal(formatAnswers([{ index: 0, prefix: '', prompt: '題目' }], [answer]), answer);
  const result = buildResultsRows({ questions: [{
    questionId: 1,
    blanks: [{ index: 0, prefix: '', prompt: '題目' }],
    winner: { groupName: '第 1 組', answers: [answer] },
    own: { place: 1, isWinner: true, answers: [answer] },
  }] });
  assert.equal(result.rows[0].winnerText, `第 1 組：${answer}`);
  assert.equal(result.rows[0].ownText, `本組第 1 名（成功）：${answer}`);
});

// ---- add-student-void-notice task 1.1 ----

const T = (second) => `2026-11-26T01:00:${String(second).padStart(2, '0')}.000Z`;
const sub = (questionId, second, answer = '答') => ({ questionId, answers: [answer], submittedAt: T(second) });
const voidOf = (questionId, second) => ({ questionId, voidedAt: T(second) });

test('a void later than the submission removes the submission', () => {
  const state = applyVoid({ submissions: [sub(1, 1), sub(2, 1)], voided: [] }, voidOf(1, 5));
  assert.deepEqual(state, { submissions: [sub(2, 1)], voided: [voidOf(1, 5)] });
});

test('a resubmission later than the void removes the void', () => {
  assert.deepEqual(reconcileVoided([sub(1, 9, '重送')], [voidOf(1, 5)]), { submissions: [sub(1, 9, '重送')], voided: [] });
});

test('an old snapshot arriving after a void event does not lock the question again', () => {
  const afterEvent = applyVoid({ submissions: [sub(1, 1)], voided: [] }, voidOf(1, 5));
  const snapshot = { submissions: [sub(1, 1)], voided: [] };
  const merged = reconcileVoided(mergeSubmissions(afterEvent.submissions, snapshot.submissions), mergeVoided(afterEvent.voided, snapshot.voided));
  assert.deepEqual(merged, { submissions: [], voided: [voidOf(1, 5)] });
});

test('an old snapshot arriving after a resubmission does not bring the void notice back', () => {
  const current = { submissions: [sub(1, 9, '重送')], voided: [] };
  const snapshot = { submissions: [], voided: [voidOf(1, 5)] };
  const merged = reconcileVoided(mergeSubmissions(current.submissions, snapshot.submissions), mergeVoided(current.voided, snapshot.voided));
  assert.deepEqual(merged, { submissions: [sub(1, 9, '重送')], voided: [] });
});

test('repeated voids of a question keep the latest time', () => {
  assert.deepEqual(mergeVoided([voidOf(1, 5)], [voidOf(1, 3), voidOf(2, 4)]), [voidOf(1, 5), voidOf(2, 4)]);
  assert.deepEqual(mergeVoided([voidOf(1, 3)], [voidOf(1, 8)]), [voidOf(1, 8)]);
  assert.deepEqual(mergeVoided(null, undefined), []);
});

test('a snapshot submission newer than the local one replaces it', () => {
  assert.deepEqual(mergeSubmissions([sub(1, 1, '舊')], [sub(1, 9, '新')]), [sub(1, 9, '新')]);
  assert.deepEqual(mergeSubmissions([sub(1, 9, '本機')], [sub(1, 9, '快照')]), [sub(1, 9, '本機')], 'equal time keeps local');
});

test('question status order is submitted, voided, draft, unanswered', () => {
  assert.equal(getQuestionStatus(true, true, true), 'submitted');
  assert.equal(getQuestionStatus(false, true, true), 'voided');
  assert.equal(getQuestionStatus(false, true, false), 'draft');
  assert.equal(getQuestionStatus(false, false, false), 'unanswered');
  assert.equal(getQuestionStatus(false, true), 'draft', 'two-argument calls are unchanged');
});

test('void helpers do not mutate their inputs', () => {
  const submissions = [sub(1, 1), sub(2, 1)];
  const voided = [voidOf(1, 5)];
  const frozen = JSON.stringify({ submissions, voided });
  applyVoid({ submissions, voided }, voidOf(2, 6));
  reconcileVoided(submissions, voided);
  mergeVoided(voided, [voidOf(1, 7)]);
  mergeSubmissions(submissions, [sub(1, 9)]);
  assert.equal(JSON.stringify({ submissions, voided }), frozen);
});
