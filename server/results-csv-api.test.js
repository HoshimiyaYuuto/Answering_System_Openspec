import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { close, startApp } from './export-app-fixture.js';

const fixture = (name) => readFile(new URL(`../fixtures/guided-notes/${name}`, import.meta.url));
const CSV_PATH = '/api/teacher/results/csv';

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

function rowsOf(text) {
  return text.replace(/^﻿/, '').split('\r\n').slice(0, -1).map((line) => line.split(','));
}

test('csv requires login and an ended session', async () => {
  const app = await startApp();
  try {
    assert.equal((await errorOf(await fetch(`${app.url}${CSV_PATH}`))).code, 'TEACHER_AUTH_REQUIRED');
    assert.deepEqual(await errorOf(await app.teacher(CSV_PATH)), { status: 409, code: 'EXPORT_NOT_ALLOWED', message: '活動結束後才能匯出。' });
    await app.importFile('02-official-group.xlsx');
    await app.teacher('/api/groups/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 1 }) });
    await app.teacher('/api/session/start', { method: 'POST' });
    assert.equal((await errorOf(await app.teacher(CSV_PATH))).code, 'EXPORT_NOT_ALLOWED');
  } finally {
    await close(app.server);
  }
});

test('an ended uploaded session downloads a csv consistent with monitoring', async () => {
  const app = await startApp();
  try {
    await app.importFile('02-official-group.xlsx');
    await app.runSession([
      ['stu-bbbb2222', 1, ['丙', '=1+1']],
      ['stu-aaaa1111', 1, ['甲', '乙,丁']],
      ['stu-aaaa1111', 3, ['0']],
    ]);
    const summaryBefore = await app.summary();
    const monitorBefore = await (await app.teacher('/api/teacher/monitor')).json();

    const response = await app.teacher(CSV_PATH);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    const disposition = response.headers.get('content-disposition');
    assert.match(disposition, /filename\*=UTF-8''/);
    assert.equal(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(disposition)[1]), '02-official-group（搶答結果）.csv');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    const text = bytes.toString('utf8');
    assert.match(text, /'=1\+1/);
    assert.match(text, /"乙,丁"/);
    const rows = rowsOf(text.replace('"乙,丁"', '乙丁'));
    assert.deepEqual(rows[0], ['題號', '空格序', '組別', '答案', '順位', '是否搶答成功', '送出時間', '公平順位']);
    assert.deepEqual(rows.slice(1).map((row) => [row[0], row[1], row[2], row[4], row[5], row[7]]), [
      ['1', '1', '第 2 組', '1', '是', '否'],
      ['1', '2', '第 2 組', '1', '是', '否'],
      ['1', '1', '第 1 組', '2', '否', '否'],
      ['1', '2', '第 1 組', '2', '否', '否'],
      ['3', '1', '第 1 組', '1', '是', '否'],
    ]);
    for (const row of rows.slice(1)) assert.match(row[6], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // 與老師監看的名次與勝者一致
    const monitor = monitorBefore.data.questions.find((question) => question.id === 1);
    assert.equal(monitor.winner.groupName, '第 2 組');
    assert.deepEqual(monitor.entries.map((entry) => [entry.groupName, entry.place]), [['第 2 組', 1], ['第 1 組', 2]]);

    // 下載不改變任何狀態
    assert.deepEqual({ ...(await app.summary()), serverTime: null }, { ...summaryBefore, serverTime: null });
    assert.deepEqual(await (await app.teacher('/api/teacher/monitor')).json(), monitorBefore);
  } finally {
    await close(app.server);
  }
});

test('a link-imported session also downloads a csv', async () => {
  const workbook = await fixture('01-official-single.xlsx');
  const app = await startApp({
    downloadGuidedNotesImpl: async () => ({ buffer: workbook, name: '雲端學習單', spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }),
  });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['光合作用']]]);
    const response = await app.teacher(CSV_PATH);
    assert.equal(response.status, 200);
    assert.equal(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(response.headers.get('content-disposition'))[1]), '雲端學習單（搶答結果）.csv');
    const rows = rowsOf(await response.text());
    assert.deepEqual(rows.slice(1).map((row) => row.slice(0, 6)), [['1', '1', '第 1 組', '光合作用', '1', '是']]);
  } finally {
    await close(app.server);
  }
});

test('an ended session without submissions returns only the header', async () => {
  const app = await startApp();
  try {
    await app.importFile('02-official-group.xlsx');
    await app.runSession([]);
    const rows = rowsOf(await (await app.teacher(CSV_PATH)).text());
    assert.equal(rows.length, 1);
  } finally {
    await close(app.server);
  }
});
