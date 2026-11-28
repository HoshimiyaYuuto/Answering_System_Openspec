import {
  createConsoleState,
  describeAction,
  describeFairRanking,
  describeLoginError,
  describeSummary,
  formatRemaining,
  getConsoleControls,
  getSetupBlockedReason,
  isAuthExpired,
  parseCountdown,
  reduceConsole,
} from './console-logic.js';
import {
  createImportState,
  createRequestSequence,
  describeCurrent,
  describePreview,
  describeWarnings,
  getBlockedReason,
  getImportControls,
  getSummaryRows,
  reduceImport,
} from './import-logic.js';
import { createExportState, fileNameFromDisposition, getExportView, reduceExport } from './export-logic.js';
import { createMonitorState, getMonitorView, reduceMonitor } from './monitor-logic.js';
import {
  applyDocumentLanguage,
  applyStaticText,
  createTranslator,
  detectLanguage,
  mountLanguageSwitch,
  readStoredLanguage,
  storeLanguage,
  watchLanguage,
} from '../shared/i18n.js';
import { TEACHER_MESSAGES, ZH, renderMessage } from './messages.js';

// ---- 介面語言（add-teacher-language-switch design 第 1、2 節） ----
// 切換時不重新載入：換掉 t 後重畫各區塊，所有 reducer 狀態與輸入框都保留

let language = detectLanguage(readStoredLanguage(), navigator.languages);
let t = createTranslator(TEACHER_MESSAGES, language);
applyDocumentLanguage(language, t('page.title'));
applyStaticText(document, t);

// 直接寫在元素上的訊息（載入失敗、組別結果等）記下描述，切換語言時用新語言重畫
const shownMessages = new Map();
function showMessage(element, value) {
  const text = renderMessage(t, value);
  element.textContent = text;
  shownMessages.set(element, { value, text });
}

const languageSwitch = mountLanguageSwitch(document.querySelector('#language-switch'), {
  language,
  label: t('language.label'),
  onChange: (next) => setLanguage(next),
});

function setLanguage(next, { store = true } = {}) {
  if (next === language) return;
  if (store) storeLanguage(next);
  // 切換前仍顯示在畫面上的訊息，重畫後要用新語言保留
  const visible = [...shownMessages.entries()]
    .filter(([element, entry]) => element.textContent === entry.text)
    .map(([element, entry]) => [element, entry, element.hidden]);
  language = next;
  t = createTranslator(TEACHER_MESSAGES, language);
  applyDocumentLanguage(language, t('page.title'));
  applyStaticText(document, t);
  languageSwitch.update(language, t('language.label'));
  renderConsole();
  renderImport();
  renderExport();
  renderMonitor();
  relabelGroups();
  for (const [element, entry, hidden] of visible) {
    showMessage(element, entry.value);
    element.hidden = hidden;
  }
}

watchLanguage((next) => setLanguage(next, { store: false }));

// messageCode：用來翻譯的代碼；沒有伺服器代碼時用前端自己的（例如 NO_RESPONSE）
class ApiError extends Error {
  constructor(message, code, status, messageCode = code) {
    super(message);
    this.code = code;
    this.status = status;
    this.messageCode = messageCode;
  }
}

// 錯誤以描述傳給 reducer 與 showMessage，畫面時才依語言組字
function errorMessage(error) {
  return { code: error.messageCode ?? error.code, fallback: error.message };
}

async function requestJson(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(ZH('error.NO_RESPONSE'), undefined, undefined, 'NO_RESPONSE');
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // 非 JSON 回應視為伺服器錯誤
  }
  if (!response.ok) {
    throw new ApiError(body?.error?.message || ZH('error.generic'), body?.error?.code, response.status, body?.error?.code ?? 'generic');
  }
  return body;
}

