import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExportState, fileNameFromDisposition, getExportView, reduceExport } from './export-logic.js';

const EMAIL = 'writer@test-project.iam.gserviceaccount.com';

function apply(...events) {
  return events.reduce(reduceExport, createExportState());
}

const ended = { type: 'phaseChanged', phase: '已結束' };
const linkConfigured = { type: 'configLoaded', configured: true, serviceAccountEmail: EMAIL, target: 'link' };

test('before the session ends both buttons are disabled', () => {
  for (const phase of [null, '準備中', '搶答中']) {
    const view = getExportView(apply(linkConfigured, { type: 'phaseChanged', phase }));
    assert.equal(view.view, 'notEnded');
    assert.equal(view.description, '活動結束後才能匯出。');
    assert.equal(view.canWriteback, false);
    assert.equal(view.canDownload, false);
  }
});

test('the five views are chosen from phase, import source and configuration', () => {
  assert.equal(getExportView(apply(ended)).view, 'noImport');
  assert.equal(getExportView(apply(ended, { type: 'configLoaded', configured: true, serviceAccountEmail: EMAIL, target: null })).view, 'noImport');

  const fileOnly = getExportView(apply(ended, { type: 'importLoaded', source: 'file' }));
  assert.equal(fileOnly.view, 'fileOnly');
  assert.deepEqual([fileOnly.canWriteback, fileOnly.canDownload], [false, true]);
  assert.match(fileOnly.description, /沒有線上試算表可寫回/);

  const notConfigured = getExportView(apply(ended, { type: 'configLoaded', configured: false, serviceAccountEmail: null, target: 'link' }));
  assert.equal(notConfigured.view, 'notConfigured');
  assert.deepEqual([notConfigured.canWriteback, notConfigured.canDownload], [false, true]);
  assert.match(notConfigured.description, /尚未設定 Google 服務帳號/);

  const checking = getExportView(apply(ended, { type: 'importLoaded', source: 'link' }));
  assert.equal(checking.view, 'notConfigured');
  assert.equal(checking.description, '讀取寫回設定中…');

  const ready = getExportView(apply(ended, linkConfigured));
  assert.equal(ready.view, 'ready');
  assert.deepEqual([ready.canWriteback, ready.canDownload], [true, true]);
  assert.match(ready.description, new RegExp(EMAIL.replaceAll('.', '\\.')));
});

test('both buttons are disabled while writing back or downloading', () => {
  for (const request of ['requestWriteback', 'requestDownload']) {
    const view = getExportView(apply(ended, linkConfigured, { type: request }));
    assert.equal(view.canWriteback, false);
    assert.equal(view.canDownload, false);
  }
  assert.equal(getExportView(apply(ended, linkConfigured, { type: 'requestWriteback' })).writebackLabel, '寫回中…');
  assert.equal(getExportView(apply(ended, linkConfigured, { type: 'requestDownload' })).downloadLabel, '下載中…');
});

test('a successful writeback shows the cell count and the remap note', () => {
  const plain = getExportView(apply(ended, linkConfigured, { type: 'requestWriteback' }, { type: 'writebackDone', writtenCells: 6, remapped: false }));
  assert.equal(plain.resultTone, 'ok');
  assert.equal(plain.resultText, '已寫回 6 格到線上試算表。');
  assert.equal(plain.canWriteback, true);
  const remapped = getExportView(apply(ended, linkConfigured, { type: 'writebackDone', writtenCells: 2, remapped: true }));
  assert.match(remapped.resultText, /已寫回 2 格.*版面在匯入後有變動，已依題號重新對位/);
  const none = getExportView(apply(ended, linkConfigured, { type: 'writebackDone', writtenCells: 0, remapped: false }));
  assert.equal(none.resultText, '沒有任何成功答案，線上試算表沒有變動。');
});

test('a failed writeback shows the server message with the download fallback', () => {
  const withHint = getExportView(apply(ended, linkConfigured, { type: 'writebackFailed', message: `請共用給 ${EMAIL}。也可以改用「下載 xlsx」。` }));
  assert.equal(withHint.resultTone, 'error');
  assert.equal(withHint.resultText, `請共用給 ${EMAIL}。也可以改用「下載 xlsx」。`);
  const withoutHint = getExportView(apply(ended, linkConfigured, { type: 'writebackFailed', message: '伺服器沒有回應，請稍後再試。' }));
  assert.equal(withoutHint.resultText, '伺服器沒有回應，請稍後再試。也可以改用「下載 xlsx」。');
});

