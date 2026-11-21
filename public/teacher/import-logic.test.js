import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createImportState,
  createRequestSequence,
  describeCurrent,
  describePreview,
  getBlockedReason,
  getImportControls,
  getSummaryRows,
  reduceImport,
} from './import-logic.js';

const preview = {
  previewId: 'p1',
  source: { type: 'file', name: '02.xlsx' },
  sheetName: '學習單',
  headerRow: 4,
  questionCount: 2,
  blankCount: 3,
  questions: [
    { id: 1, type: 'group', blankCount: 2, prefixes: ['（1）', '（2）'] },
    { id: 3, type: 'single', blankCount: 1, prefixes: [''] },
  ],
  warnings: [],
  replacesExisting: true,
};
const current = { source: { type: 'file', name: '01.xlsx' }, sheetName: '學習單', questionCount: 6, blankCount: 6 };

test('preview flow moves through loading, reviewing, confirming and imported', () => {
  let state = createImportState();
  assert.equal(state.view, 'idle');
  state = reduceImport(state, { type: 'requestPreview' });
  assert.equal(state.view, 'loading');
  state = reduceImport(state, { type: 'previewLoaded', preview });
  assert.equal(state.view, 'reviewing');
  state = reduceImport(state, { type: 'requestConfirm' });
  assert.equal(state.view, 'confirming');
  state = reduceImport(state, { type: 'confirmed', current });
  assert.equal(state.view, 'idle');
  assert.equal(state.preview, null);
  assert.equal(state.current, current);
});

test('cancel discards the preview and keeps the current import', () => {
  let state = createImportState({ current });
  state = reduceImport(state, { type: 'previewLoaded', preview });
  state = reduceImport(state, { type: 'cancel' });
  assert.equal(state.view, 'idle');
  assert.equal(state.preview, null);
  assert.equal(state.current, current);
});

test('failed preview returns to the previous view with an error', () => {
  let state = reduceImport(createImportState(), { type: 'requestPreview' });
  state = reduceImport(state, { type: 'previewFailed', message: '找不到表頭' });
  assert.equal(state.view, 'idle');
  assert.equal(state.error, '找不到表頭');

  let reviewing = reduceImport(createImportState(), { type: 'previewLoaded', preview });
  reviewing = reduceImport(reviewing, { type: 'requestPreview' });
  reviewing = reduceImport(reviewing, { type: 'previewFailed', message: '檔案損壞' });
  assert.equal(reviewing.view, 'reviewing');
  assert.equal(reviewing.preview, preview);
});

test('failed confirm stays on the summary with an error', () => {
  let state = reduceImport(createImportState(), { type: 'previewLoaded', preview });
  state = reduceImport(state, { type: 'requestConfirm' });
  state = reduceImport(state, { type: 'confirmFailed', message: '摘要已過期' });
  assert.equal(state.view, 'reviewing');
  assert.equal(state.error, '摘要已過期');
});

test('controls follow the view', () => {
  const idle = getImportControls(createImportState());
  assert.deepEqual(idle, { canSubmit: true, canConfirm: false, canCancel: false, showSummary: false });
  const reviewing = getImportControls(reduceImport(createImportState(), { type: 'previewLoaded', preview }));
  assert.deepEqual(reviewing, { canSubmit: true, canConfirm: true, canCancel: true, showSummary: true });
  const loading = getImportControls(reduceImport(createImportState(), { type: 'requestPreview' }));
  assert.equal(loading.canSubmit, false);
});

test('controls are disabled outside preparation and only depend on the phase', () => {
  for (const phase of ['搶答中', '已結束']) {
    const locked = reduceImport(createImportState(), { type: 'phaseChanged', phase });
    assert.match(getBlockedReason(locked), new RegExp(`${phase}.*只能在準備中`));
    assert.equal(getImportControls(locked).canSubmit, false);
    const lockedReviewing = reduceImport(locked, { type: 'previewLoaded', preview });
    assert.equal(getImportControls(lockedReviewing).canConfirm, false);
  }
  const preparing = createImportState();
  assert.equal(getBlockedReason(preparing), '');
  assert.equal(getImportControls(preparing).canSubmit, true);
  assert.equal('isAllowedHost' in preparing, false);
});

test('descriptions show the current import and preview details', () => {
  assert.equal(describeCurrent(null), '尚未匯入學習單。');
  assert.match(describeCurrent(current), /01\.xlsx.*共 6 題、6 個空格/);
  const lines = describePreview(preview);
  assert.ok(lines.includes('共 2 題、3 個空格'));
  assert.ok(lines.includes('確認後會取代目前的題目。'));
  assert.ok(!describePreview({ ...preview, replacesExisting: false }).includes('確認後會取代目前的題目。'));
});

test('summary rows describe type, blank count and prefixes', () => {
  assert.deepEqual(getSummaryRows(preview), [
    { number: '第 1 題', type: '題組', blanks: '2 格', prefixes: '（1） （2）' },
    { number: '第 3 題', type: '單題', blanks: '1 格', prefixes: '—' },
  ]);
});

test('request sequence discards responses that are no longer the latest', () => {
  const sequence = createRequestSequence();
  const first = sequence.next();
  const second = sequence.next();
  assert.equal(sequence.isLatest(first), false);
  assert.equal(sequence.isLatest(second), true);
});
