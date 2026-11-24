import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { GuidedNotesExportError } from './guided-notes-export.js';
import { close, startApp } from './export-app-fixture.js';

const SERVICE_EMAIL = 'writer@test-project.iam.gserviceaccount.com';
const SHEET_ID = 'sheet-id-123456';
const fixture = (name) => readFile(new URL(`../fixtures/guided-notes/${name}`, import.meta.url));

// 匯入版與「在第 3 列上方插入一列」版：第 1 題單題 G:H 合併，第 2 題題號可改
async function layoutBuffer({ offset = 0, number2 = 2 } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('學習單');
  const row = (n) => n + offset;
  sheet.getCell(`E${row(4)}`).value = '題號';
  sheet.getCell(`F${row(4)}`).value = '題目';
  sheet.getCell(`G${row(4)}`).value = '作答';
  sheet.mergeCells(`G${row(4)}:H${row(4)}`);
  sheet.getCell(`E${row(5)}`).value = 1;
  sheet.getCell(`F${row(5)}`).value = '第一題';
  sheet.mergeCells(`G${row(5)}:H${row(5)}`);
  sheet.getCell(`E${row(6)}`).value = number2;
  sheet.getCell(`F${row(6)}`).value = '第二題';
  sheet.mergeCells(`G${row(6)}:H${row(6)}`);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// 第一次下載是匯入，之後的下載是寫回前的重新讀取
function linkDownloads(importBuffer, { reread } = {}) {
  const calls = [];
  const impl = async (link) => {
    calls.push(link);
    if (calls.length === 1) return { buffer: importBuffer, name: '雲端學習單', spreadsheetId: SHEET_ID };
    if (reread instanceof Error) throw reread;
    return { buffer: reread ?? importBuffer, name: '雲端學習單', spreadsheetId: SHEET_ID };
  };
  return { impl, calls };
}

function fakeClient({ fail, gate } = {}) {
  const calls = [];
  return {
    calls,
    serviceAccountEmail: SERVICE_EMAIL,
    async batchUpdateValues(spreadsheetId, sheetName, writes) {
      calls.push({ spreadsheetId, sheetName, writes });
      if (gate) await gate;
      if (fail) throw fail;
      return { writtenCells: writes.length };
    },
  };
}

const writeback = (app) => app.teacher('/api/teacher/guided-notes/writeback', { method: 'POST' });

async function errorOf(response) {
  return { status: response.status, ...(await response.json()).error };
}

test('writeback checks login, phase, import, link source and configuration in order', async () => {
  const downloads = linkDownloads(await layoutBuffer());
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: null });
  try {
    assert.equal((await fetch(`${app.url}/api/teacher/guided-notes/writeback`, { method: 'POST' })).status, 401);
    assert.equal((await errorOf(await writeback(app))).code, 'EXPORT_NOT_ALLOWED');
    await app.importLink();
    const config = await (await app.teacher('/api/teacher/guided-notes/writeback')).json();
    assert.deepEqual(config.data, { configured: false, serviceAccountEmail: null, target: 'link' });
    await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
    const before = await app.summary();
    assert.deepEqual(await errorOf(await writeback(app)), {
      status: 503,
      code: 'SHEET_NOT_CONFIGURED',
      message: 'server 尚未設定 Google 服務帳號，無法寫回。請依 README 設定，或改用「下載 xlsx」。',
    });
    assert.deepEqual({ ...(await app.summary()), serverTime: null }, { ...before, serverTime: null });
  } finally {
    await close(app.server);
  }

  const dev = await startApp({ environment: 'development', sheetsClient: fakeClient() });
  try {
    await fetch(`${dev.url}/api/dev/phase/${encodeURIComponent('已結束')}`, { method: 'POST' });
    assert.equal((await errorOf(await writeback(dev))).code, 'NO_GUIDED_NOTES');
    const config = await (await dev.teacher('/api/teacher/guided-notes/writeback')).json();
    assert.deepEqual(config.data, { configured: true, serviceAccountEmail: SERVICE_EMAIL, target: null });
  } finally {
    await close(dev.server);
  }
});

test('the writeback config needs login and exposes only the three public fields', async () => {
  const app = await startApp({ sheetsClient: fakeClient() });
  try {
    const anonymous = await fetch(`${app.url}/api/teacher/guided-notes/writeback`);
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' } });

    // 登入後也只有設定狀態、服務帳號信箱與匯入來源，不含金鑰檔路徑或私鑰
    const config = await (await app.teacher('/api/teacher/guided-notes/writeback')).json();
    assert.deepEqual(config, { data: { configured: true, serviceAccountEmail: SERVICE_EMAIL, target: null } });
    assert.doesNotMatch(JSON.stringify(config), /\.json|PRIVATE KEY|GOOGLE_SERVICE_ACCOUNT_KEY_FILE/);
  } finally {
    await close(app.server);
  }
});

