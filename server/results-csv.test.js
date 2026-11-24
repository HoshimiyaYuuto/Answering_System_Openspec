import assert from 'node:assert/strict';
import test from 'node:test';
import { computeResults } from './results.js';
import { buildResultsCsv, escapeCsvField, formatLocalTime } from './results-csv.js';

const HEADER = '題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位';
const groups = [
  { id: 1, name: '第 1 組' },
  { id: 2, name: '第 2 組' },
];

function question(id, blankCount) {
  return { id, prompt: `第 ${id} 題`, blanks: Array.from({ length: blankCount }, (_, i) => ({ index: i + 1, prefix: '', prompt: '' })) };
}

function submission(questionId, groupId, rank, answers, { status = 'valid', submittedAt = `2026-11-24T01:02:0${rank}.000Z` } = {}) {
  return { questionId, groupId, answers, submittedAt, rank, status, voidedAt: status === 'voided' ? '2026-11-24T01:03:00.000Z' : null };
}

function csvOf({ questions, submissions, ...rest }) {
  return buildResultsCsv({ questions, groups, submissions, results: computeResults({ questions, submissions }), timeZone: 'UTC', ...rest });
}

function linesOf(csv) {
  assert.ok(csv.startsWith('﻿'), 'starts with BOM');
  assert.ok(csv.endsWith('\r\n'), 'last row ends with CRLF');
  return csv.slice(1).split('\r\n').slice(0, -1);
}

test('header, BOM and CRLF line endings', () => {
  const csv = csvOf({ questions: [question(1, 1)], submissions: [submission(1, 1, 1, ['甲'])] });
  const lines = linesOf(csv);
  assert.equal(lines[0], HEADER);
  assert.equal(csv.split('\n').length - 1, csv.split('\r\n').length - 1, 'every LF is part of CRLF');
});

test('group question with two groups produces rows by place then blank', () => {
  const lines = linesOf(csvOf({
    questions: [question(1, 2)],
    submissions: [submission(1, 2, 2, ['丙', '丁']), submission(1, 1, 1, ['甲', '乙'])],
  }));
  assert.deepEqual(lines.slice(1), [
    '1,1,第 1 組,甲,1,是,2026-11-24 01:02:01,否',
    '1,2,第 1 組,乙,1,是,2026-11-24 01:02:01,否',
    '1,1,第 2 組,丙,2,否,2026-11-24 01:02:02,否',
    '1,2,第 2 組,丁,2,否,2026-11-24 01:02:02,否',
  ]);
});

test('questions without submissions have no rows and no submissions means header only', () => {
  const questions = [question(1, 1), question(2, 1), question(3, 1)];
  const lines = linesOf(csvOf({ questions, submissions: [submission(3, 1, 1, ['x']), submission(1, 2, 1, ['y'])] }));
  assert.deepEqual(lines.slice(1).map((line) => line.split(',')[0]), ['1', '3']);
  assert.deepEqual(linesOf(csvOf({ questions, submissions: [] })), [HEADER]);
});

test('voided submission is excluded and the next one becomes place 1', () => {
  const lines = linesOf(csvOf({
    questions: [question(3, 1)],
    submissions: [submission(3, 1, 1, ['作廢'], { status: 'voided' }), submission(3, 2, 2, ['有效'])],
  }));
  assert.deepEqual(lines.slice(1), ['3,1,第 2 組,有效,1,是,2026-11-24 01:02:02,否']);
});

test('local time uses the given time zone without suffix', () => {
  assert.equal(formatLocalTime('2026-11-24T01:02:03.456Z', 'Asia/Taipei'), '2026-11-24 09:02:03');
  assert.equal(formatLocalTime('2026-11-24T01:02:03.456Z', 'UTC'), '2026-11-24 01:02:03');
  assert.equal(formatLocalTime('2026-11-23T16:30:00.000Z', 'Asia/Taipei'), '2026-11-24 00:30:00');
  assert.equal(formatLocalTime('2026-11-24T00:00:00.000Z', 'UTC'), '2026-11-24 00:00:00');
  assert.equal(formatLocalTime('not a date', 'UTC'), '');
});

