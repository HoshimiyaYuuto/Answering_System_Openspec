import { getEntryNextStep } from './logic.js';

const selection = document.querySelector('#selection');
const waiting = document.querySelector('#waiting');
const groupList = document.querySelector('#groups');
const status = document.querySelector('#status');
const refreshButton = document.querySelector('#refresh');
const groupName = document.querySelector('#group-name');
let studentId;

function createStudentId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const randomPart = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
  return `stu-${randomPart}`;
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
  status.textContent = message;
}

function showEntryResult(response) {
  const next = getEntryNextStep(response);
  if (next.screen === 'waiting') {
    selection.hidden = true;
    waiting.hidden = false;
    groupName.textContent = next.entry.group.name;
    return;
  }
  showSelection(next.message);
}

async function loadGroups(message = '') {
  status.textContent = message;
  groupList.replaceChildren();
  refreshButton.hidden = true;
  try {
    const { data } = await requestJson('/api/groups');
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
    status.textContent = error.message;
    refreshButton.hidden = false;
  }
}

async function enterGroup(groupId, button) {
  for (const item of groupList.querySelectorAll('button')) item.disabled = true;
  try {
    const response = await requestJson('/api/student/entry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, groupId }),
    });
    showEntryResult(response);
  } catch (error) {
    if (error.code === 'GROUP_NOT_FOUND') {
      await loadGroups('這個組別已不存在');
    } else {
      status.textContent = error.message;
    }
    button.disabled = false;
  }
}

refreshButton.addEventListener('click', () => loadGroups());
studentId = createStudentId();
loadGroups();