const postJson = (path, body) => requestJson(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- 登入與控制台 ----

const checkingView = document.querySelector('#checking-view');
const notConfiguredView = document.querySelector('#not-configured-view');
const loginView = document.querySelector('#login-view');
const consoleView = document.querySelector('#console-view');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#password');
const loginSubmit = document.querySelector('#login-submit');
const loginMessage = document.querySelector('#login-message');
const logoutButton = document.querySelector('#logout');
const boardLink = document.querySelector('#board-link');
const summaryPhase = document.querySelector('#summary-phase');
const summaryCounts = document.querySelector('#summary-counts');
const startButton = document.querySelector('#start');
const endButton = document.querySelector('#end');
const endConfirm = document.querySelector('#end-confirm');
const endConfirmYes = document.querySelector('#end-confirm-yes');
const endConfirmNo = document.querySelector('#end-confirm-no');
const sessionMessage = document.querySelector('#session-message');
const countdownEnabled = document.querySelector('#countdown-enabled');
const countdownFields = document.querySelector('#countdown-fields');
const countdownMinutes = document.querySelector('#countdown-minutes');
const countdownSeconds = document.querySelector('#countdown-seconds');
const countdownLabel = document.querySelector('#countdown-label');
const countdownRemaining = document.querySelector('#countdown-remaining');
const fairRanking = document.querySelector('#fair-ranking');
const fairRankingLabel = document.querySelector('#fair-ranking-label');
const fairRankingState = document.querySelector('#fair-ranking-state');
const resetButton = document.querySelector('#reset');
const resetConfirm = document.querySelector('#reset-confirm');
const resetConfirmYes = document.querySelector('#reset-confirm-yes');
const resetConfirmNo = document.querySelector('#reset-confirm-no');

let consoleState = createConsoleState();
const summaryRequests = createRequestSequence();
let events = null;
// 倒數以 server 時間計算：記下 server 與本機時鐘的差（add-countdown-and-reset design 第 2 節）
let countdownEndsAt = null;
let clockOffset = 0;
let countdownTimer = null;
// 本場公平順位設定：開始回應、phase 事件與摘要都會帶，取最新的一份（add-fair-ranking design 第 5 節）
let fairRankingEnabled = false;

function recordServerTime(data) {
  if (!data || typeof data !== 'object') return;
  const serverTime = Date.parse(data.serverTime);
  if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
  if ('countdownEndsAt' in data) countdownEndsAt = typeof data.countdownEndsAt === 'string' ? data.countdownEndsAt : null;
  if ('fairRankingEnabled' in data) fairRankingEnabled = data.fairRankingEnabled === true;
}

function renderCountdown() {
  const running = consoleState.view === 'console' && consoleState.summary?.phase === '搶答中' && countdownEndsAt !== null;
  countdownLabel.hidden = !running;
  countdownRemaining.hidden = !running;
  countdownRemaining.textContent = running ? t('session.countdownRemaining', { time: formatRemaining(countdownEndsAt, Date.now() + clockOffset) }) : '';
  if (running && countdownTimer === null) countdownTimer = setInterval(renderCountdown, 1000);
  if (!running && countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function renderConsole() {
  const controls = getConsoleControls(consoleState);
  checkingView.hidden = consoleState.view !== 'checking';
  notConfiguredView.hidden = consoleState.view !== 'notConfigured';
  loginView.hidden = consoleState.view !== 'login';
  consoleView.hidden = consoleState.view !== 'console';
  logoutButton.hidden = !controls.canLogout;
  // 投影看板需要老師登入，只在控制台畫面顯示連結（add-projector-board design 第 4 節）
  boardLink.hidden = consoleState.view !== 'console';

  loginSubmit.disabled = !controls.canLogin;
  passwordInput.disabled = !controls.canLogin;
  loginSubmit.textContent = consoleState.loggingIn ? t('login.submitting') : t('login.submit');
  loginMessage.textContent = describeLoginError(consoleState, t);

  const { phase, counts } = describeSummary(consoleState.summary, t);
  summaryPhase.textContent = phase;
  summaryCounts.textContent = counts;
  startButton.disabled = !controls.canStart;
  endButton.disabled = !controls.canEnd;
  endConfirm.hidden = !controls.showEndConfirm;
  endConfirmYes.disabled = !controls.canConfirmEnd;
  resetButton.disabled = !controls.canReset;
  resetConfirm.hidden = !controls.showResetConfirm;
  resetConfirmYes.disabled = !controls.canConfirmReset;
  countdownEnabled.disabled = !controls.canEditCountdown;
  countdownMinutes.disabled = !controls.canEditCountdown;
  countdownSeconds.disabled = !controls.canEditCountdown;
  countdownFields.hidden = !countdownEnabled.checked;
  fairRanking.disabled = !controls.canEditFairRanking;
  const fairRankingText = describeFairRanking(consoleState.summary && { ...consoleState.summary, fairRankingEnabled }, t);
  fairRankingLabel.hidden = fairRankingText === '';
  fairRankingState.hidden = fairRankingText === '';
  fairRankingState.textContent = fairRankingText;
  sessionMessage.textContent = describeAction(consoleState, t);

  renderCountdown();
  renderGroupsLock();
}

function dispatchConsole(event) {
  consoleState = reduceConsole(consoleState, event);
  renderConsole();
  if (consoleState.view !== 'console') leaveConsole();
}

function handleAuthError(error) {
  if (!isAuthExpired(error.code)) return false;
  dispatchConsole({ type: 'authExpired' });
  return true;
}

function currentPhase() {
  return consoleState.summary?.phase;
}

async function loadSummary() {
  const requestId = summaryRequests.next();
  try {
    const { data } = await requestJson('/api/session');
    if (!summaryRequests.isLatest(requestId)) return;
    recordServerTime(data);
    dispatchConsole({ type: 'summaryLoaded', summary: data });
    dispatchImport({ type: 'phaseChanged', phase: data.phase });
    dispatchExport({ type: 'phaseChanged', phase: data.phase });
  } catch (error) {
    if (!summaryRequests.isLatest(requestId)) return;
    showMessage(sessionMessage, { key: 'session.loadFailed', params: { message: errorMessage(error) } });
  }
}

function openEvents() {
  if (events) return;
  // 以老師身分連線才會收到監看通知；未登入時 server 回 401，EventSource 會直接關閉
  const source = new EventSource('/api/events?role=teacher');
  events = source;
  source.addEventListener('open', () => {
    // 連上或重新連上（例如 server 重新啟動）時取得權威快照；登入失效會由匯入狀態的 401 帶回登入畫面
    if (consoleState.view !== 'console') return;
    loadSummary();
    loadImportStatus();
    loadExportConfig();
    monitorChanged();
  });
  source.addEventListener('error', () => {
    if (source.readyState !== EventSource.CLOSED || events !== source) return;
    // 連線被拒（例如 server 重啟後登入失效）時不會自動重連，重新確認登入狀態
    events = null;
    loadAuth();
  });
  source.addEventListener('monitor', () => monitorChanged());
  events.addEventListener('phase', (event) => {
    try {
      const update = JSON.parse(event.data);
      const { phase } = update;
      recordServerTime(update);
      dispatchConsole({ type: 'phaseChanged', phase });
      dispatchImport({ type: 'phaseChanged', phase });
      dispatchExport({ type: 'phaseChanged', phase });
    } catch {
      // 格式錯誤的事件直接略過，下面重新讀取摘要
    }
    loadSummary();
    monitorChanged();
  });
}

function leaveConsole() {
  if (events) {
    events.close();
    events = null;
  }
  dispatchMonitor({ type: 'reset' });
  // 離開控制台（登出或登入失效）時清掉匯出狀態，重新登入後不會殘留上一次的訊息
  dispatchExport({ type: 'reset' });
}

function enterConsole() {
  openEvents();
  loadSummary();
  loadGroups();
  loadImportStatus();
  loadExportConfig();
  monitorChanged();
}

async function loadAuth() {
  try {
    const { data } = await requestJson('/api/teacher/auth');
    dispatchConsole({ type: 'authLoaded', ...data });
    if (consoleState.view === 'console') enterConsole();
  } catch (error) {
    showMessage(checkingView, { key: 'console.connectFailed', params: { message: errorMessage(error) } });
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!getConsoleControls(consoleState).canLogin) return;
  const password = passwordInput.value;
  dispatchConsole({ type: 'requestLogin' });
  try {
    await postJson('/api/teacher/login', { password });
    passwordInput.value = '';
    dispatchConsole({ type: 'loggedIn' });
    enterConsole();
  } catch (error) {
    passwordInput.value = '';
    dispatchConsole({ type: 'loginFailed', code: error.code, message: error.status ? errorMessage(error) : undefined });
    if (consoleState.view === 'login') passwordInput.focus();
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await requestJson('/api/teacher/logout', { method: 'POST' });
  } catch {
    // 即使 server 沒有回應，也回到登入畫面
  }
  dispatchConsole({ type: 'loggedOut' });
});

countdownEnabled.addEventListener('change', () => renderConsole());

startButton.addEventListener('click', async () => {
  if (!getConsoleControls(consoleState).canStart) return;
  const countdown = parseCountdown({
    enabled: countdownEnabled.checked,
    minutes: countdownMinutes.value,
    seconds: countdownSeconds.value,
  });
  if (!countdown.ok) {
    dispatchConsole({ type: 'startFailed', message: { key: 'session.countdownRange' } });
    return;
  }
  dispatchConsole({ type: 'requestStart' });
  try {
    const body = {
      ...(countdown.countdownSeconds === null ? {} : { countdownSeconds: countdown.countdownSeconds }),
      fairRankingEnabled: fairRanking.checked,
    };
    const { data } = await postJson('/api/session/start', body);
    recordServerTime(data);
    dispatchConsole({ type: 'startDone', phase: data.phase });
    dispatchImport({ type: 'phaseChanged', phase: data.phase });
  } catch (error) {
    if (!handleAuthError(error)) dispatchConsole({ type: 'startFailed', message: errorMessage(error) });
  }
  if (consoleState.view === 'console') loadSummary();
});

endButton.addEventListener('click', () => {
  if (getConsoleControls(consoleState).canEnd) dispatchConsole({ type: 'requestEnd' });
});

endConfirmNo.addEventListener('click', () => dispatchConsole({ type: 'cancelEnd' }));

endConfirmYes.addEventListener('click', async () => {
  if (!getConsoleControls(consoleState).canConfirmEnd) return;
  dispatchConsole({ type: 'confirmEnd' });
  try {
    const { data } = await requestJson('/api/session/end', { method: 'POST' });
    dispatchConsole({ type: 'endDone', phase: data.phase });
  } catch (error) {
    if (handleAuthError(error)) return;
    let phase = currentPhase();
    try {
      phase = (await requestJson('/api/session')).data.phase;
    } catch {
      // 讀不到最新階段時維持畫面上的階段
    }
    dispatchConsole({ type: 'endFailed', code: error.code, message: errorMessage(error), phase });
  }
  if (consoleState.view === 'console') loadSummary();
});

resetButton.addEventListener('click', () => {
  if (getConsoleControls(consoleState).canReset) dispatchConsole({ type: 'requestReset' });
});

resetConfirmNo.addEventListener('click', () => dispatchConsole({ type: 'cancelReset' }));

resetConfirmYes.addEventListener('click', async () => {
  if (!getConsoleControls(consoleState).canConfirmReset) return;
  dispatchConsole({ type: 'confirmReset' });
  try {
    const { data } = await requestJson('/api/session/reset', { method: 'POST' });
    recordServerTime(data);
    countdownEndsAt = null;
    dispatchConsole({ type: 'resetDone', phase: data.phase });
    dispatchImport({ type: 'phaseChanged', phase: data.phase });
    dispatchExport({ type: 'phaseChanged', phase: data.phase });
  } catch (error) {
    if (handleAuthError(error)) return;
    let phase = currentPhase();
    try {
      phase = (await requestJson('/api/session')).data.phase;
    } catch {
      // 讀不到最新階段時維持畫面上的階段
    }
    dispatchConsole({ type: 'resetFailed', code: error.code, message: errorMessage(error), phase });
  }
  if (consoleState.view === 'console') {
    loadSummary();
    monitorChanged();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || consoleState.view !== 'console') return;
  loadSummary();
  loadImportStatus();
  monitorChanged();
});

// ---- 組別設定 ----

const countInput = document.querySelector('#group-count');
const generateButton = document.querySelector('#generate');
const applyButton = document.querySelector('#apply');
const groupList = document.querySelector('#group-list');
const message = document.querySelector('#message');
const groupsBlocked = document.querySelector('#groups-blocked');
let groupsBusy = false;

function renderGroupsLock() {
  const reason = getSetupBlockedReason(currentPhase(), t);
  const locked = !getConsoleControls(consoleState).canSetup;
  groupsBlocked.textContent = reason;
  groupsBlocked.hidden = reason === '';
  countInput.disabled = locked;
  generateButton.disabled = locked || groupsBusy;
  applyButton.disabled = locked || groupsBusy;
  for (const input of groupList.querySelectorAll('input')) input.disabled = locked;
}

function renderGroups(groups) {
  groupList.replaceChildren(...groups.map((group) => {
    const row = document.createElement('label');
    row.append(document.createTextNode(t('groups.nameLabel', { id: group.id })));
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 30;
    input.value = group.name;
    input.dataset.groupId = String(group.id);
    row.append(input);
    return row;
  }));
  renderGroupsLock();
}

// 切換語言時只換每列 label 的文字，不重建輸入框，保留老師正在編輯的名稱
function relabelGroups() {
  for (const input of groupList.querySelectorAll('input[data-group-id]')) {
    const text = input.parentElement?.firstChild;
    if (text?.nodeType === Node.TEXT_NODE) text.textContent = t('groups.nameLabel', { id: Number(input.dataset.groupId) });
  }
}

const groupRequests = createRequestSequence();

async function loadGroups() {
  const requestId = groupRequests.next();
  try {
    const { data } = await requestJson('/api/groups');
    if (groupRequests.isLatest(requestId)) renderGroups(data.groups);
  } catch (error) {
    if (groupRequests.isLatest(requestId)) showMessage(message, errorMessage(error));
  }
}

async function submitGroups(send, successMessage) {
  groupsBusy = true;
  renderGroupsLock();
  const requestId = groupRequests.next();
  try {
    const { data } = await send();
    if (!groupRequests.isLatest(requestId)) return;
    renderGroups(data.groups);
    showMessage(message, successMessage);
    loadSummary();
  } catch (error) {
    if (!handleAuthError(error)) showMessage(message, errorMessage(error));
  } finally {
    groupsBusy = false;
    renderGroupsLock();
  }
}

generateButton.addEventListener('click', () => {
  const count = Number(countInput.value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    showMessage(message, { key: 'groups.countInvalid' });
    return;
  }
  submitGroups(() => postJson('/api/groups/generate', { count }), { key: 'groups.generated' });
});

applyButton.addEventListener('click', () => {
  const groups = Array.from(groupList.querySelectorAll('input[data-group-id]'), (input) => ({
    id: Number(input.dataset.groupId),
    name: input.value,
  }));
  if (!groups.length) {
    showMessage(message, { key: 'groups.empty' });
    return;
  }
  submitGroups(() => requestJson('/api/groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  }), { key: 'groups.applied' });
});

// ---- 匯入學習單 ----

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const importCurrent = document.querySelector('#import-current');
const importBlocked = document.querySelector('#import-blocked');
const importFile = document.querySelector('#import-file');
const importUploadButton = document.querySelector('#import-upload');
const importLink = document.querySelector('#import-link');
const importLinkButton = document.querySelector('#import-link-submit');
const importSummary = document.querySelector('#import-summary');
const importSummaryLines = document.querySelector('#import-summary-lines');
const importWarnings = document.querySelector('#import-warnings');
const importRows = document.querySelector('#import-rows');
const importConfirmButton = document.querySelector('#import-confirm');
const importCancelButton = document.querySelector('#import-cancel');
const importMessage = document.querySelector('#import-message');

let importState = createImportState();
const importRequests = createRequestSequence();
const statusRequests = createRequestSequence();

function listItems(texts) {
  return texts.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  });
}

function summaryRow(row) {
  const tableRow = document.createElement('tr');
  for (const text of [row.number, row.type, row.blanks, row.prefixes]) {
    const cell = document.createElement('td');
    cell.textContent = text;
    tableRow.append(cell);
  }
  return tableRow;
}

function renderImport() {
  const controls = getImportControls(importState);
  const blockedReason = getBlockedReason(importState, t);
  importCurrent.textContent = describeCurrent(importState.current, t);
  importBlocked.textContent = blockedReason;
  importBlocked.hidden = blockedReason === '';
  importFile.disabled = !controls.canSubmit;
  importUploadButton.disabled = !controls.canSubmit;
  importLink.disabled = !controls.canSubmit;
  importLinkButton.disabled = !controls.canSubmit;
  importConfirmButton.disabled = !controls.canConfirm;
  importCancelButton.disabled = !controls.canCancel;

  importSummary.hidden = !controls.showSummary;
  const preview = controls.showSummary ? importState.preview : null;
  importSummaryLines.replaceChildren(...(preview ? listItems(describePreview(preview, t)) : []));
  importWarnings.replaceChildren(...(preview ? listItems(describeWarnings(preview, t)) : []));
  importRows.replaceChildren(...(preview ? getSummaryRows(preview, t).map(summaryRow) : []));

  if (importState.view === 'loading') importMessage.textContent = t('common.loading');
  else if (importState.view === 'confirming') importMessage.textContent = t('import.applying');
  else importMessage.textContent = renderMessage(t, importState.error);
}

function dispatchImport(event) {
  importState = reduceImport(importState, event);
  renderImport();
}

async function loadImportStatus() {
  const requestId = statusRequests.next();
  try {
    const { data } = await requestJson('/api/teacher/guided-notes');
    if (!statusRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'loaded', current: data.current, phase: currentPhase() });
  } catch (error) {
    if (!statusRequests.isLatest(requestId) || handleAuthError(error)) return;
    showMessage(importCurrent, { key: 'import.loadFailed', params: { message: errorMessage(error) } });
  }
}

async function requestPreview(send) {
  const requestId = importRequests.next();
  dispatchImport({ type: 'requestPreview' });
  try {
    const { data } = await send();
    if (!importRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'previewLoaded', preview: data });
  } catch (error) {
    if (!importRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'previewFailed', message: errorMessage(error) });
    if (!handleAuthError(error)) loadImportStatus();
  }
}

