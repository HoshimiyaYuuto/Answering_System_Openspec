import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSubmissions } from './submissions.js';

function makeStore() {
  let time = 0;
  return createSubmissions({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, time++)) });
}

function submit(store, questionId, groupId, answers = ['答案'], blanksCount = 1) {
  return store.submit({ questionId, groupId, answers, blanksCount });
}

test('rejects missing, blank, non-string, and wrong-count answers', () => {
  const store = makeStore();
  assert.deepEqual(submit(store, 1, 1, []), { ok: false, code: 'INVALID_ANSWER' });
  assert.deepEqual(submit(store, 1, 1, ['   ']), { ok: false, code: 'INVALID_ANSWER' });
  assert.deepEqual(submit(store, 1, 1, [1]), { ok: false, code: 'INVALID_ANSWER' });
  assert.deepEqual(submit(store, 1, 1, ['one'], 2), { ok: false, code: 'INVALID_ANSWER' });
});

test('accepts 200 trimmed characters and rejects 201 characters', () => {
  const store = makeStore();
  assert.equal(submit(store, 1, 1, [` ${'x'.repeat(200)} `]).ok, true);
  assert.deepEqual(submit(store, 2, 1, ['x'.repeat(201)]), { ok: false, code: 'INVALID_ANSWER' });
});

test('counts answer length in Unicode code points, matching the student page', () => {
  const store = makeStore();
  // 200 個 emoji 是 400 個 UTF-16 單位，但只算 200 字
  assert.equal(submit(store, 1, 1, ['😀'.repeat(200)]).ok, true);
  assert.deepEqual(submit(store, 2, 1, ['😀'.repeat(201)]), { ok: false, code: 'INVALID_ANSWER' });
});

test('stores trimmed answers and server ISO UTC timestamps', () => {
  const store = makeStore();
  const result = submit(store, 1, 1, ['  answer  ']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.submission.answers, ['answer']);
  assert.equal(result.submission.submittedAt, '2026-01-01T00:00:00.000Z');
});

test('requires every blank in a question group', () => {
  const store = makeStore();
  assert.deepEqual(submit(store, 10, 1, ['first'], 2), { ok: false, code: 'INVALID_ANSWER' });
  assert.equal(submit(store, 10, 1, ['first', 'second'], 2).ok, true);
});

test('allows one valid submission per group and question', () => {
  const store = makeStore();
  assert.equal(submit(store, 1, 1).ok, true);
  assert.deepEqual(submit(store, 1, 1), { ok: false, code: 'ALREADY_SUBMITTED' });
});

test('keeps per-question ranks independent and groups isolated', () => {
  const store = makeStore();
  assert.equal(submit(store, 1, 1).submission.rank, 1);
  assert.equal(submit(store, 2, 1).submission.rank, 1);
  assert.equal(submit(store, 1, 2).submission.rank, 2);
  assert.deepEqual(store.listByGroup(1).map(({ questionId }) => questionId), [1, 2]);
  assert.deepEqual(store.listByGroup(2).map(({ questionId }) => questionId), [1]);
  assert.deepEqual(store.listSubmissions().map(({ questionId, rank }) => [questionId, rank]), [[1, 1], [1, 2], [2, 1]]);
});

test('notifies subscribers and supports unsubscribe', () => {
  const store = makeStore();
  const received = [];
  const unsubscribe = store.subscribe((submission) => received.push(submission));
  submit(store, 1, 1);
  unsubscribe();
  submit(store, 1, 2);
  assert.equal(received.length, 1);
  assert.equal(received[0].rank, 1);
});

test('clear resets records and ranks while retaining existing subscribers', () => {
  const store = makeStore();
  const received = [];
  store.subscribe((submission) => received.push(submission));
  assert.equal(submit(store, 1, 1).submission.rank, 1);
  store.clear();
  const afterClear = submit(store, 1, 2);
  assert.equal(afterClear.ok, true);
  assert.equal(afterClear.submission.rank, 1);
  assert.deepEqual(received.map(({ rank }) => rank), [1, 1]);
});

test('a failing subscriber does not affect storage, submit result, or other subscribers', () => {
  const store = makeStore();
  let notified = false;
  store.subscribe(() => { throw new Error('subscriber failure'); });
  store.subscribe(() => { notified = true; });

  const result = submit(store, 1, 1);
  assert.equal(result.ok, true);
  assert.equal(notified, true);
  assert.equal(store.listSubmissions().length, 1);
});

test('assigns sequential ranks for 100 concurrent groups on one question', async () => {
  const store = makeStore();
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => Promise.resolve().then(() => submit(store, 1, index + 1))));
  assert.equal(results.every(({ ok }) => ok), true);
  assert.deepEqual(results.map(({ submission }) => submission.rank).sort((a, b) => a - b), Array.from({ length: 100 }, (_, index) => index + 1));
});

test('accepts only one of two simultaneous submissions from the same group', async () => {
  const store = makeStore();
  const results = await Promise.all([
    Promise.resolve().then(() => submit(store, 1, 1, ['first'])),
    Promise.resolve().then(() => submit(store, 1, 1, ['second'])),
  ]);
  assert.equal(results.filter(({ ok }) => ok).length, 1);
  assert.deepEqual(results.filter(({ ok }) => !ok), [{ ok: false, code: 'ALREADY_SUBMITTED' }]);
});

