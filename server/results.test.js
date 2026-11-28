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

// 公平順位測試用：送達時間以毫秒偏移指定，rank 為接收順位。
const BASE = Date.UTC(2026, 10, 22, 0, 0, 0);
function timed(questionId, groupId, rank, offsetMs, status = 'valid') {
  return { ...submission(questionId, groupId, rank, status), submittedAt: new Date(BASE + offsetMs).toISOString() };
}
const fair = (qs, submissions, extra = {}) =>
  computeResults({ questions: qs, submissions, fairRankingEnabled: true, ...extra });

// 第 1 組先贏第 1、2 題，之後第 3 題第 1 組先送、第 2 組 offset 毫秒後送。
function twoWinsThenRace(offset) {
  return [
    timed(1, 1, 1, 0),
    timed(2, 1, 1, 10_000),
    timed(3, 1, 1, 20_000),
    timed(3, 2, 2, 20_000 + offset),
  ];
}

test('fair ranking can be derived', () => {
  const results = fair(questions(1), [timed(1, 2, 1, 0)]);
  assert.equal(results[0].settled, true);
  assert.equal(results[0].winnerSource, 'arrival');
});

test('fair ranking: group with fewer wins in the batch wins', () => {
  const result = resultOf(fair(questions(1, 2, 3), twoWinsThenRace(1000)), 3);
  assert.deepEqual(result.winner, { groupId: 2, rank: 2 });
  assert.equal(result.winnerSource, 'fair');
  assert.deepEqual(result.placings, [
    { groupId: 2, rank: 2, place: 1 },
    { groupId: 1, rank: 1, place: 2 },
  ]);
});

test('fair ranking: arrival after 3 seconds is outside the batch, exactly 3000 ms is inside', () => {
  const outside = resultOf(fair(questions(1, 2, 3), twoWinsThenRace(3001)), 3);
  assert.deepEqual(outside.winner, { groupId: 1, rank: 1 });
  assert.equal(outside.winnerSource, 'arrival');
  const edge = resultOf(fair(questions(1, 2, 3), twoWinsThenRace(3000)), 3);
  assert.deepEqual(edge.winner, { groupId: 2, rank: 2 });
  assert.equal(edge.winnerSource, 'fair');
});

test('fair ranking: equal wins fall back to arrival; batch sorted by wins then outside batch last', () => {
  const equal = fair(questions(1), [timed(1, 3, 1, 0), timed(1, 4, 2, 500)]);
  assert.deepEqual(equal[0].winner, { groupId: 3, rank: 1 });
  assert.equal(equal[0].winnerSource, 'arrival');

  // 第 1 組 2 勝、第 2 組 1 勝、第 3 組 0 勝；第 5 組在批次外。
  const submissions = [
    timed(1, 1, 1, 0),
    timed(2, 1, 1, 10_000),
    timed(3, 2, 1, 20_000),
    timed(4, 1, 1, 30_000),
    timed(4, 2, 2, 30_100),
    timed(4, 3, 3, 30_200),
    timed(4, 5, 4, 34_000),
  ];
  const result = resultOf(fair(questions(1, 2, 3, 4), submissions), 4);
  assert.deepEqual(result.placings.map(({ groupId }) => groupId), [3, 2, 1, 5]);
  assert.deepEqual(result.placings.map(({ place }) => place), [1, 2, 3, 4]);
  assert.equal(result.winnerSource, 'fair');
});

test('fair ranking: judging order follows first arrival, ties by question number', () => {
  // 第 2 題的第一個作答比第 1 題早：第 1 組先贏第 2 題，第 1 題同批時讓給第 2 組。
  const results = fair(questions(1, 2), [
    timed(2, 1, 1, 0),
    timed(1, 1, 1, 1000),
    timed(1, 2, 2, 1500),
  ]);
  assert.deepEqual(resultOf(results, 2).winner, { groupId: 1, rank: 1 });
  assert.deepEqual(resultOf(results, 1).winner, { groupId: 2, rank: 2 });
  assert.equal(resultOf(results, 1).winnerSource, 'fair');

  // 兩題第一個作答時間相同：題號小者先判定。
  const tied = fair(questions(1, 2), [
    timed(1, 1, 1, 0),
    timed(2, 1, 1, 0),
    timed(2, 2, 2, 200),
  ]);
  assert.deepEqual(resultOf(tied, 1).winner, { groupId: 1, rank: 1 });
  assert.deepEqual(resultOf(tied, 2).winner, { groupId: 2, rank: 2 });
});