importUploadButton.addEventListener('click', () => {
  const file = importFile.files?.[0];
  if (!file) {
    dispatchImport({ type: 'previewFailed', message: { key: 'import.noFile' } });
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    dispatchImport({ type: 'previewFailed', message: { key: 'import.tooLarge' } });
    return;
  }
  requestPreview(() => requestJson('/api/teacher/guided-notes/preview/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  }));
});

importLinkButton.addEventListener('click', () => {
  const url = importLink.value.trim();
  if (!url) {
    dispatchImport({ type: 'previewFailed', message: { key: 'import.noLink' } });
    return;
  }
  requestPreview(() => postJson('/api/teacher/guided-notes/preview/link', { url }));
});

importConfirmButton.addEventListener('click', async () => {
  const previewId = importState.preview?.previewId;
  const requestId = importRequests.next();
  dispatchImport({ type: 'requestConfirm' });
  try {
    const { data } = await postJson('/api/teacher/guided-notes/confirm', { previewId });
    if (!importRequests.isLatest(requestId)) return;
    importFile.value = '';
    importLink.value = '';
    dispatchImport({ type: 'confirmed', current: data.current });
    dispatchExport({ type: 'importLoaded', source: data.current?.source?.type ?? null });
    loadSummary();
    loadExportConfig();
  } catch (error) {
    if (!importRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'confirmFailed', message: errorMessage(error) });
    if (!handleAuthError(error)) loadImportStatus();
  }
});

importCancelButton.addEventListener('click', () => {
  importRequests.next();
  dispatchImport({ type: 'cancel' });
});

// ---- 匯出結果 ----

const exportDescription = document.querySelector('#export-description');
const exportWritebackButton = document.querySelector('#export-writeback');
const exportDownloadButton = document.querySelector('#export-download');
const exportCsvButton = document.querySelector('#export-csv');
const exportMessage = document.querySelector('#export-message');
let exportState = createExportState();
const exportConfigRequests = createRequestSequence();

function renderExport() {
  const view = getExportView(exportState, t);
  exportDescription.textContent = view.description;
  exportWritebackButton.disabled = !view.canWriteback;
  exportWritebackButton.textContent = view.writebackLabel;
  exportDownloadButton.disabled = !view.canDownload;
  exportDownloadButton.textContent = view.downloadLabel;
  exportCsvButton.disabled = !view.canDownloadCsv;
  exportCsvButton.textContent = view.csvLabel;
  exportMessage.textContent = view.resultText;
  exportMessage.classList.toggle('ok', view.resultTone === 'ok');
}

function dispatchExport(event) {
  exportState = reduceExport(exportState, event);
  renderExport();
}

async function loadExportConfig() {
  const requestId = exportConfigRequests.next();
  try {
    const { data } = await requestJson('/api/teacher/guided-notes/writeback');
    if (!exportConfigRequests.isLatest(requestId)) return;
    dispatchExport({ type: 'configLoaded', ...data });
  } catch (error) {
    if (!exportConfigRequests.isLatest(requestId)) return;
    handleAuthError(error);
  }
}

exportWritebackButton.addEventListener('click', async () => {
  if (!getExportView(exportState).canWriteback) return;
  dispatchExport({ type: 'requestWriteback' });
  try {
    const { data } = await requestJson('/api/teacher/guided-notes/writeback', { method: 'POST' });
    dispatchExport({ type: 'writebackDone', ...data });
  } catch (error) {
    if (handleAuthError(error)) return;
    dispatchExport({ type: 'writebackFailed', message: errorMessage(error) });
  }
});

// 用 fetch 取得檔案再觸發下載，失敗時才能讀到 JSON 錯誤訊息（xlsx 與 csv 共用）
async function downloadFile(url, fallbackName) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new ApiError(ZH('error.NO_RESPONSE'), undefined, undefined, 'NO_RESPONSE');
  }
  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // 非 JSON 回應視為伺服器錯誤
    }
    throw new ApiError(body?.error?.message || ZH('error.generic'), body?.error?.code, response.status, body?.error?.code ?? 'generic');
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileNameFromDisposition(response.headers.get('Content-Disposition'), fallbackName);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