test('keeps ranks consecutive across 100 groups and 50 questions', () => {
  const store = makeStore();
  for (let groupId = 1; groupId <= 100; groupId += 1) {
    for (let questionId = 1; questionId <= 50; questionId += 1) submit(store, questionId, groupId);
  }
  const byQuestion = new Map();
  for (const submission of store.listSubmissions()) {
    const ranks = byQuestion.get(submission.questionId) ?? [];
    ranks.push(submission.rank);
    byQuestion.set(submission.questionId, ranks);
  }
  assert.equal(byQuestion.size, 50);
  for (const ranks of byQuestion.values()) {
    assert.deepEqual(ranks, Array.from({ length: 100 }, (_, index) => index + 1));
  }
});

// ---- add-submission-void task 1.1 ----

test('new submissions carry voidedAt null', () => {
  const store = makeStore();
  assert.equal(submit(store, 1, 1).submission.voidedAt, null);
});

test('voiding marks the record voided with a server timestamp and keeps it', () => {
  const store = makeStore();
  submit(store, 1, 2, ['甲']);
  const result = store.voidSubmission({ questionId: 1, rank: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.submission.status, 'voided');
  assert.equal(result.submission.voidedAt, '2026-01-01T00:00:00.001Z');
  const [record] = store.listSubmissions();
  assert.deepEqual(
    { ...record },
    { questionId: 1, groupId: 2, answers: ['甲'], submittedAt: '2026-01-01T00:00:00.000Z', rank: 1, status: 'voided', voidedAt: '2026-01-01T00:00:00.001Z' },
  );
  assert.deepEqual(store.listByGroup(2), []);
});

test('the voided group resubmits after the current max rank; others stay locked', () => {
  const store = makeStore();
  submit(store, 1, 2);
  submit(store, 1, 3);
  submit(store, 1, 4);
  assert.equal(store.voidSubmission({ questionId: 1, rank: 1 }).ok, true);
  const again = submit(store, 1, 2, ['重送']);
  assert.equal(again.ok, true);
  assert.equal(again.submission.rank, 4);
  assert.deepEqual(submit(store, 1, 3), { ok: false, code: 'ALREADY_SUBMITTED' });
  assert.deepEqual(submit(store, 1, 2), { ok: false, code: 'ALREADY_SUBMITTED' });
  assert.deepEqual(store.listSubmissions().map(({ groupId, rank, status }) => [groupId, rank, status]), [
    [2, 1, 'voided'], [3, 2, 'valid'], [4, 3, 'valid'], [2, 4, 'valid'],
  ]);
});

test('void rejects a missing rank and a record already voided', () => {
  const store = makeStore();
  submit(store, 1, 2);
  assert.deepEqual(store.voidSubmission({ questionId: 1, rank: 9 }), { ok: false, code: 'SUBMISSION_NOT_FOUND' });
  assert.deepEqual(store.voidSubmission({ questionId: 2, rank: 1 }), { ok: false, code: 'SUBMISSION_NOT_FOUND' });
  store.voidSubmission({ questionId: 1, rank: 1 });
  submit(store, 1, 2, ['重送']);
  assert.deepEqual(store.voidSubmission({ questionId: 1, rank: 1 }), { ok: false, code: 'ALREADY_VOIDED' });
  assert.equal(store.listByGroup(2)[0].rank, 2, 'resubmission is untouched by the repeated void');
});

test('void listeners are called once and a throwing listener does not undo the void', () => {
  const store = makeStore();
  const seen = [];
  store.subscribeVoid(() => { throw new Error('boom'); });
  store.subscribeVoid((submission) => seen.push(submission));
  submit(store, 1, 2);
  assert.equal(store.voidSubmission({ questionId: 1, rank: 1 }).ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'voided');
  assert.equal(store.listSubmissions()[0].status, 'voided');
  assert.equal(store.voidSubmission({ questionId: 1, rank: 1 }).ok, false);
  assert.equal(seen.length, 1, 'a rejected void notifies nobody');
});

test('pending voided questions are listed per group until resubmitted', () => {
  const store = makeStore();
  submit(store, 3, 2);
  submit(store, 1, 2);
  submit(store, 1, 5);
  store.voidSubmission({ questionId: 3, rank: 1 });
  store.voidSubmission({ questionId: 1, rank: 1 });
  assert.deepEqual(store.listVoidedPendingByGroup(2).map(({ questionId }) => questionId), [1, 3]);
  assert.deepEqual(store.listVoidedPendingByGroup(5), []);
  submit(store, 1, 2, ['重送']);
  assert.deepEqual(store.listVoidedPendingByGroup(2).map(({ questionId }) => questionId), [3]);
  store.voidSubmission({ questionId: 1, rank: 3 });
  const [latest] = store.listVoidedPendingByGroup(2);
  assert.equal(latest.questionId, 1);
  assert.equal(latest.voidedAt, store.listSubmissions().find(({ rank, questionId }) => questionId === 1 && rank === 3).voidedAt);
});

test('clear removes voided records and pending lists', () => {
  const store = makeStore();
  submit(store, 1, 2);
  store.voidSubmission({ questionId: 1, rank: 1 });
  store.clear();
  assert.deepEqual(store.listSubmissions(), []);
  assert.deepEqual(store.listVoidedPendingByGroup(2), []);
});