test('fair ranking: unsettled batch is judging and not counted for later questions', () => {
  const submissions = [
    timed(1, 1, 1, 0),
    timed(2, 1, 1, 1000),
    timed(2, 2, 2, 1200),
  ];
  // now = 2000：兩題都還在批次內。
  const during = fair(questions(1, 2), submissions, { now: BASE + 2000 });
  for (const result of during) {
    assert.equal(result.settled, false);
    assert.equal(result.winner, null);
    assert.equal(result.winnerSource, null);
  }
  assert.deepEqual(resultOf(during, 2).placings.map(({ groupId }) => groupId), [1, 2]);

  // now = 3500：第 1 題已判定，第 2 題（批次結束於 4000）仍判定中。
  const partly = fair(questions(1, 2), submissions, { now: BASE + 3500 });
  assert.deepEqual(resultOf(partly, 1).winner, { groupId: 1, rank: 1 });
  assert.equal(resultOf(partly, 2).settled, false);

  const omitted = fair(questions(1, 2), submissions);
  assert.deepEqual(fair(questions(1, 2), submissions, { now: Infinity }), omitted);
  assert.ok(omitted.every(({ settled }) => settled));
  assert.deepEqual(resultOf(omitted, 2).winner, { groupId: 2, rank: 2 });
});

test('fair ranking: voiding a winner re-judges following questions', () => {
  const base = [
    timed(1, 1, 1, 0),
    timed(1, 3, 2, 200),
    timed(2, 1, 1, 10_000),
    timed(2, 2, 2, 10_500),
  ];
  const before = fair(questions(1, 2), base);
  assert.deepEqual(resultOf(before, 1).winner, { groupId: 1, rank: 1 });
  assert.deepEqual(resultOf(before, 2).winner, { groupId: 2, rank: 2 });

  const voided = [{ ...base[0], status: 'voided', voidedAt: new Date(BASE + 12_000).toISOString() }, ...base.slice(1)];
  const after = fair(questions(1, 2), voided);
  // 第 1 題改由第 3 組勝；第 1 組變成 0 勝，第 2 題改回第 1 組先到先得。
  assert.deepEqual(resultOf(after, 1).winner, { groupId: 3, rank: 2 });
  assert.deepEqual(resultOf(after, 2).winner, { groupId: 1, rank: 1 });
  assert.equal(resultOf(after, 2).winnerSource, 'arrival');
  const winCounts = new Map();
  for (const { winner } of after) winCounts.set(winner.groupId, (winCounts.get(winner.groupId) ?? 0) + 1);
  assert.deepEqual([...winCounts.entries()].sort(), [[1, 1], [3, 1]]);
});

test('fair ranking disabled: same data stays first come first served and void affects only its question', () => {
  const plain = computeResults({ questions: questions(1, 2, 3), submissions: twoWinsThenRace(1000) });
  assert.deepEqual(resultOf(plain, 3).winner, { groupId: 1, rank: 1 });
  assert.ok(plain.every(({ winnerSource }) => winnerSource === 'arrival'));

  const data = [timed(1, 1, 1, 0), timed(1, 3, 2, 200), timed(2, 1, 1, 10_000), timed(2, 2, 2, 10_500)];
  const voided = [{ ...data[0], status: 'voided' }, ...data.slice(1)];
  const after = computeResults({ questions: questions(1, 2), submissions: voided });
  assert.deepEqual(resultOf(after, 1).winner, { groupId: 3, rank: 2 });
  assert.deepEqual(resultOf(after, 2).winner, { groupId: 1, rank: 1 });
});

test('fair ranking is deterministic and stable once all batches close', () => {
  const qs = questions(1, 2, 3);
  const submissions = twoWinsThenRace(1000);
  const first = fair(qs, submissions);
  for (let index = 0; index < 100; index += 1) assert.deepEqual(fair(qs, submissions), first);
  assert.deepEqual(fair(qs, submissions, { now: BASE + 30_000 }), first);
  assert.deepEqual(fair(qs, submissions, { now: BASE + 9_000_000 }), first);
});

test('fair ranking leaves inputs unchanged', () => {
  const input = { questions: questions(3, 1, 2), submissions: twoWinsThenRace(1000).reverse(), fairRankingEnabled: true };
  const before = structuredClone(input);
  computeResults(input);
  assert.deepEqual(input, before);
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