exportDownloadButton.addEventListener('click', async () => {
  if (!getExportView(exportState).canDownload) return;
  dispatchExport({ type: 'requestDownload' });
  try {
    await downloadFile('/api/teacher/guided-notes/export', 'guided-notes-answers.xlsx');
    dispatchExport({ type: 'downloadDone' });
  } catch (error) {
    if (handleAuthError(error)) return;
    dispatchExport({ type: 'downloadFailed', message: errorMessage(error) });
  }
});

exportCsvButton.addEventListener('click', async () => {
  if (!getExportView(exportState).canDownloadCsv) return;
  dispatchExport({ type: 'requestCsv' });
  try {
    await downloadFile('/api/teacher/results/csv', 'results.csv');
    dispatchExport({ type: 'csvDone' });
  } catch (error) {
    if (handleAuthError(error)) return;
    dispatchExport({ type: 'csvFailed', message: errorMessage(error) });
  }
});

// ---- 作答監看 ----

const monitorTitle = document.querySelector('#monitor-title');
const monitorHint = document.querySelector('#monitor-hint');
const monitorList = document.querySelector('#monitor-list');
let monitorState = createMonitorState();
// 記住老師展開的題目，重新整理畫面時保持展開
const openQuestions = new Set();
// 送出中的作廢請求（題號:順位），重繪時維持按鈕停用
const pendingVoids = new Set();

