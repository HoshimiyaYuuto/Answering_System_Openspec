import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { test } from 'node:test';
import { GuidedNotesImportError } from './guided-notes-import.js';
import { createApplication } from './index.js';

const fixtureDirectory = new URL('../fixtures/guided-notes/', import.meta.url);
const fixture = (name) => readFile(new URL(name, fixtureDirectory));
const sheetLink = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';

async function startApp(options = {}, host = '127.0.0.1') {
  const server = createApplication({ environment: 'production', ...options }).listen(0, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function call(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, options);
  return { status: response.status, body: await response.json() };
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
    await call(url, '/api/session/start', { method: 'POST' });
    const { status, body } = await uploadFile(url, await fixture('01-official-single.xlsx'));
    assert.equal(status, 409);
    assert.equal(body.error.code, 'IMPORT_NOT_ALLOWED');
  } finally {
    await close(server);
  }
});

test('non-loopback import is rejected even with a forged forwarded header', async (t) => {
  const externalAddress = findExternalIPv4();
  if (!externalAddress) {
    t.skip('沒有可用的非 loopback IPv4 網卡，略過此測試');
    return;
  }
  const { server } = await startApp({}, '0.0.0.0');
  try {
    const { port } = server.address();
    const response = await fetch(`http://${externalAddress}:${port}/api/teacher/guided-notes/preview/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'x-forwarded-for': '127.0.0.1' },
      body: await fixture('01-official-single.xlsx'),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'LOOPBACK_ONLY');
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
    const preview = await uploadFile(url, await fixture('01-official-single.xlsx'));
    await call(url, '/api/session/start', { method: 'POST' });
    const { status, body } = await postJson(url, '/api/teacher/guided-notes/confirm', { previewId: preview.body.data.previewId });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'IMPORT_NOT_ALLOWED');
    assert.equal(await questionCount(url), 0);
  } finally {
    await close(server);
  }
});
