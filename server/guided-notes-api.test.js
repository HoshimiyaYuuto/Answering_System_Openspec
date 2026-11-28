import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import os from 'node:os';
import { test } from 'node:test';
import { GuidedNotesImportError } from './guided-notes-import.js';
import { createApplication } from './index.js';

const fixtureDirectory = new URL('../fixtures/guided-notes/', import.meta.url);
const fixture = (name) => readFile(new URL(name, fixtureDirectory));
const sheetLink = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';

const TEST_PASSWORD = 'test-password';
const teacherCookies = new Map();

async function startApp(options = {}, host = '127.0.0.1') {
  const server = createApplication({ environment: 'production', teacherPassword: TEST_PASSWORD, ...options }).listen(0, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${url}/api/teacher/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  teacherCookies.set(url, cookie);
  return { server, url, cookie };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function call(url, path, { anonymous = false, ...options } = {}) {
  const cookie = anonymous ? undefined : teacherCookies.get(url);
  const headers = { ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) };
  const response = await fetch(`${url}${path}`, { ...options, headers });
  return { status: response.status, body: await response.json() };
}

async function importAndConfirm(url, name = '01-official-single.xlsx') {
  const preview = await uploadFile(url, await fixture(name));
  return postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
}

function uploadFile(url, buffer, name = 'sheet.xlsx', baseUrl = url) {
  return call(baseUrl, '/api/teacher/guided-notes/preview/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) },
    body: buffer,
  });
}

function postJson(url, path, body) {
  return call(url, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function questionCount(url) {
  return (await call(url, '/api/session')).body.data.questionCount;
}

function findExternalIPv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

// 3.1 上傳預覽
test('uploading a worksheet returns a summary without changing questions', async () => {
  const { server, url } = await startApp();
  try {
    const { status, body } = await uploadFile(url, await fixture('01-official-single.xlsx'), '單題範本.xlsx');
    assert.equal(status, 200);
    assert.equal(body.data.questionCount, 6);
    assert.equal(body.data.blankCount, 6);
    assert.equal(body.data.sheetName, '學習單');
    assert.deepEqual(body.data.source, { type: 'file', name: '單題範本.xlsx' });
    assert.equal(body.data.replacesExisting, false);
    assert.equal(typeof body.data.previewId, 'string');
    assert.equal(await questionCount(url), 0);
  } finally {
    await close(server);
  }
});

test('invalid worksheets return their error codes', async () => {
  const { server, url } = await startApp();
  try {
    const noHeader = await uploadFile(url, await fixture('90-invalid-no-header.xlsx'));
    assert.equal(noHeader.status, 400);
    assert.equal(noHeader.body.error.code, 'IMPORT_NO_HEADER');
    const notXlsx = await uploadFile(url, Buffer.from('plain text'));
    assert.equal(notXlsx.body.error.code, 'IMPORT_INVALID_FILE');
  } finally {
    await close(server);
  }
});

test('uploads over 5 MiB are rejected with IMPORT_FILE_TOO_LARGE', async () => {
  const { server, url } = await startApp();
  try {
    const { status, body } = await uploadFile(url, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    assert.equal(status, 413);
    assert.equal(body.error.code, 'IMPORT_FILE_TOO_LARGE');
  } finally {
    await close(server);
  }
});

test('the existing 16 KiB JSON limit still applies to other endpoints', async () => {
  const { server, url } = await startApp();
  try {
    const { status, body } = await postJson(url, '/api/groups/generate', { count: 3, padding: 'x'.repeat(17 * 1024) });
    assert.equal(status, 413);
    assert.equal(body.error.code, 'BODY_TOO_LARGE');
  } finally {
    await close(server);
  }
});

test('import is rejected outside preparation', async () => {
  const { server, url } = await startApp();
  try {
    await postJson(url, '/api/groups/generate', { count: 2 });
    await importAndConfirm(url);
    assert.equal((await call(url, '/api/session/start', { method: 'POST' })).status, 200);
    const { status, body } = await uploadFile(url, await fixture('01-official-single.xlsx'));
    assert.equal(status, 409);
    assert.equal(body.error.code, 'IMPORT_NOT_ALLOWED');
  } finally {
    await close(server);
  }
});

test('every import endpoint requires teacher login, even from loopback with a forged header', async () => {
  const { server, url } = await startApp();
  try {
    const anonymous = { anonymous: true };
    const requests = [
      call(url, '/api/teacher/guided-notes/preview/file', {
        ...anonymous,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-forwarded-for': '127.0.0.1' },
        body: await fixture('01-official-single.xlsx'),
      }),
      call(url, '/api/teacher/guided-notes/preview/link', {
        ...anonymous, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: sheetLink }),
      }),
      call(url, '/api/teacher/guided-notes/confirm', {
        ...anonymous, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId: 'x' }),
      }),
      call(url, '/api/teacher/guided-notes', anonymous),
    ];
    for (const { status, body } of await Promise.all(requests)) {
      assert.equal(status, 401);
      assert.deepEqual(body, { error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' } });
    }
    assert.equal(await questionCount(url), 0);
  } finally {
    await close(server);
  }
});

test('upload without login is rejected before the body size limit is applied', async () => {
  const { server, url } = await startApp();
  try {
    const { status, body } = await call(url, '/api/teacher/guided-notes/preview/file', {
      anonymous: true,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(5 * 1024 * 1024 + 1, 1),
    });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'TEACHER_AUTH_REQUIRED');
  } finally {
    await close(server);
  }
});