test('download results are shown', () => {
  assert.equal(getExportView(apply(ended, { type: 'importLoaded', source: 'file' }, { type: 'downloadDone' })).resultText, '已下載含答案的 xlsx。');
  const failed = getExportView(apply(ended, { type: 'importLoaded', source: 'file' }, { type: 'downloadFailed', message: '活動結束後才能匯出。' }));
  assert.deepEqual([failed.resultTone, failed.resultText], ['error', '活動結束後才能匯出。']);
});

test('a phase change clears the result but the same phase does not', () => {
  const done = apply(ended, linkConfigured, { type: 'writebackDone', writtenCells: 1, remapped: false });
  assert.notEqual(getExportView(reduceExport(done, ended)).resultText, '');
  assert.equal(getExportView(reduceExport(done, { type: 'phaseChanged', phase: '準備中' })).resultText, '');
});

test('a new import clears the result and reset restores the initial state', () => {
  const done = apply(ended, linkConfigured, { type: 'writebackDone', writtenCells: 1, remapped: false });
  assert.equal(getExportView(reduceExport(done, { type: 'importLoaded', source: 'file' })).resultText, '');
  assert.deepEqual(reduceExport(done, { type: 'reset' }), createExportState());
});

test('download file names come from Content-Disposition', () => {
  assert.equal(
    fileNameFromDisposition(`attachment; filename="guided-notes-answers.xlsx"; filename*=UTF-8''${encodeURIComponent('學習單（搶答結果）.xlsx')}`),
    '學習單（搶答結果）.xlsx',
  );
  assert.equal(fileNameFromDisposition('attachment; filename="a.xlsx"'), 'a.xlsx');
  assert.equal(fileNameFromDisposition(null), 'guided-notes-answers.xlsx');
});

// ---- 下載 CSV（add-results-csv-export） ----

test('csv download is disabled until the session ends', () => {
  for (const phase of [null, '準備中', '搶答中']) {
    const view = getExportView(apply(linkConfigured, { type: 'phaseChanged', phase }));
    assert.equal(view.canDownloadCsv, false);
    assert.equal(view.csvLabel, '下載 CSV');
  }
});

test('csv download is available after the end regardless of import source or configuration', () => {
  const sources = [
    { type: 'configLoaded', configured: true, serviceAccountEmail: EMAIL, target: 'link' },
    { type: 'configLoaded', configured: false, serviceAccountEmail: null, target: 'link' },
    { type: 'configLoaded', configured: true, serviceAccountEmail: EMAIL, target: 'file' },
    { type: 'configLoaded', configured: false, serviceAccountEmail: null, target: 'file' },
  ];
  for (const config of sources) assert.equal(getExportView(apply(ended, config)).canDownloadCsv, true, JSON.stringify(config));
  // 設定尚未讀到時也可以下載 csv
  assert.equal(getExportView(apply(ended)).canDownloadCsv, true);
});

test('every action disables all three buttons and the csv label shows progress', () => {
  for (const request of ['requestWriteback', 'requestDownload', 'requestCsv']) {
    const view = getExportView(apply(ended, linkConfigured, { type: request }));
    assert.deepEqual([view.canWriteback, view.canDownload, view.canDownloadCsv], [false, false, false], request);
  }
  assert.equal(getExportView(apply(ended, linkConfigured, { type: 'requestCsv' })).csvLabel, '下載中…');
});

test('csv results are shown and reset clears them', () => {
  const done = apply(ended, linkConfigured, { type: 'requestCsv' }, { type: 'csvDone' });
  assert.equal(getExportView(done).resultText, '已下載 CSV。');
  assert.equal(getExportView(done).resultTone, 'ok');
  assert.equal(getExportView(done).canDownloadCsv, true);
  const failed = apply(ended, linkConfigured, { type: 'requestCsv' }, { type: 'csvFailed', message: '活動結束後才能匯出。' });
  assert.equal(getExportView(failed).resultText, '活動結束後才能匯出。');
  assert.equal(getExportView(failed).resultTone, 'error');
  assert.deepEqual(reduceExport(done, { type: 'reset' }), createExportState());
});