function renderMonitor() {
  const view = getMonitorView(monitorState, t);
  monitorTitle.textContent = view.title;
  monitorHint.textContent = view.hint;
  monitorHint.hidden = view.hint === '';
  monitorList.replaceChildren(...view.rows.map((row) => {
    const details = document.createElement('details');
    details.open = openQuestions.has(row.id);
    details.addEventListener('toggle', () => {
      if (details.open) openQuestions.add(row.id);
      else openQuestions.delete(row.id);
    });
    const summary = document.createElement('summary');
    const label = document.createElement('strong');
    label.textContent = row.label;
    summary.append(label, document.createTextNode(row.summary));
    const prompt = document.createElement('p');
    prompt.className = 'prompt';
    prompt.textContent = row.prompt;
    const list = document.createElement('ul');
    list.replaceChildren(...row.details.map((line) => {
      const item = document.createElement('li');
      item.textContent = line.text;
      if (line.voided) item.className = 'voided';
      if (line.voidAction) {
        const { questionId, rank, groupName } = line.voidAction;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'danger void-button';
        button.textContent = t('monitor.void');
        button.dataset.questionId = String(questionId);
        button.dataset.rank = String(rank);
        button.dataset.groupName = groupName;
        button.disabled = pendingVoids.has(`${questionId}:${rank}`);
        item.append(button);
      }
      return item;
    }));
    details.append(summary, prompt, list);
    return details;
  }));
}

