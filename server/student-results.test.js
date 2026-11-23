import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudentResults } from './student-results.js';

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
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [
      submission(1, 'group-2-private', 1, ['H2O']),
      submission(1, 'group-1-private', 2, ['水']),
    ],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '第 2 組', answers: ['H2O'] });
  assert.deepEqual(result.questions[0].own, { place: 2, isWinner: false, answers: ['水'] });
});

test('returns own group as winner', () => {
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [submission(1, 'group-1-private', 1, ['answer'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].own, { place: 1, isWinner: true, answers: ['answer'] });
  assert.deepEqual(result.questions[0].winner, { groupName: '第 1 組', answers: ['answer'] });
});

test('returns null own when this group did not answer', () => {
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [submission(1, 'group-2-private', 1, ['winner'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '第 2 組', answers: ['winner'] });
  assert.equal(result.questions[0].own, null);
});

test('returns null winner and own when nobody has a valid submission', () => {
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [],
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.questions[0].winner, null);
  assert.equal(result.questions[0].own, null);
});

test('keeps grouped answers in blank order and exposes only public blank fields', () => {
  const result = buildStudentResults({
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
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [submission(1, 'group-1-private', 1, ['void answer'], 'void')],
    groups,
    groupId: 'group-1-private',
  });

  assert.equal(result.questions[0].winner, null);
  assert.equal(result.questions[0].own, null);
});

test('uses fallback group name when the winning group is missing from groups', () => {
  const result = buildStudentResults({
    questions: [question(1)],
    submissions: [submission(1, 'removed-group-private', 1, ['answer'])],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions[0].winner, { groupName: '（已移除的組別）', answers: ['answer'] });
});

test('sorts questions by question id', () => {
  const result = buildStudentResults({
    questions: [question(10), question(2), question(1)],
    submissions: [],
    groups,
    groupId: 'group-1-private',
  });

  assert.deepEqual(result.questions.map(({ questionId }) => questionId), [1, 2, 10]);
});

test('serialized results contain no group identifiers, rank metadata, placings, or non-winner answers', () => {
  const result = buildStudentResults({
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
