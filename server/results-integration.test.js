import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResults } from './results.js';
import { createSubmissions } from './submissions.js';

const questions = [
  { id: 1, blanks: [{ index: 0, prefix: '', prompt: '第 1 題' }] },
  { id: 2, blanks: [{ index: 0, prefix: '（1）', prompt: '第一空' }, { index: 1, prefix: '（2）', prompt: '第二空' }] },
  { id: 3, blanks: [{ index: 0, prefix: '', prompt: '第 3 題' }] },
];

function blanksCount(questionId) {
  return questions.find(({ id }) => id === questionId).blanks.length;
}

function submitAll(store, entries) {
  for (const [questionId, groupId, answers] of entries) {
    const result = store.submit({ questionId, groupId, answers, blanksCount: blanksCount(questionId) });
    assert.equal(result.ok, true, `第 ${groupId} 組第 ${questionId} 題送出失敗：${result.code}`);
  }
}

// 依 docs/submission-record.md：以 questionId + winner.rank 到作答紀錄找出勝者那一筆。
function winnerAnswers(results, submissions) {
  return Object.fromEntries(results.filter(({ winner }) => winner).map(({ questionId, winner }) => [
    questionId,
    submissions.find((submission) => submission.questionId === questionId && submission.rank === winner.rank).answers,
  ]));
}

test('computeResults reads listSubmissions() from the real submission store', () => {
  let tick = 0;
  const store = createSubmissions({ now: () => new Date(Date.UTC(2026, 10, 22, 0, 0, 0, tick++)) });
  submitAll(store, [
    [1, 3, ['  第三組  ']],
    [1, 1, ['第一組']],
    [2, 2, ['甲', '乙']],
    [1, 2, ['第二組']],
  ]);
  assert.equal(store.submit({ questionId: 1, groupId: 3, answers: ['重送'], blanksCount: 1 }).code, 'ALREADY_SUBMITTED');
  assert.equal(store.submit({ questionId: 2, groupId: 1, answers: ['只有一格'], blanksCount: 2 }).code, 'INVALID_ANSWER');

  const submissions = store.listSubmissions();
  const results = computeResults({ questions, submissions });

  assert.deepEqual(results.map(({ questionId, winner }) => [questionId, winner]), [
    [1, { groupId: 3, rank: 1 }],
    [2, { groupId: 2, rank: 1 }],
    [3, null],
  ]);
  assert.deepEqual(results[0].placings, [
    { groupId: 3, rank: 1, place: 1 },
    { groupId: 1, rank: 2, place: 2 },
    { groupId: 2, rank: 3, place: 3 },
  ]);
  assert.deepEqual(winnerAnswers(results, submissions), { 1: ['第三組'], 2: ['甲', '乙'] });
});

test('100 groups x 50 questions from the real store give consecutive places', () => {
  const store = createSubmissions();
  const manyQuestions = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, blanks: [{ index: 0, prefix: '', prompt: '' }] }));
  for (const { id } of manyQuestions) {
    for (let groupId = 100; groupId >= 1; groupId -= 1) {
      assert.equal(store.submit({ questionId: id, groupId, answers: [`第${groupId}組`], blanksCount: 1 }).ok, true);
    }
  }
  const results = computeResults({ questions: manyQuestions, submissions: store.listSubmissions() });
  const expectedPlaces = Array.from({ length: 100 }, (_, index) => index + 1);
  for (const result of results) {
    assert.deepEqual(result.placings.map(({ place }) => place), expectedPlaces);
    assert.deepEqual(result.winner, { groupId: 100, rank: 1 });
  }
});
