import { getEntryNextStep, getPhaseDisplay, getStoredEntryNextStep, isReconnecting, isStaleRequest } from './logic.js';

const selection = document.querySelector('#selection');
const waiting = document.querySelector('#waiting');
const groupList = document.querySelector('#groups');
const status = document.querySelector('#status');
const refreshButton = document.querySelector('#refresh');
const groupName = document.querySelector('#group-name');
const phaseText = document.querySelector('#phase-text');

const reconnectBanner = document.createElement('p');
reconnectBanner.textContent = '重新連線中…';
reconnectBanner.setAttribute('role', 'status');
reconnectBanner.setAttribute('aria-live', 'polite');
reconnectBanner.hidden = true;
document.querySelector('main').prepend(reconnectBanner);

const changeGroupButton = document.createElement('button');
changeGroupButton.type = 'button';
changeGroupButton.textContent = '更換組別';
waiting.append(changeGroupButton);

let studentId;
let storedStudentId = false;
let phase = '準備中';
let lastEventAt = null;
let reconnectingAfterError = false;
let changingGroup = false;
let groupsRequestId = 0;

function createStudentId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
  return `stu-${randomPart}`;
}

function getStoredStudentId() {
  try {
    const stored = localStorage.getItem('studentId');
    if (stored) return stored;
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return null;
}

function persistStudentId(value) {
  try {
    localStorage.setItem('studentId', value);
  } catch {
    // The successful entry remains usable for this page session.
  }
  studentId = value;
  storedStudentId = true;
}

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.error?.message || '伺服器發生錯誤。');
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

function showSelection(message = '') {
  waiting.hidden = true;
  selection.hidden = false;
  loadGroups(message);
}

function updateWaitingView() {
  const display = getPhaseDisplay(phase);
  phaseText.textContent = `目前階段：${phase}。${display.message}`;
  changeGroupButton.hidden = !display.canChangeGroup;
}

function showEntryResult(response) {
  const next = getEntryNextStep(response);
  if (next.screen === 'waiting') {
    selection.hidden = true;
    waiting.hidden = false;
    groupName.textContent = next.entry.group.name;
    if (next.entry.phase) phase = next.entry.phase;
    updateWaitingView();
    return;
  }
  showSelection(next.message);
}

async function loadGroups(message = '') {
  const requestId = ++groupsRequestId;
  status.textContent = '載入中…';
  groupList.replaceChildren();
  refreshButton.hidden = true;
  try {
    const { data } = await requestJson('/api/groups');
    if (isStaleRequest(requestId, groupsRequestId)) return;
    if (!data.groups.length) {
      status.textContent = '老師尚未設定組別';
      refreshButton.hidden = false;
      return;
    }
    status.textContent = message;
    for (const group of data.groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = group.name;
      button.addEventListener('click', () => enterGroup(group.id, button));
      groupList.append(button);
    }
  } catch (error) {
    if (isStaleRequest(requestId, groupsRequestId)) return;
    status.textContent = error.message;
    refreshButton.hidden = false;
  }
}

async function restoreEntry() {
  if (!studentId) return null;
  try {
    const entry = await requestJson(`/api/student/entry?studentId=${encodeURIComponent(studentId)}`);
    const next = getStoredEntryNextStep(storedStudentId, entry);
    if (next.screen === 'waiting') showEntryResult(entry);
    else showSelection(next.shouldExplain ? next.message : '');
    return entry;
  } catch (error) {
    showSelection(error.message);
    return null;
  }
}

async function enterGroup(groupId, button) {
  const isNewStudent = !studentId;
  const pendingStudentId = studentId || createStudentId();
  for (const item of groupList.querySelectorAll('button')) item.disabled = true;
  try {
    const response = await requestJson('/api/student/entry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: pendingStudentId, groupId }),
    });
    if (isNewStudent) persistStudentId(pendingStudentId);
    showEntryResult(response);
  } catch (error) {
    if (error.code === 'GROUP_NOT_FOUND') await loadGroups('這個組別已不存在');
    else if (error.code === 'GROUP_CHANGE_NOT_ALLOWED' && changingGroup) {
      changingGroup = false;
      await restoreEntry();
      if (!waiting.hidden) phaseText.textContent = `${phaseText.textContent} ${error.message}`;
    } else status.textContent = error.message;
    button.disabled = false;
  }
}

async function synchronizeFromServer() {
  try {
    const [session] = await Promise.all([
      requestJson('/api/session'),
      restoreEntry(),
    ]);
    if (!waiting.hidden) {
      phase = session.data.phase;
      updateWaitingView();
    }
  } catch (error) {
    if (!waiting.hidden) status.textContent = error.message;
  }
}

function handlePhase(event) {
  lastEventAt = Date.now();
  reconnectBanner.hidden = true;
  try {
    const update = JSON.parse(event.data);
    phase = update.phase;
    if (!waiting.hidden) updateWaitingView();
  } catch {
    // Ignore malformed event data; the next session snapshot will resynchronize.
  }
}

function handleHeartbeat() {
  lastEventAt = Date.now();
  reconnectBanner.hidden = true;
}

const eventSource = new EventSource('/api/events');
eventSource.addEventListener('phase', handlePhase);
eventSource.addEventListener('heartbeat', handleHeartbeat);
eventSource.addEventListener('error', () => {
  reconnectingAfterError = true;
});
eventSource.addEventListener('open', () => {
  if (!reconnectingAfterError) return;
  reconnectingAfterError = false;
  lastEventAt = Date.now();
  reconnectBanner.hidden = true;
  synchronizeFromServer();
});

setInterval(() => {
  reconnectBanner.hidden = !isReconnecting(lastEventAt);
}, 5_000);

refreshButton.addEventListener('click', () => loadGroups());
changeGroupButton.addEventListener('click', () => {
  if (phase !== '準備中') return;
  changingGroup = true;
  showSelection('請選擇新的組別。');
});

studentId = getStoredStudentId();
storedStudentId = Boolean(studentId);
if (storedStudentId) restoreEntry();
else showSelection();