test('an uploaded import cannot be written back', async () => {
  const client = fakeClient();
  const app = await startApp({ sheetsClient: client });
  try {
    await app.importFile('01-official-single.xlsx');
    assert.equal((await (await app.teacher('/api/teacher/guided-notes/writeback')).json()).data.target, 'file');
    await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
    const error = await errorOf(await writeback(app));
    assert.equal(error.status, 409);
    assert.equal(error.code, 'GUIDED_NOTES_NOT_LINK');
    assert.match(error.message, /下載 xlsx/);
    assert.equal(client.calls.length, 0);
  } finally {
    await close(app.server);
  }
});

test('without winners the response is zero cells and Google is not contacted', async () => {
  const downloads = linkDownloads(await layoutBuffer());
  const client = fakeClient();
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: client });
  try {
    await app.importLink();
    await app.runSession();
    const response = await writeback(app);
    assert.deepEqual(await response.json(), { data: { writtenCells: 0, remapped: false } });
    assert.equal(client.calls.length, 0);
    assert.equal(downloads.calls.length, 1);
  } finally {
    await close(app.server);
  }
});

test('a successful writeback re-reads the sheet and writes relocated cells', async () => {
  const downloads = linkDownloads(await layoutBuffer(), { reread: await layoutBuffer({ offset: 1 }) });
  const client = fakeClient();
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: client });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['甲']], ['stu-bbbb2222', 1, ['乙']], ['stu-bbbb2222', 2, ['=1+1']]]);
    const response = await writeback(app);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { writtenCells: 2, remapped: true } });
    assert.deepEqual(downloads.calls[1], `https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
    assert.deepEqual(client.calls, [{
      spreadsheetId: SHEET_ID,
      sheetName: '學習單',
      writes: [{ cell: 'G6', value: '甲' }, { cell: 'G7', value: '=1+1' }],
    }]);
  } finally {
    await close(app.server);
  }
});

test('an unchanged sheet is written in place with remapped false', async () => {
  const downloads = linkDownloads(await layoutBuffer());
  const client = fakeClient();
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: client });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
    assert.deepEqual(await (await writeback(app)).json(), { data: { writtenCells: 1, remapped: false } });
    assert.deepEqual(client.calls[0].writes, [{ cell: 'G5', value: '甲' }]);
  } finally {
    await close(app.server);
  }
});

test('re-read failures and changed layouts are refused without writing', async () => {
  for (const [reread, code, status, pattern] of [
    [new Error('network'), 'SHEET_CHECK_FAILED', 502, /知道連結者可檢視/],
    [await layoutBuffer({ number2: 20 }), 'SHEET_MODIFIED', 409, /第 2 題/],
    [await fixture('90-invalid-no-header.xlsx'), 'SHEET_MODIFIED', 409, /表頭/],
  ]) {
    const downloads = linkDownloads(await layoutBuffer(), { reread });
    const client = fakeClient();
    const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: client });
    try {
      await app.importLink();
      await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
      const before = await app.summary();
      const error = await errorOf(await writeback(app));
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.match(error.message, pattern);
      assert.equal(client.calls.length, 0);
      assert.deepEqual({ ...(await app.summary()), serverTime: null }, { ...before, serverTime: null });
    } finally {
      await close(app.server);
    }
  }
});

test('Google errors from the client are returned as they are', async () => {
  const fail = new GuidedNotesExportError('SHEET_NOT_EDITABLE', `請把試算表共用給 ${SERVICE_EMAIL} 並設為「編輯者」。也可以改用「下載 xlsx」。`, 422);
  const downloads = linkDownloads(await layoutBuffer());
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: fakeClient({ fail }) });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
    assert.deepEqual(await errorOf(await writeback(app)), { status: 422, code: 'SHEET_NOT_EDITABLE', message: fail.message });
  } finally {
    await close(app.server);
  }
});

test('a second writeback while the first is running is rejected', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = fakeClient({ gate });
  const downloads = linkDownloads(await layoutBuffer());
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: client });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['甲']]]);
    const first = writeback(app);
    while (client.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(await errorOf(await writeback(app)), { status: 409, code: 'WRITEBACK_IN_PROGRESS', message: '寫回正在進行中，請稍候。' });
    release();
    assert.equal((await first).status, 200);
    assert.equal((await writeback(app)).status, 200);
  } finally {
    await close(app.server);
  }
});

test('writeback logs only cell counts and error codes', async () => {
  const lines = [];
  const logger = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const downloads = linkDownloads(await layoutBuffer(), { reread: await layoutBuffer({ number2: 20 }) });
  const app = await startApp({ downloadGuidedNotesImpl: downloads.impl, sheetsClient: fakeClient(), logger });
  try {
    await app.importLink();
    await app.runSession([['stu-aaaa1111', 1, ['秘密答案']]]);
    await writeback(app);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /寫回失敗：SHEET_MODIFIED$/);
    assert.doesNotMatch(lines.join('\n'), /秘密答案|sheet-id-123456/);
  } finally {
    await close(app.server);
  }
});