test('a logged-in teacher can import from a non-loopback address', async (t) => {
  const externalAddress = findExternalIPv4();
  if (!externalAddress) {
    t.skip('沒有可用的非 loopback IPv4 網卡，略過此測試');
    return;
  }
  const { server, cookie } = await startApp({}, '0.0.0.0');
  try {
    const lanUrl = `http://${externalAddress}:${server.address().port}`;
    teacherCookies.set(lanUrl, cookie);
    const preview = await uploadFile(lanUrl, await fixture('01-official-single.xlsx'));
    assert.equal(preview.status, 200);
    const confirmed = await postJson(lanUrl, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    assert.equal(confirmed.status, 200);
    assert.equal(await questionCount(lanUrl), 6);
  } finally {
    await close(server);
  }
});

// 3.2 連結預覽
test('link import uses the injected download function', async () => {
  const workbook = await fixture('02-official-group.xlsx');
  const requested = [];
  const downloadGuidedNotesImpl = async (link) => {
    requested.push(link);
    return { buffer: workbook, name: '雲端學習單' };
  };
  const { server, url } = await startApp({ downloadGuidedNotesImpl });
  try {
    const { status, body } = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: sheetLink });
    assert.equal(status, 200);
    assert.deepEqual(requested, [sheetLink]);
    assert.deepEqual(body.data.source, { type: 'link', name: '雲端學習單' });
    assert.equal(body.data.questionCount, 4);
  } finally {
    await close(server);
  }
});

test('linked import keeps the spreadsheet id out of every teacher and student response', async () => {
  const workbook = await fixture('02-official-group.xlsx');
  const spreadsheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const downloadGuidedNotesImpl = async () => ({ buffer: workbook, name: '雲端學習單', spreadsheetId });
  const { server, url } = await startApp({ downloadGuidedNotesImpl });
  try {
    const preview = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: sheetLink });
    const confirmed = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    const status = await call(url, '/api/teacher/guided-notes');
    const writeback = await call(url, '/api/teacher/guided-notes/writeback');
    assert.equal(writeback.status, 200);
    assert.equal(writeback.body.data.target, 'link');

    await postJson(url, '/api/groups/generate', { count: 1 });
    await call(url, '/api/student/entry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'stu-aaaa1111', groupId: 1 }),
    });
    await call(url, '/api/session/start', { method: 'POST' });
    const studentQuestions = await call(url, '/api/student/questions?studentId=stu-aaaa1111', { anonymous: true });
    assert.equal(studentQuestions.status, 200);
    const session = await call(url, '/api/session', { anonymous: true });
    for (const body of [preview.body, confirmed.body, status.body, writeback.body, studentQuestions.body, session.body]) {
      assert.doesNotMatch(JSON.stringify(body), new RegExp(spreadsheetId));
    }

    await call(url, '/api/session/end', { method: 'POST' });
  } finally {
    await close(server);
  }
});

test('uploading after a linked import removes the write-back target', async () => {
  const workbook = await fixture('02-official-group.xlsx');
  const downloadGuidedNotesImpl = async () => ({ buffer: workbook, name: '雲端學習單', spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' });
  const { server, url } = await startApp({ downloadGuidedNotesImpl });
  try {
    const preview = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: sheetLink });
    await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    assert.equal((await call(url, '/api/teacher/guided-notes/writeback')).body.data.target, 'link');
    await importAndConfirm(url, '01-official-single.xlsx');
    assert.equal((await call(url, '/api/teacher/guided-notes/writeback')).body.data.target, 'file');
  } finally {
    await close(server);
  }
});

