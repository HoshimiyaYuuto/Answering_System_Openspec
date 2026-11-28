import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResults } from './results.js';
import { buildStudentResults } from './student-results.js';

// 判定結果由呼叫端算好傳入，與 server 的 judgeResults 相同做法。
function build(input) {
  return buildStudentResults({ ...input, results: computeResults(input) });
}

function question(id, blanks = [{ index: 0, prefix: '', prompt: `提示 ${id}` }], extra = {}) {
  return { id, blanks, prompt: `題目層提示 ${id}`, anchorCell: 'B2', answerCell: 'C2', ...extra };
}

function submission(questionId, groupId, rank, answers, status = 'valid') {
  return { questionId, groupId, rank, answers, submittedAt: '2026-11-20T00:00:00.000Z', status };
}

const groups = [
  { id: 'group-1-private', name: '第 1 組' },
  { id: 'group-2-private', name: '第 2 組' },
  { id: 'group-3-private', name: '第 3 組' },
];

test('returns winner and own group placing when own group is second', () => {
  const result = build({
    questions: [question(1)],
    submissions: [
      submission(1, 'group-2-private', 1, ['H2O']),
      submission(1, 'group-1-private', 2, ['水']),
    ],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '第 2 組', answers: ['H2O'], byFairRanking: false });
  assert.deepEqual(result.questions[0].own, { place: 2, isWinner: false, answers: ['水'] });
});

test('returns own group as winner', () => {
  const result = build({
    questions: [question(1)],
    submissions: [submission(1, 'group-1-private', 1, ['answer'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].own, { place: 1, isWinner: true, answers: ['answer'] });
  assert.deepEqual(result.questions[0].winner, { groupName: '第 1 組', answers: ['answer'], byFairRanking: false });
});

test('returns null own when this group did not answer', () => {
  const result = build({
    questions: [question(1)],
    submissions: [submission(1, 'group-2-private', 1, ['winner'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '第 2 組', answers: ['winner'], byFairRanking: false });
  assert.equal(result.questions[0].own, null);
});

test('returns null winner and own when nobody has a valid submission', () => {
  const result = build({
    questions: [question(1)],
    submissions: [],
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.questions[0].winner, null);
  assert.equal(result.questions[0].own, null);
});

test('keeps grouped answers in blank order and exposes only public blank fields', () => {
  const result = build({
    questions: [question(10, [
      { index: 0, prefix: '（1）', prompt: '首都', anchorCell: 'A1' },
      { index: 1, prefix: '（2）', prompt: '最大城市', answerCell: 'B2' },
    ])],
    submissions: [submission(10, 'group-1-private', 1, ['臺北', '新北'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].blanks, [
    { index: 0, prefix: '（1）', prompt: '首都' },
    { index: 1, prefix: '（2）', prompt: '最大城市' },
  ]);
  assert.deepEqual(result.questions[0].own.answers, ['臺北', '新北']);
  assert.equal(JSON.stringify(result).includes('題目層提示'), false);
  assert.equal(JSON.stringify(result).includes('anchorCell'), false);
  assert.equal(JSON.stringify(result).includes('answerCell'), false);
});

test('ignores submissions whose status is not valid', () => {
  const result = build({
    questions: [question(1)],
    submissions: [submission(1, 'group-1-private', 1, ['void answer'], 'void')],
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.questions[0].winner, null);
  assert.equal(result.questions[0].own, null);
});

test('uses fallback group name when the winning group is missing from groups', () => {
  const result = build({
    questions: [question(1)],
    submissions: [submission(1, 'removed-group-private', 1, ['answer'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '（已移除的組別）', answers: ['answer'], byFairRanking: false });
});

test('sorts questions by question id', () => {
  const result = build({
    questions: [question(10), question(2), question(1)],
    submissions: [],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions.map(({ questionId }) => questionId), [1, 2, 10]);
});

test('serialized results contain no group identifiers, rank metadata, placings, or non-winner answers', () => {
  const result = build({
    questions: [question(1)],
    submissions: [
      submission(1, 'group-2-private', 1, ['winner answer']),
      submission(1, 'group-1-private', 2, ['own answer']),
      submission(1, 'group-3-private', 3, ['other group secret answer']),
    ],
    groups,
    groupId: 'group-1-private',
  });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('group-1-private'), false);
  assert.equal(serialized.includes('group-2-private'), false);
  assert.equal(serialized.includes('group-3-private'), false);
  assert.equal(serialized.includes('"rank"'), false);
  assert.equal(serialized.includes('placings'), false);
  assert.equal(serialized.includes('other group secret answer'), false);
  assert.equal(serialized.includes('winner answer'), true);
  assert.equal(serialized.includes('own answer'), true);
});

function timedSubmission(questionId, groupId, rank, answers, offsetMs) {
  return { ...submission(questionId, groupId, rank, answers), submittedAt: new Date(Date.UTC(2026, 10, 20) + offsetMs).toISOString() };
}

// 第 1 組先贏第 1、2 題；第 3 題第 1 組先送、第 2 組 1 秒後送。
const fairSubmissions = [
  timedSubmission(1, 'group-1-private', 1, ['一'], 0),
  timedSubmission(2, 'group-1-private', 1, ['二'], 10_000),
  timedSubmission(3, 'group-1-private', 1, ['第 1 組第三題'], 20_000),
  timedSubmission(3, 'group-2-private', 2, ['第 2 組第三題'], 21_000),
];

test('fair ranking flags the re-judged winner and own place follows fair ranking', () => {
  const result = build({
    questions: [question(1), question(2), question(3)],
    submissions: fairSubmissions,
    fairRankingEnabled: true,
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.fairRankingEnabled, true);
  assert.deepEqual(result.questions[0].winner, { groupName: '第 1 組', answers: ['一'], byFairRanking: false });
  assert.deepEqual(result.questions[2].winner, { groupName: '第 2 組', answers: ['第 2 組第三題'], byFairRanking: true });
  assert.deepEqual(result.questions[2].own, { place: 2, isWinner: false, answers: ['第 1 組第三題'] });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('group-'), false);
  assert.equal(serialized.includes('"rank"'), false);
  assert.equal(serialized.includes('winnerSource'), false);
});

test('fair ranking disabled reports false everywhere', () => {
  const result = build({
    questions: [question(1), question(2), question(3)],
    submissions: fairSubmissions,
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.fairRankingEnabled, false);
  assert.ok(result.questions.every(({ winner }) => winner.byFairRanking === false));
  assert.deepEqual(result.questions[2].own, { place: 1, isWinner: true, answers: ['第 1 組第三題'] });
});
