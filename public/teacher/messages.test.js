// add-teacher-language-switch task 2.1
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslator, translateError } from '../shared/i18n.js';
import { TEACHER_ERROR_CODES, TEACHER_MESSAGES, ZH, renderMessage } from './messages.js';
import {
  createConsoleState, describeAction, describeFairRanking, describeLoginError, describeSummary,
  getSetupBlockedReason, parseCountdown, reduceConsole,
} from './console-logic.js';
import { describeCurrent, describePreview, describeWarnings, getBlockedReason, getSummaryRows } from './import-logic.js';
import { createExportState, getExportView, reduceExport } from './export-logic.js';
import { getMonitorView } from './monitor-logic.js';
import { createBoardState, getBoardView, reduceBoard } from './board-logic.js';

const en = createTranslator(TEACHER_MESSAGES, 'en');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('both languages have the same keys, non-empty values and the same placeholders', () => {
  const zhKeys = Object.keys(TEACHER_MESSAGES['zh-TW']).sort();
  assert.deepEqual(Object.keys(TEACHER_MESSAGES.en).sort(), zhKeys);
  for (const key of zhKeys) {
    for (const language of ['zh-TW', 'en']) assert.ok(TEACHER_MESSAGES[language][key].length > 0, `${language} ${key}`);
    assert.deepEqual(placeholders(TEACHER_MESSAGES.en[key]), placeholders(TEACHER_MESSAGES['zh-TW'][key]), key);
  }
});

test('English messages contain no Chinese except the header names teachers type in the sheet', () => {
  for (const [key, value] of Object.entries(TEACHER_MESSAGES.en)) {
    // 匯入表頭「題號／題目／作答」是學習單上要寫的文字，英文說明必須照原樣提到
    const allowed = value.replace(/題號|題目|作答/g, '');
    assert.doesNotMatch(allowed, /[一-鿿]/, key);
  }
});

test('every teacher error code has an English message', () => {
  for (const code of TEACHER_ERROR_CODES) {
    assert.ok(en.has(`error.${code}`), code);
    assert.notEqual(translateError(en, code, '伺服器原文'), '伺服器原文', code);
  }
});

test('renderMessage handles strings, keys, server errors and parts', () => {
  assert.equal(renderMessage(en, '原樣'), '原樣');
  assert.equal(renderMessage(en, { key: 'groups.applied' }), 'Group settings applied.');
  assert.equal(renderMessage(en, { key: 'monitor.voidFailed', params: { message: { code: 'ALREADY_VOIDED', fallback: '這筆作答已經作廢。' } } }),
    'Could not void the answer: This answer has already been voided.');
  assert.equal(renderMessage(ZH, { code: 'ALREADY_VOIDED', fallback: '伺服器原文' }), '伺服器原文');
  assert.equal(renderMessage(en, { code: 'SOMETHING_NEW', fallback: '伺服器原文' }), '伺服器原文');
  assert.equal(renderMessage(en, { parts: [{ key: 'export.written', params: { count: 3 } }, ''] }), 'Wrote 3 cells to the spreadsheet.');
  assert.equal(renderMessage(en, null), '');
});

test('console texts in English', () => {
  const summary = { phase: '搶答中', groupCount: 5, questionCount: 6, fairRankingEnabled: true };
  assert.deepEqual(describeSummary(summary, en), { phase: 'Answering', counts: '5 groups, 6 questions' });
  assert.equal(describeFairRanking(summary, en), 'On');
  assert.equal(getSetupBlockedReason('已結束', en), 'The current phase is "Ended". Groups and Guided Notes can only be set up while preparing.');
  assert.equal(describeAction({ action: 'ending', message: '' }, en), 'Ending…');
  assert.equal(describeAction({ action: null, message: { code: 'NO_GROUPS', fallback: '請先設定組別。' } }, en), 'Set up groups first.');
  assert.equal(parseCountdown({ enabled: true, minutes: '0', seconds: '5' }, en).message, 'The countdown must be between 10 seconds and 60 minutes.');
});

