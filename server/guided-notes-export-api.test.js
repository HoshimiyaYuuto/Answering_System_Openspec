import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { close, startApp } from './export-app-fixture.js';

const fixture = (name) => readFile(new URL(`../fixtures/guided-notes/${name}`, import.meta.url));

async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

test('download requires login, an ended session and an import', async () => {
  const app = await startApp();
  try {
    assert.equal((await fetch(`${app.url}/api/teacher/guided-notes/export`)).status, 401);
    assert.deepEqual(await errorOf(await app.teacher('/api/teacher/guided-notes/export')), {
      status: 409, code: 'EXPORT_NOT_ALLOWED', message: '活動結束後才能匯出。',
    });
    await app.importFile('01-official-single.xlsx');
    await app.teacher('/api/groups/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ count: 1 }) });
    await app.teacher('/api/session/start', { method: 'POST' });
    assert.equal((await errorOf(await app.teacher('/api/teacher/guided-notes/export'))).code, 'EXPORT_NOT_ALLOWED');
  } finally {
    await close(app.server);
  }

  const dev = await startApp({ environment: 'development' });
  try {
    await fetch(`${dev.url}/api/dev/phase/${encodeURIComponent('已結束')}`, { method: 'POST' });
    assert.deepEqual(await errorOf(await dev.teacher('/api/teacher/guided-notes/export')), {
      status: 409, code: 'NO_GUIDED_NOTES', message: '尚未匯入學習單，無法匯出。',
    });
  } finally {
    await close(dev.server);
  }
});

test('an ended uploaded session downloads an xlsx with the winning answers', async () => {
  const app = await startApp();
  try {
    await app.importFile('01-official-single.xlsx');
    await app.runSession([['stu-aaaa1111', 1, ['光合作用']], ['stu-bbbb2222', 1, ['呼吸作用']], ['stu-bbbb2222', 2, ['=1+1']]]);
    const before = await app.summary();
    const response = await app.teacher('/api/teacher/guided-notes/export');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const disposition = response.headers.get('content-disposition');
    assert.match(disposition, /filename\*=UTF-8''/);
    assert.equal(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(disposition)[1]), '01-official-single（搶答結果）.xlsx');
    const sheet = await readSheet(Buffer.from(await response.arrayBuffer()));
    assert.equal(sheet.getCell('G5').value, '光合作用');
    const after = await app.summary();
    assert.deepEqual({ ...after, serverTime: null }, { ...before, serverTime: null });
  } finally {
    await close(app.server);
  }
});

test('a linked import can also be downloaded', async () => {
  const workbook = await fixture('02-official-group.xlsx');
  const app = await startApp({ downloadGuidedNotesImpl: async () => ({ buffer: workbook, name: '雲端學習單', spreadsheetId: 'sheet-id-123456' }) });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['甲', '乙']]]);
    const response = await app.teacher('/api/teacher/guided-notes/export');
    assert.equal(response.status, 200);
    const sheet = await readSheet(Buffer.from(await response.arrayBuffer()));
    assert.equal(sheet.getCell('H5').value, '甲');
    assert.equal(sheet.getCell('H6').value, '乙');
    assert.equal(sheet.getCell('G5').value, '（1）');
  } finally {
    await close(app.server);
  }
});

test('voided submissions are not exported', async () => {
  const records = [
    { questionId: 1, groupId: 1, answers: ['作廢的答案'], submittedAt: '2026-11-22T00:00:00.000Z', rank: 1, status: 'voided' },
    { questionId: 1, groupId: 2, answers: ['有效答案'], submittedAt: '2026-11-22T00:00:01.000Z', rank: 2, status: 'valid' },
  ];
  const submissions = { listSubmissions: () => records.map((record) => ({ ...record })), listByGroup: () => [], subscribe: () => () => {}, submit: () => ({ ok: false, code: 'SUBMISSION_NOT_ALLOWED' }) };
  const app = await startApp({ submissions });
  try {
    await app.importFile('01-official-single.xlsx');
    await app.runSession();
    const sheet = await readSheet(Buffer.from(await (await app.teacher('/api/teacher/guided-notes/export')).arrayBuffer()));
    assert.equal(sheet.getCell('G5').value, '有效答案');
  } finally {
    await close(app.server);
  }
});
