// 把判定結果與作答紀錄轉成結果 csv。純函式，design 第 2、3、4 節；欄位見 docs/submission-record.md 第 3 節。

export const RESULTS_CSV_HEADER = ['題號', '空格序', '組別', '答案', '順位', '是否搶答成功', '送出時間', '公平順位'];

const FORMULA_PREFIX = /^[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]/;

// 先防公式，再依 RFC 4180 加引號
export function escapeCsvField(value) {
  let text = String(value ?? '');
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (NEEDS_QUOTES.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

// 建立 Intl.DateTimeFormat 很慢，依時區快取（undefined 表示 server 系統時區）
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

// ISO 8601 UTC → 指定時區的 YYYY-MM-DD HH:mm:ss；timeZone 未指定時用 server 系統時區
export function formatLocalTime(isoString, timeZone) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function fairColumn(fairRankingEnabled, result) {
  if (!fairRankingEnabled) return '否';
  return result.winnerSource === 'fair' ? '是（改判）' : '是';
}

export function buildResultsCsv({
  questions = [],
  groups = [],
  submissions = [],
  results = [],
  fairRankingEnabled = false,
  timeZone,
} = {}) {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const groupNames = new Map(groups.map(({ id, name }) => [id, name]));
  const submissionsByKey = new Map(submissions.map((item) => [`${item.questionId}:${item.rank}`, item]));
  const rows = [RESULTS_CSV_HEADER];

  for (const result of results) {
    const question = questionsById.get(result.questionId);
    if (!question) continue;
    const blanks = [...question.blanks].sort((left, right) => left.index - right.index);
    const fair = fairColumn(fairRankingEnabled, result);
    const placings = [...result.placings].sort((left, right) => left.place - right.place);
    for (const placing of placings) {
      const submission = submissionsByKey.get(`${result.questionId}:${placing.rank}`);
      if (!submission) continue;
      const isWinner = result.winner?.rank === placing.rank;
      const groupName = groupNames.get(placing.groupId) ?? `組 ${placing.groupId}`;
      const time = formatLocalTime(submission.submittedAt, timeZone);
      blanks.forEach((blank, index) => {
        rows.push([
          result.questionId,
          blank.index,
          groupName,
          submission.answers[index] ?? '',
          placing.place,
          isWinner ? '是' : '否',
          time,
          fair,
        ]);
      });
    }
  }

  return `﻿${rows.map((row) => `${row.map(escapeCsvField).join(',')}\r\n`).join('')}`;
}