test('login errors are kept as descriptions and render in either language', () => {
  const login = reduceConsole(createConsoleState(), { type: 'authLoaded', authenticated: false, passwordConfigured: true });
  const wrong = reduceConsole(login, { type: 'loginFailed', code: 'WRONG_PASSWORD' });
  assert.equal(describeLoginError(wrong, en), 'Wrong password. Please try again.');
  assert.equal(describeLoginError(wrong), '密碼錯誤，請再試一次。');
  const expired = reduceConsole(wrong, { type: 'authExpired' });
  assert.equal(describeLoginError(expired, en), 'Your login has expired. Please log in again.');
  const noResponse = reduceConsole(login, { type: 'loginFailed' });
  assert.equal(describeLoginError(noResponse, en), 'The server did not respond. Please try again later.');
});

const preview = {
  source: { type: 'file', name: '期中學習單.xlsx' },
  sheetName: '學習單',
  headerRow: 4,
  questionCount: 2,
  blankCount: 3,
  questions: [
    { id: 1, type: 'group', blankCount: 2, prefixes: ['（1）', '（2）'] },
    { id: 3, type: 'single', blankCount: 1, prefixes: [''] },
  ],
  warnings: ['第 3 題第 1 格（C7）已有內容，匯出時會被取代。', '未知提醒原文'],
  warningDetails: [{ code: 'ANSWER_CELL_NOT_EMPTY', questionId: 3, blankIndex: 1, cell: 'C7' }, { code: 'SOMETHING_NEW' }],
  replacesExisting: true,
};

test('import summary in English keeps file and sheet names', () => {
  assert.deepEqual(describePreview(preview, en), [
    'Source: 期中學習單.xlsx',
    'Sheet: 學習單 (header on row 4)',
    '2 questions, 3 blanks',
    'Confirming replaces the current questions.',
  ]);
  assert.deepEqual(getSummaryRows(preview, en).map(({ number, type, blanks }) => [number, type, blanks]), [
    ['Question 1', 'Group', '2'],
    ['Question 3', 'Single', '1'],
  ]);
  assert.equal(describeCurrent({ ...preview, source: preview.source }, en), 'Imported "期中學習單.xlsx": sheet "學習單", 2 questions, 3 blanks.');
  assert.equal(getBlockedReason({ phase: '搶答中' }, en), 'The current phase is "Answering". Guided Notes can only be imported while preparing.');
});

test('import warnings use details in English and the server text in Chinese', () => {
  assert.deepEqual(describeWarnings(preview, en), [
    'Question 3, blank 1 (C7) already has content and will be replaced on export.',
    '未知提醒原文',
  ]);
  assert.deepEqual(describeWarnings(preview), preview.warnings);
  assert.deepEqual(describeWarnings({ warnings: ['舊回應'] }, en), ['舊回應'], 'old responses without details fall back');
});

test('export view and results in English', () => {
  const ended = reduceExport(reduceExport(createExportState(), { type: 'phaseChanged', phase: '已結束' }), {
    type: 'configLoaded', configured: true, serviceAccountEmail: 'bot@example.iam.gserviceaccount.com', target: 'link',
  });
  const view = getExportView(ended, en);
  assert.equal(view.description, 'Before writing back, share the spreadsheet with bot@example.iam.gserviceaccount.com as an Editor.');
  assert.deepEqual([view.writebackLabel, view.downloadLabel, view.csvLabel], ['Write back to Google Sheets', 'Download xlsx', 'Download CSV']);
  const written = reduceExport(ended, { type: 'writebackDone', writtenCells: 4, remapped: true });
  assert.equal(getExportView(written, en).resultText,
    'Wrote 4 cells to the spreadsheet. The spreadsheet layout changed after the import, so answers were matched by question number.');
  const failed = reduceExport(ended, { type: 'writebackFailed', message: { code: 'SHEET_NOT_EDITABLE', fallback: '請把試算表共用給 x 並設為「編輯者」。也可以改用「下載 xlsx」。' } });
  assert.equal(getExportView(failed, en).resultText, 'Share the spreadsheet with the service account as an Editor, or use "Download xlsx".');
  assert.equal(getExportView(failed).resultText, '請把試算表共用給 x 並設為「編輯者」。也可以改用「下載 xlsx」。');
  const noResponse = reduceExport(ended, { type: 'writebackFailed', message: { code: 'NO_RESPONSE', fallback: '伺服器沒有回應，請稍後再試。' } });
  assert.equal(getExportView(noResponse, en).resultText, 'The server did not respond. Please try again later. You can use "Download xlsx" instead.');
  assert.equal(getExportView(reduceExport(ended, { type: 'csvDone' }), en).resultText, 'Downloaded the CSV.');
});