test('formula prefixes and RFC 4180 quoting', () => {
  assert.equal(escapeCsvField('=1+1'), "'=1+1");
  assert.equal(escapeCsvField('+1'), "'+1");
  assert.equal(escapeCsvField('-1'), "'-1");
  assert.equal(escapeCsvField('@a'), "'@a");
  assert.equal(escapeCsvField('甲,"乙"'), '"甲,""乙"""');
  assert.equal(escapeCsvField('第一行\n第二行'), '"第一行\n第二行"');
  assert.equal(escapeCsvField('a\rb'), '"a\rb"');
  assert.equal(escapeCsvField('=a,b'), '"\'=a,b"');
  assert.equal(escapeCsvField('光合作用'), '光合作用');
  assert.equal(escapeCsvField(12), '12');
});

test('group names and answers are protected inside the csv', () => {
  const csv = buildResultsCsv({
    questions: [question(1, 1)],
    groups: [{ id: 1, name: '-第一組' }],
    submissions: [submission(1, 1, 1, ['=1+1'])],
    results: computeResults({ questions: [question(1, 1)], submissions: [submission(1, 1, 1, ['=1+1'])] }),
    timeZone: 'UTC',
  });
  assert.equal(linesOf(csv)[1], "1,1,'-第一組,'=1+1,1,是,2026-11-24 01:02:01,否");
});

test('fair ranking column', () => {
  const questions = [question(1, 1), question(2, 1)];
  const submissions = [submission(1, 1, 1, ['a']), submission(2, 2, 1, ['b'])];
  const results = [
    { questionId: 1, settled: true, winner: { groupId: 1, rank: 1 }, winnerSource: 'arrival', placings: [{ groupId: 1, rank: 1, place: 1 }] },
    { questionId: 2, settled: true, winner: { groupId: 2, rank: 1 }, winnerSource: 'fair', placings: [{ groupId: 2, rank: 1, place: 1 }] },
  ];
  const off = linesOf(buildResultsCsv({ questions, groups, submissions, results, timeZone: 'UTC' }));
  assert.deepEqual(off.slice(1).map((line) => line.split(',').at(-1)), ['否', '否']);
  const on = linesOf(buildResultsCsv({ questions, groups, submissions, results, fairRankingEnabled: true, timeZone: 'UTC' }));
  assert.deepEqual(on.slice(1).map((line) => line.split(',').at(-1)), ['是', '是（改判）']);
});

test('unknown group is shown by id', () => {
  const lines = linesOf(buildResultsCsv({
    questions: [question(1, 1)],
    groups: [],
    submissions: [submission(1, 7, 1, ['a'])],
    results: computeResults({ questions: [question(1, 1)], submissions: [submission(1, 7, 1, ['a'])] }),
    timeZone: 'UTC',
  }));
  assert.equal(lines[1].split(',')[2], '組 7');
});

test('100 groups x 50 questions with 2 blanks build within 500 ms', () => {
  const questions = Array.from({ length: 50 }, (_, i) => question(i + 1, 2));
  const manyGroups = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `第 ${i + 1} 組` }));
  const submissions = [];
  for (const q of questions) {
    manyGroups.forEach((group, index) => submissions.push(submission(q.id, group.id, index + 1, ['答案一', '答案二'], { submittedAt: '2026-11-24T01:02:03.000Z' })));
  }
  const started = performance.now();
  const csv = buildResultsCsv({ questions, groups: manyGroups, submissions, results: computeResults({ questions, submissions }) });
  const elapsed = performance.now() - started;
  assert.equal(linesOf(csv).length, 1 + 50 * 100 * 2);
  assert.ok(elapsed < 500, `took ${elapsed} ms`);
});