function dispatchMonitor(event) {
  monitorState = reduceMonitor(monitorState, event);
  renderMonitor();
  if (monitorState.wantsRequest && consoleState.view === 'console') loadMonitor();
}

function monitorChanged() {
  dispatchMonitor({ type: 'changed' });
}

// 監看畫面每次都整個重繪，所以作廢按鈕用事件委派（add-submission-void design 第 6 節）
monitorList.addEventListener('click', (event) => {
  const button = event.target.closest('button.void-button');
  if (!button) return;
  const questionId = Number(button.dataset.questionId);
  const rank = Number(button.dataset.rank);
  if (!window.confirm(t('monitor.voidConfirm', { group: button.dataset.groupName, id: questionId }))) return;
  voidSubmission(questionId, rank);
});

async function voidSubmission(questionId, rank) {
  const key = `${questionId}:${rank}`;
  if (pendingVoids.has(key)) return;
  pendingVoids.add(key);
  renderMonitor();
  try {
    // 成功後不自行改畫面，等 monitor 通知重新讀取
    await requestJson('/api/teacher/submissions/void', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, rank }),
    });
    pendingVoids.delete(key);
    renderMonitor();
  } catch (error) {
    pendingVoids.delete(key);
    renderMonitor();
    if (handleAuthError(error)) return;
    monitorHint.hidden = false;
    showMessage(monitorHint, { key: 'monitor.voidFailed', params: { message: errorMessage(error) } });
  }
}

async function loadMonitor() {
  dispatchMonitor({ type: 'requestMonitor' });
  const seq = monitorState.requestSeq;
  try {
    const { data } = await requestJson('/api/teacher/monitor');
    dispatchMonitor({ type: 'monitorLoaded', seq, data });
  } catch (error) {
    dispatchMonitor({ type: 'monitorFailed', seq });
    if (!handleAuthError(error) && seq === monitorState.requestSeq) {
      monitorHint.hidden = false;
      showMessage(monitorHint, { key: 'monitor.loadFailed', params: { message: errorMessage(error) } });
    }
  }
}

renderConsole();
renderImport();
renderExport();
renderMonitor();
loadAuth();