test('monitor in English keeps group names and answers', () => {
  const question = {
    id: 3, prompt: '題目', settled: true, submittedCount: 2,
    winner: { groupId: 2, groupName: '第 2 組', answers: ['臺北', '新北'] }, winnerSource: 'fair',
    entries: [
      { groupId: 2, groupName: '第 2 組', rank: 2, status: 'valid', place: 1, answers: ['臺北', '新北'], submittedAt: 'x' },
      { groupId: 1, groupName: '第 1 組', rank: 1, status: 'voided', place: null, answers: ['錯'], submittedAt: 'x' },
    ],
    notSubmitted: [{ groupId: 3, groupName: '第 3 組' }, { groupId: 4, groupName: '第 4 組' }],
  };
  const buzzing = getMonitorView({ data: { phase: '搶答中', groupCount: 4, questions: [question] } }, en);
  assert.equal(buzzing.title, 'Answer monitor');
  assert.equal(buzzing.rows[0].label, 'Question 3');
  assert.equal(buzzing.rows[0].summary, '2 of 4 groups submitted, 1st: 第 2 組 "臺北 / 新北"');
  assert.deepEqual(buzzing.rows[0].details.map(({ text }) => text), [
    '#1 · 第 2 組 · "臺北 / 新北" · ',
    'Voided · 第 1 組 · "錯" · ',
    'Not submitted: 第 3 組, 第 4 組',
  ]);
  const ended = getMonitorView({ data: { phase: '已結束', groupCount: 4, questions: [question] } }, en);
  assert.equal(ended.title, 'Results');
  assert.equal(ended.rows[0].summary, '第 2 組 "臺北 / 新北" (decided by fair ranking)');
  assert.equal(getMonitorView({ data: null }, en).hint, 'Loading…');
});

test('board in English', () => {
  let state = reduceBoard(createBoardState(), { type: 'authChecked', authenticated: false });
  assert.deepEqual(getBoardView(state, 0, en), { view: 'login', message: 'Please log in on the teacher console first' });
  state = reduceBoard(createBoardState(), { type: 'authChecked', authenticated: true });
  state = reduceBoard(state, { type: 'summaryLoaded', summary: { phase: '搶答中', countdownEndsAt: null } });
  state = reduceBoard(state, { type: 'requestPresence' });
  state = reduceBoard(state, { type: 'presenceLoaded', seq: state.presence.seq, groups: [{ id: 1, name: '第 1 組', online: true }, { id: 2, name: '第 2 組', online: false }] });
  const buzzing = getBoardView(state, 0, en);
  assert.equal(buzzing.phaseText, 'Answering');
  assert.equal(buzzing.onlineText, '1 of 2 groups online');
  assert.deepEqual(buzzing.groups.map(({ name, statusText }) => [name, statusText]), [['第 1 組', 'Online'], ['第 2 組', 'Offline']]);

  state = reduceBoard(state, { type: 'summaryLoaded', summary: { phase: '已結束', countdownEndsAt: null } });
  state = reduceBoard(state, { type: 'requestResults' });
  state = reduceBoard(state, {
    type: 'resultsLoaded',
    seq: state.results.seq,
    questions: [
      { id: 1, settled: true, winner: { groupName: '第 1 組', answers: ['水'] }, winnerSource: 'fair' },
      { id: 2, settled: true, winner: null, winnerSource: null },
      { id: 3, settled: true, winner: null, winnerSource: null },
    ],
  });
  state = reduceBoard(reduceBoard(state, { type: 'revealNext' }), { type: 'revealNext' });
  const ended = getBoardView(state, 0, en);
  assert.equal(ended.phaseText, 'Ended');
  assert.deepEqual(ended.results.rows.map(({ label, text }) => [label, text]), [
    ['Question 1', '第 1 組 "水" (decided by fair ranking)'],
    ['Question 2', 'No answers'],
    ['Question 3', 'Not revealed'],
  ]);
  assert.equal(ended.results.revealedText, '2 of 3 revealed');
  // 切換語言只換文字，揭曉進度不變
  assert.equal(getBoardView(state, 0).results.revealedText, '已揭曉 2／3 題');
});
