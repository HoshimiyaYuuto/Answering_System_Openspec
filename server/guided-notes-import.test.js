import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import {
  createGuidedNotesImport,
  downloadGuidedNotes,
  GuidedNotesImportError,
  parseGuidedNotes,
  toGoogleSheetsExportUrl,
} from './guided-notes-import.js';

const fixtureDirectory = new URL('../fixtures/guided-notes/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('expected.json', fixtureDirectory), 'utf8'));

function fixture(name) {
  return readFile(new URL(name, fixtureDirectory));
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof GuidedNotesImportError && error.code === code);
}

async function buildWorkbook(rows, merges = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('自製');
  rows.forEach((row, index) => {
    sheet.getRow(index + 1).values = row;
  });
  for (const range of merges) sheet.mergeCells(range);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function assertMatchesExpected(parsed, entry) {
  assert.equal(parsed.sheetName, entry.sheet);
  assert.equal(parsed.headerRow, entry.header_row);
  assert.equal(parsed.questions.length, entry.question_count);
  assert.equal(parsed.questions.reduce((total, question) => total + question.blanks.length, 0), entry.blank_count);
  assert.deepEqual(
    parsed.questions.map((question) => ({
      number: question.id,
      blanks: question.blanks.map((blank) => ({ cell: blank.anchorCell, prefix: blank.prefix })),
    })),
    entry.questions,
  );
}

// 2.1 表頭定位、工作表選擇與單題辨識
for (const file of ['01-official-single.xlsx', '03-shifted-layout.xlsx', '05-two-sheets.xlsx']) {
  test(`${file} matches expected sheet, header row, numbers and anchor cells`, async () => {
    const entry = expected.find((item) => item.file === file);
    assertMatchesExpected(await parseGuidedNotes(await fixture(file)), entry);
  });
}

test('question numbers accept numeric and digit-string values and skip other rows', async () => {
  const buffer = await buildWorkbook([
    ['', ''],
    ['題號', '題目', '作答'],
    [1, '數值題號'],
    ['備註', '不是題目'],
    ['2', '文字題號'],
    [1.5, '小數不是題號'],
    [0, '零不是題號'],
    [3, ''],
  ]);
  const parsed = await parseGuidedNotes(buffer);
  assert.deepEqual(parsed.questions.map((question) => question.id), [1, 2, 3]);
  assert.equal(parsed.questions[2].prompt, '');
  assert.equal(parsed.questions[2].blanks.length, 1);
});

// 2.2 題組、前綴與答案寫入位置
for (const file of ['02-official-group.xlsx', '04-mixed-groups.xlsx']) {
  test(`${file} matches expected groups and prefixes`, async () => {
    const entry = expected.find((item) => item.file === file);
    assertMatchesExpected(await parseGuidedNotes(await fixture(file)), entry);
  });
}

test('answer cell is the empty cell right of the prefix when the answer area is not merged', async () => {
  const parsed = await parseGuidedNotes(await fixture('02-official-group.xlsx'));
  assert.deepEqual(parsed.questions[0].blanks.map((blank) => blank.answerCell), ['H5', 'H6']);
  assert.equal(parsed.questions[2].blanks[0].answerCell, 'G11');
});

test('answer cell equals the merged anchor cell for merged answer areas', async () => {
  const single = await parseGuidedNotes(await fixture('01-official-single.xlsx'));
  assert.equal(single.questions[0].blanks[0].answerCell, 'G5');
  const mixed = await parseGuidedNotes(await fixture('04-mixed-groups.xlsx'));
  assert.deepEqual(mixed.questions[1].blanks.map((blank) => blank.answerCell), ['G7', 'G8', 'G9']);
});

test('group prompts are kept per blank and joined for the question', async () => {
  const parsed = await parseGuidedNotes(await fixture('02-official-group.xlsx'));
  const [first, second] = parsed.questions[0].blanks;
  assert.ok(first.prompt.length > 0 && second.prompt.length > 0);
  assert.equal(parsed.questions[0].prompt, `${first.prompt}\n${second.prompt}`);
});

test('existing non-prefix content in an answer cell produces a warning', async () => {
  const buffer = await buildWorkbook(
    [
      ['題號', '題目', '作答', ''],
      [1, '已有答案', '上次的答案', ''],
      [2, '空白', '', ''],
    ],
    ['C1:D1', 'C2:D2', 'C3:D3'],
  );
  const parsed = await parseGuidedNotes(buffer);
  assert.equal(parsed.questions[0].blanks[0].prefix, '');
  assert.equal(parsed.questions[0].blanks[0].answerCell, 'C2');
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /第 1 題.*C2.*已有內容/);
});

// 2.3 錯誤
test('missing header row is rejected', async () => {
  await rejectsWithCode(parseGuidedNotes(await fixture('90-invalid-no-header.xlsx')), 'IMPORT_NO_HEADER');
});

test('duplicate question number is rejected with number and rows', async () => {
  await assert.rejects(parseGuidedNotes(await fixture('91-invalid-duplicate-number.xlsx')), (error) => {
    assert.equal(error.code, 'IMPORT_DUPLICATE_NUMBER');
    assert.match(error.message, /題號 3 重複：第 9 列與第 11 列/);
    return true;
  });
});