test('link errors are returned in the contract envelope', async () => {
  const downloadGuidedNotesImpl = async (link) => {
    if (!String(link).startsWith('https://docs.google.com/')) {
      throw new GuidedNotesImportError('IMPORT_INVALID_LINK', '只接受 Google 試算表的連結。');
    }
    throw new GuidedNotesImportError('IMPORT_LINK_UNREACHABLE', '無法下載這份試算表。', 502);
  };
  const { server, url } = await startApp({ downloadGuidedNotesImpl });
  try {
    const invalid = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: 'https://example.com/x.xlsx' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'IMPORT_INVALID_LINK');
    const unreachable = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: sheetLink });
    assert.equal(unreachable.status, 502);
    assert.equal(unreachable.body.error.code, 'IMPORT_LINK_UNREACHABLE');
  } finally {
    await close(server);
  }
});

test('the default link download rejects non-Google URLs without network access', async () => {
  const { server, url } = await startApp();
  try {
    const { status, body } = await postJson(url, '/api/teacher/guided-notes/preview/link', { url: 'http://127.0.0.1:1/x' });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'IMPORT_INVALID_LINK');
  } finally {
    await close(server);
  }
});

// 3.3 確認與目前狀態
test('confirm applies questions, replaces them on re-import and rejects outdated previews', async () => {
  const { server, url } = await startApp();
  try {
    assert.equal((await call(url, '/api/teacher/guided-notes')).body.data.current, null);

    const single = await uploadFile(url, await fixture('01-official-single.xlsx'));
    const confirmed = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: single.body.data.previewId });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.current.questionCount, 6);
    assert.equal(await questionCount(url), 6);

    const outdated = await uploadFile(url, await fixture('01-official-single.xlsx'));
    const group = await uploadFile(url, await fixture('02-official-group.xlsx'));
    assert.equal(group.body.data.replacesExisting, true);
    const rejected = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: outdated.body.data.previewId });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error.code, 'IMPORT_PREVIEW_EXPIRED');
    assert.equal(await questionCount(url), 6);

    await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: group.body.data.previewId });
    assert.equal(await questionCount(url), 4);
    const current = (await call(url, '/api/teacher/guided-notes')).body.data.current;
    assert.equal(current.questionCount, 4);
    assert.equal(current.questions[0].type, 'group');
    assert.doesNotMatch(JSON.stringify(current), /anchorCell|answerCell|H5/);
  } finally {
    await close(server);
  }
});

test('failed imports keep existing questions', async () => {
  const { server, url } = await startApp();
  try {
    const single = await uploadFile(url, await fixture('01-official-single.xlsx'));
    await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: single.body.data.previewId });
    const failed = await uploadFile(url, await fixture('91-invalid-duplicate-number.xlsx'));
    assert.equal(failed.body.error.code, 'IMPORT_DUPLICATE_NUMBER');
    assert.equal(await questionCount(url), 6);
  } finally {
    await close(server);
  }
});

test('confirm is rejected outside preparation', async () => {
  const { server, url } = await startApp();
  try {
    await postJson(url, '/api/groups/generate', { count: 2 });
    await importAndConfirm(url);
    const preview = await uploadFile(url, await fixture('02-official-group.xlsx'));
    assert.equal((await call(url, '/api/session/start', { method: 'POST' })).status, 200);
    const { status, body } = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'IMPORT_NOT_ALLOWED');
    assert.equal(await questionCount(url), 6);
  } finally {
    await close(server);
  }
});

// add-teacher-language-switch task 1.1：預覽與確認後的摘要都帶出結構化提醒
test('preview and confirmed summary carry warning details next to the warning texts', async () => {
  const { server, url } = await startApp();
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('提醒');
    [['題號', '題目', '作答', ''], [1, '空白', '', ''], [2, '已有答案', '上次的答案', '']]
      .forEach((row, index) => { sheet.getRow(index + 1).values = row; });
    for (const range of ['C1:D1', 'C2:D2', 'C3:D3']) sheet.mergeCells(range);
    const preview = await uploadFile(url, Buffer.from(await workbook.xlsx.writeBuffer()));
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.data.warnings, ['第 2 題第 1 格（C3）已有內容，匯出時會被取代。']);
    const details = [{ code: 'ANSWER_CELL_NOT_EMPTY', questionId: 2, blankIndex: 1, cell: 'C3' }];
    assert.deepEqual(preview.body.data.warningDetails, details);

    const confirmed = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(confirmed.body.data.current.warningDetails, details);
    const current = await call(url, '/api/teacher/guided-notes');
    assert.deepEqual(current.body.data.current.warningDetails, details);
    assert.deepEqual(current.body.data.current.warnings, preview.body.data.warnings);

    const clean = await uploadFile(url, await fixture('01-official-single.xlsx'));
    assert.deepEqual(clean.body.data.warnings, []);
    assert.deepEqual(clean.body.data.warningDetails, []);
  } finally {
    await close(server);
  }
});
