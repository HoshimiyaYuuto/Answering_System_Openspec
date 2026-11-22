import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResults, ResultsComputationError } from './results.js';

function submission(questionId, groupId, rank, status = 'valid') {
  return {
    questionId,
    groupId,
    answers: [`第${groupId}組答案`],
    submittedAt: new Date(Date.UTC(2026, 10, 22, 0, 0, 0, rank)).toISOString(),
    rank,
    status,
    voidedAt: status === 'voided' ? '2026-11-22T00:00:05.000Z' : null,
  };
}

const questions = (...ids) => ids.map((id) => ({ id, blanks: [{ index: 0, prefix: '', prompt: `第 ${id} 題` }] }));

function resultOf(results, questionId) {
  return results.find((result) => result.questionId === questionId);
}

test('one result per question in question-number order', () => {
  const results = computeResults({ questions: questions(5, 1, 3), submissions: [submission(1, 2, 1)] });
  assert.deepEqual(results.map(({ questionId }) => questionId), [1, 3, 5]);
});

test('submission for an unknown question is ignored', () => {
  const results = computeResults({
    questions: questions(1),
    submissions: [submission(99, 1, 1), submission(1, 2, 1)],
  });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].winner, { groupId: 2, rank: 1 });
});

test('inputs are left unchanged', () => {
  const input = {
    questions: questions(2, 1),
    submissions: [submission(1, 5, 2), submission(1, 2, 1, 'voided'), submission(2, 3, 1)],
  };
  const before = structuredClone(input);
  computeResults(input);
  assert.deepEqual(input, before);
});

test('lowest rank wins and placings follow rank', () => {
  const [result] = computeResults({ questions: questions(1), submissions: [submission(1, 2, 1), submission(1, 5, 2)] });
  assert.deepEqual(result, {
    questionId: 1,
    settled: true,
    winner: { groupId: 2, rank: 1 },
    winnerSource: 'arrival',
    placings: [
      { groupId: 2, rank: 1, place: 1 },
      { groupId: 5, rank: 2, place: 2 },
    ],
  });
});

test('submissions out of order in the input are sorted by rank', () => {
  const [result] = computeResults({
    questions: questions(1),
    submissions: [submission(1, 7, 3), submission(1, 4, 1), submission(1, 6, 2)],
  });
  assert.deepEqual(result.placings.map(({ rank, place }) => [rank, place]), [[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(result.winner, { groupId: 4, rank: 1 });
});

test('voided first submission is skipped and places stay consecutive', () => {
  const [result] = computeResults({
    questions: questions(1),
    submissions: [submission(1, 1, 1, 'voided'), submission(1, 2, 2), submission(1, 3, 3)],
  });
  assert.deepEqual(result.winner, { groupId: 2, rank: 2 });
  assert.deepEqual(result.placings, [
    { groupId: 2, rank: 2, place: 1 },
    { groupId: 3, rank: 3, place: 2 },
  ]);
});

test('resubmission after void ranks behind earlier valid submissions', () => {
  const [result] = computeResults({
    questions: questions(1),
    submissions: [submission(1, 2, 1, 'voided'), submission(1, 3, 2), submission(1, 2, 4)],
  });
  assert.deepEqual(result.winner, { groupId: 3, rank: 2 });
  assert.deepEqual(result.placings, [
    { groupId: 3, rank: 2, place: 1 },
    { groupId: 2, rank: 4, place: 2 },
  ]);
});

test('questions without valid submissions have no winner', () => {
  const results = computeResults({ questions: questions(3, 4), submissions: [submission(4, 1, 1, 'voided')] });
  const empty = { settled: true, winner: null, winnerSource: null, placings: [] };
  assert.deepEqual(resultOf(results, 3), { questionId: 3, ...empty });
  assert.deepEqual(resultOf(results, 4), { questionId: 4, ...empty });
});

test('missing inputs are treated as empty', () => {
  assert.deepEqual(computeResults(), []);
  assert.deepEqual(computeResults({ questions: questions(1) })[0].placings, []);
});

test('results do not depend on now', () => {
  const input = { questions: questions(1, 2), submissions: [submission(1, 2, 1), submission(2, 3, 1)] };
  assert.deepEqual(
    computeResults({ ...input, now: Date.UTC(2026, 10, 22, 0, 0, 0) }),
    computeResults({ ...input, now: Date.UTC(2026, 10, 22, 9, 0, 0) }),
  );
});

test('results contain no answers', () => {
  const [result] = computeResults({ questions: questions(1), submissions: [submission(1, 2, 1)] });
  assert.doesNotMatch(JSON.stringify(result), /答案/);
});

test('fair ranking is rejected until supported', () => {
  assert.throws(
    () => computeResults({ questions: questions(1), submissions: [], fairRankingEnabled: true }),
    (error) => error instanceof ResultsComputationError && error.code === 'FAIR_RANKING_NOT_SUPPORTED' && /公平順位/.test(error.message),
  );
});

test('overrides are rejected until supported', () => {
  assert.throws(
    () => computeResults({ questions: questions(1), submissions: [submission(1, 2, 1)], overrides: { 1: 2 } }),
    (error) => error instanceof ResultsComputationError && error.code === 'OVERRIDE_NOT_SUPPORTED' && /老師改選/.test(error.message),
  );
});

test('empty overrides are accepted', () => {
  const [result] = computeResults({ questions: questions(1), submissions: [submission(1, 2, 1)], overrides: {} });
  assert.equal(result.winnerSource, 'arrival');
});

test('50 groups x 50 questions produce consecutive places quickly', () => {
  const ids = Array.from({ length: 50 }, (_, index) => index + 1);
  const submissions = [];
  for (const questionId of ids) {
    // 依組別倒序送達，確認不是靠輸入順序排名。
    for (let rank = 1; rank <= 50; rank += 1) submissions.push(submission(questionId, 51 - rank, rank));
  }
  submissions.reverse();
  const started = performance.now();
  const results = computeResults({ questions: questions(...ids), submissions });
  const elapsed = performance.now() - started;

  assert.equal(results.length, 50);
  for (const result of results) {
    assert.deepEqual(result.placings.map(({ place }) => place), ids);
    assert.deepEqual(result.placings.map(({ rank }) => rank), ids);
    assert.deepEqual(result.winner, { groupId: 50, rank: 1 });
  }
  assert.ok(elapsed < 100, `computeResults took ${elapsed} ms`);
});