test('header without questions is rejected', async () => {
  await rejectsWithCode(parseGuidedNotes(await fixture('92-invalid-empty.xlsx')), 'IMPORT_NO_QUESTIONS');
});

test('empty, non-xlsx and corrupted contents are rejected as invalid files', async () => {
  await rejectsWithCode(parseGuidedNotes(Buffer.alloc(0)), 'IMPORT_INVALID_FILE');
  await rejectsWithCode(parseGuidedNotes(Buffer.from('<html>not a workbook</html>')), 'IMPORT_INVALID_FILE');
  const corrupted = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]);
  await rejectsWithCode(parseGuidedNotes(corrupted), 'IMPORT_INVALID_FILE');
});

// 2.4 匯入狀態
test('confirm applies only the latest preview and exposes public questions without cell data', async () => {
  const store = createGuidedNotesImport();
  const fileBuffer = await fixture('02-official-group.xlsx');
  const parsed = await parseGuidedNotes(fileBuffer);
  const older = store.createPreview({ parsed, source: { type: 'file', name: 'old.xlsx' }, fileBuffer, replacesExisting: false });
  const latest = store.createPreview({ parsed, source: { type: 'file', name: '02.xlsx' }, fileBuffer, replacesExisting: true });

  assert.equal(latest.questionCount, 4);
  assert.equal(latest.blankCount, 6);
  assert.equal(latest.replacesExisting, true);
  assert.deepEqual(latest.questions[0], { id: 1, type: 'group', blankCount: 2, prefixes: ['（1）', '（2）'] });
  assert.equal(store.currentSummary(), null);

  assert.throws(() => store.confirm(older.previewId), (error) => error.code === 'IMPORT_PREVIEW_EXPIRED' && error.status === 409);
  const { questions, summary } = store.confirm(latest.previewId);
  assert.equal(summary.questionCount, 4);
  assert.equal(summary.source.name, '02.xlsx');
  assert.deepEqual(questions[0].blanks.map((blank) => Object.keys(blank).sort()), [
    ['index', 'prefix', 'prompt'],
    ['index', 'prefix', 'prompt'],
  ]);
  const serialized = JSON.stringify(questions);
  assert.doesNotMatch(serialized, /anchorCell|answerCell|fileBuffer|H5/);

  assert.throws(() => store.confirm(latest.previewId), (error) => error.code === 'IMPORT_PREVIEW_EXPIRED');
  const exportSource = store.exportSource();
  assert.equal(exportSource.sheetName, '學習單');
  assert.equal(exportSource.questions[0].blanks[0].answerCell, 'H5');
  assert.ok(exportSource.fileBuffer.equals(fileBuffer));
});

// 2.5 Google 試算表連結
const sheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

test('only Google Sheets https links are converted to an export URL', () => {
  assert.equal(
    toGoogleSheetsExportUrl(`https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`).exportUrl,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
  );
  for (const link of [
    `http://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    `https://evil.example/spreadsheets/d/${sheetId}/edit`,
    `https://docs.google.com.evil.example/spreadsheets/d/${sheetId}`,
    `https://docs.google.com/document/d/${sheetId}/edit`,
    'not a url',
    '',
  ]) {
    assert.throws(() => toGoogleSheetsExportUrl(link), (error) => error.code === 'IMPORT_INVALID_LINK', link);
  }
});

test('invalid links never call the download function', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return new Response('');
  };
  await rejectsWithCode(downloadGuidedNotes('https://example.com/file.xlsx', { fetchImpl }), 'IMPORT_INVALID_LINK');
  assert.equal(called, false);
});

test('a shared link downloads the workbook from the fixed export URL', async () => {
  const workbook = await fixture('01-official-single.xlsx');
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return new Response(workbook, {
      headers: { 'content-disposition': "attachment; filename=\"x.xlsx\"; filename*=UTF-8''%E5%AD%B8%E7%BF%92%E5%96%AE.xlsx" },
    });
  };
  const result = await downloadGuidedNotes(`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`, { fetchImpl });
  assert.equal(requestedUrl, `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`);
  assert.equal(result.name, '學習單.xlsx');
  assert.ok(result.buffer.equals(workbook));
});

test('unshared, failing, oversized and slow links are reported', async () => {
  const link = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  const html = async () => new Response('<html>請登入</html>', { headers: { 'content-type': 'text/html' } });
  await rejectsWithCode(downloadGuidedNotes(link, { fetchImpl: html }), 'IMPORT_LINK_UNREACHABLE');

  const notFound = async () => new Response('missing', { status: 404 });
  await rejectsWithCode(downloadGuidedNotes(link, { fetchImpl: notFound }), 'IMPORT_LINK_UNREACHABLE');

  const networkError = async () => {
    throw new TypeError('fetch failed');
  };
  await rejectsWithCode(downloadGuidedNotes(link, { fetchImpl: networkError }), 'IMPORT_LINK_UNREACHABLE');

  const large = async () => new Response(Buffer.alloc(2048, 1));
  await rejectsWithCode(downloadGuidedNotes(link, { fetchImpl: large, maxBytes: 1024 }), 'IMPORT_FILE_TOO_LARGE');

  const slow = (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await rejectsWithCode(downloadGuidedNotes(link, { fetchImpl: slow, timeoutMs: 50 }), 'IMPORT_LINK_UNREACHABLE');
});
