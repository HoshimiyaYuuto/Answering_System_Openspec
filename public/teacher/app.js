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

const countInput = document.querySelector('#group-count');
const generateButton = document.querySelector('#generate');
const applyButton = document.querySelector('#apply');
const groupList = document.querySelector('#group-list');
const message = document.querySelector('#message');
const hostWarning = document.querySelector('#host-warning');

const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isAllowedHost = allowedHosts.has(location.hostname.toLowerCase());
hostWarning.hidden = isAllowedHost;

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || '伺服器發生錯誤。');
  return body;
}

function renderGroups(groups) {
  groupList.replaceChildren();
  for (const group of groups) {
    const row = document.createElement('label');
    row.textContent = `第 ${group.id} 組名稱`;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 30;
    input.value = group.name;
    input.dataset.groupId = String(group.id);
    row.append(input);
    groupList.append(row);
  }
}

async function loadGroups() {
  try {
    const { data } = await requestJson('/api/groups');
    renderGroups(data.groups);
  } catch (error) {
    message.textContent = error.message;
  }
}

generateButton.addEventListener('click', async () => {
  const count = Number(countInput.value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    message.textContent = '組數必須是 1 到 100 的整數。';
    return;
  }
  generateButton.disabled = true;
  try {
    const { data } = await requestJson('/api/groups/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    renderGroups(data.groups);
    message.textContent = '已產生組別，確認名稱後按「套用組別」。';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    generateButton.disabled = false;
  }
});

applyButton.addEventListener('click', async () => {
  const groups = Array.from(groupList.querySelectorAll('input[data-group-id]'), (input) => ({
    id: Number(input.dataset.groupId),
    name: input.value,
  }));
  if (!groups.length) {
    message.textContent = '請先載入或產生組別。';
    return;
  }
  applyButton.disabled = true;
  try {
    const { data } = await requestJson('/api/groups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    });
    renderGroups(data.groups);
    message.textContent = '組別設定已套用。';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    applyButton.disabled = false;
  }
});

loadGroups();

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

let importState = createImportState({ isAllowedHost });
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
  const blockedReason = getBlockedReason(importState);
  importCurrent.textContent = isAllowedHost
    ? describeCurrent(importState.current)
    : '請以 localhost 開啟本頁才能查看匯入狀態。';
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
  importSummaryLines.replaceChildren(...(preview ? listItems(describePreview(preview)) : []));
  importWarnings.replaceChildren(...(preview ? listItems(preview.warnings) : []));
  importRows.replaceChildren(...(preview ? getSummaryRows(preview).map(summaryRow) : []));

  if (importState.view === 'loading') importMessage.textContent = '讀取中…';
  else if (importState.view === 'confirming') importMessage.textContent = '套用中…';
  else importMessage.textContent = importState.error;
}

function dispatchImport(event) {
  importState = reduceImport(importState, event);
  renderImport();
}

async function loadImportStatus() {
  const requestId = statusRequests.next();
  try {
    const [session, imported] = await Promise.all([
      requestJson('/api/session'),
      isAllowedHost ? requestJson('/api/teacher/guided-notes') : Promise.resolve({ data: { current: null } }),
    ]);
    if (!statusRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'loaded', phase: session.data.phase, current: imported.data.current });
  } catch (error) {
    if (!statusRequests.isLatest(requestId)) return;
    importCurrent.textContent = `無法取得匯入狀態：${error.message}`;
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
    dispatchImport({ type: 'previewFailed', message: error.message });
    loadImportStatus();
  }
}

importUploadButton.addEventListener('click', () => {
  const file = importFile.files?.[0];
  if (!file) {
    dispatchImport({ type: 'previewFailed', message: '請先選擇 xlsx 檔。' });
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    dispatchImport({ type: 'previewFailed', message: '檔案超過 5 MiB 上限。' });
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
    dispatchImport({ type: 'previewFailed', message: '請先貼上 Google 試算表連結。' });
    return;
  }
  requestPreview(() => requestJson('/api/teacher/guided-notes/preview/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }));
});

importConfirmButton.addEventListener('click', async () => {
  const previewId = importState.preview?.previewId;
  const requestId = importRequests.next();
  dispatchImport({ type: 'requestConfirm' });
  try {
    const { data } = await requestJson('/api/teacher/guided-notes/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewId }),
    });
    if (!importRequests.isLatest(requestId)) return;
    importFile.value = '';
    importLink.value = '';
    dispatchImport({ type: 'confirmed', current: data.current });
  } catch (error) {
    if (!importRequests.isLatest(requestId)) return;
    dispatchImport({ type: 'confirmFailed', message: error.message });
    loadImportStatus();
  }
});

importCancelButton.addEventListener('click', () => {
  importRequests.next();
  dispatchImport({ type: 'cancel' });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadImportStatus();
});

renderImport();
loadImportStatus();
