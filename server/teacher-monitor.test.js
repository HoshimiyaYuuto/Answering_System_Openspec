import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResults } from './results.js';
import { buildMonitor } from './teacher-monitor.js';

const groups = [
  { id: 1, name: '第 1 組' },
  { id: 2, name: '第 2 組' },
  { id: 3, name: '第 3 組' },
];
const questions = [
  { id: 2, prompt: '第二題', blanks: [{ index: 0, prefix: '', prompt: '第二題' }] },
  { id: 1, prompt: '第一題', blanks: [{ index: 0, prefix: '', prompt: '第一題' }] },
];

function record(questionId, groupId, rank, status = 'valid') {
  return {
    questionId,
    groupId,
    answers: [`第${groupId}組答案`],
    submittedAt: new Date(Date.UTC(2026, 10, 22, 0, 0, rank)).toISOString(),
    rank,
    status,
  };
}

function monitor(submissions, overrides = {}) {
  const results = overrides.results ?? computeResults({ questions, submissions });
  return buildMonitor({ phase: '搶答中', questions, groups: overrides.groups ?? groups, submissions, results });
}

const question = (data, id) => data.questions.find((item) => item.id === id);

test('groups that have not submitted are listed in notSubmitted', () => {
  const q1 = question(monitor([record(1, 1, 1)]), 1);
  assert.equal(q1.submittedCount, 1);
  assert.deepEqual(q1.entries.map(({ groupId, status }) => [groupId, status]), [[1, 'valid']]);
  assert.deepEqual(q1.notSubmitted, [{ groupId: 2, groupName: '第 2 組' }, { groupId: 3, groupName: '第 3 組' }]);
});

test('arrival order gives places and the winner with answers', () => {
  const q1 = question(monitor([record(1, 2, 2), record(1, 1, 1)]), 1);
  assert.deepEqual(q1.entries.map(({ groupName, place }) => [groupName, place]), [['第 1 組', 1], ['第 2 組', 2]]);
  assert.deepEqual(q1.winner, { groupId: 1, groupName: '第 1 組', answers: ['第1組答案'] });
  assert.equal(q1.winnerSource, 'arrival');
  assert.equal(q1.settled, true);
  assert.equal(q1.entries[0].submittedAt, '2026-11-22T00:00:01.000Z');
});

test('voided submission has no place and the next valid one wins', () => {
  const q1 = question(monitor([record(1, 1, 1, 'voided'), record(1, 2, 2)]), 1);
  assert.deepEqual(q1.entries.map(({ groupId, status, place }) => [groupId, status, place]), [[1, 'voided', null], [2, 'valid', 1]]);
  assert.equal(q1.winner.groupId, 2);
  assert.equal(q1.submittedCount, 1);
  assert.deepEqual(q1.notSubmitted.map(({ groupId }) => groupId), [3]);
});

test('a group that resubmitted after a void appears twice in entries', () => {
  const q1 = question(monitor([record(1, 1, 1, 'voided'), record(1, 2, 2), record(1, 1, 3)]), 1);
  assert.deepEqual(q1.entries.map(({ groupId, status, place }) => [groupId, status, place]), [[1, 'voided', null], [2, 'valid', 1], [1, 'valid', 2]]);
  assert.equal(q1.submittedCount, 2);
});

test('question without submissions has no winner', () => {
  const q2 = question(monitor([record(1, 1, 1)]), 2);
  assert.equal(q2.winner, null);
  assert.equal(q2.winnerSource, null);
  assert.equal(q2.submittedCount, 0);
  assert.equal(q2.notSubmitted.length, 3);
});

test('an unsettled result shows no winner', () => {
  const submissions = [record(1, 1, 1)];
  const results = computeResults({ questions, submissions }).map((result) => (
    result.questionId === 1 ? { ...result, settled: false, winner: null, winnerSource: null } : result
  ));
  const q1 = question(monitor(submissions, { results }), 1);
  assert.equal(q1.settled, false);
  assert.equal(q1.winner, null);
  assert.equal(q1.entries[0].place, 1);
});

test('questions are ordered by id and include prompt and group count', () => {
  const data = monitor([]);
  assert.deepEqual(data.questions.map(({ id, prompt }) => [id, prompt]), [[1, '第一題'], [2, '第二題']]);
  assert.equal(data.groupCount, 3);
  assert.equal(data.phase, '搶答中');
});

test('a group that no longer exists is shown by id', () => {
  const q1 = question(monitor([record(1, 9, 1)]), 1);
  assert.equal(q1.entries[0].groupName, '組 9');
  assert.equal(q1.winner.groupName, '組 9');
});

test('inputs are left unchanged', () => {
  const submissions = [record(1, 2, 2), record(1, 1, 1)];
  const input = { phase: '搶答中', questions, groups, submissions, results: computeResults({ questions, submissions }) };
  const before = structuredClone(input);
  buildMonitor(input);
  assert.deepEqual(input, before);
});
