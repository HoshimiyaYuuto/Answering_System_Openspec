// 投影看板頁：只負責 DOM、請求與事件連線，狀態與顯示內容由 board-logic.js 決定（add-projector-board design 第 3 節）
import { createBoardState, getBoardView, reduceBoard } from './board-logic.js';

const checkingView = document.querySelector('#checking');
const loginView = document.querySelector('#login');
const loginMessage = document.querySelector('#login-message');
const boardView = document.querySelector('#board');
const phaseHeading = document.querySelector('#phase');
const countdownDisplay = document.querySelector('#countdown');
const presenceSection = document.querySelector('#presence-section');
const onlineCount = document.querySelector('#online-count');
const groupsList = document.querySelector('#groups');
const resultsSection = document.querySelector('#results-section');
const revealNextButton = document.querySelector('#reveal-next');
const revealAllButton = document.querySelector('#reveal-all');
const revealedCount = document.querySelector('#revealed-count');
const resultsLoading = document.querySelector('#results-loading');
const resultsList = document.querySelector('#results');
const boardError = document.querySelector('#board-error');

let state = createBoardState();
let events = null;
let clockOffset = 0;
let countdownTimer = null;
let summaryRequestId = 0;

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(response.status, body?.error?.code, body?.error?.message ?? '伺服器沒有回應，請稍後再試。');
  }
  return body;
}

function recordServerTime(data) {
  const serverTime = Date.parse(data?.serverTime);
  if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
}

function showError(message) {
  boardError.textContent = message;
  boardError.hidden = message === '';
}

function handleFailure(error) {
  if (error instanceof RequestError && error.status === 401) {
    closeEvents();
    dispatch({ type: 'authExpired' });
    return true;
  }
  showError(`無法更新看板：${error.message}`);
  return false;
}

function dispatch(event) {
  state = reduceBoard(state, event);
  render();
  runRequests();
}

// 依狀態裡的 wantsRequest 發出請求；請求序號由 board-logic 管，舊回應會被丟棄
function runRequests() {
  if (state.auth !== 'in') return;
  if (state.presence.wantsRequest) loadPresence();
  if (state.results.wantsRequest) loadResults();
}

async function loadPresence() {
  dispatch({ type: 'requestPresence' });
  const seq = state.presence.seq;
  try {
    const { data } = await requestJson('/api/teacher/presence');
    recordServerTime(data);
    showError('');
    dispatch({ type: 'presenceLoaded', seq, groups: data.groups });
  } catch (error) {
    if (!handleFailure(error)) dispatch({ type: 'presenceFailed', seq });
  }
}

// 只在已結束時讀取監看（含答案）；搶答中看板不讀任何作答資料（D16）
async function loadResults() {
  dispatch({ type: 'requestResults' });
  const seq = state.results.seq;
  try {
    const { data } = await requestJson('/api/teacher/monitor');
    showError('');
    dispatch({ type: 'resultsLoaded', seq, questions: data.questions });
  } catch (error) {
    if (!handleFailure(error)) dispatch({ type: 'resultsFailed', seq });
  }
}

async function loadSummary() {
  summaryRequestId += 1;
  const requestId = summaryRequestId;
  try {
    const { data } = await requestJson('/api/session');
    if (requestId !== summaryRequestId) return;
    recordServerTime(data);
    showError('');
    dispatch({ type: 'summaryLoaded', summary: data });
  } catch (error) {
    if (requestId !== summaryRequestId) return;
    handleFailure(error);
  }
}

function closeEvents() {
  if (!events) return;
  events.close();
  events = null;
}

function openEvents() {
  if (events) return;
  const source = new EventSource('/api/events?role=teacher');
  events = source;
  // 連上或重連時重新取得權威快照
  source.addEventListener('open', () => {
    loadSummary();
    dispatch({ type: 'presenceChanged' });
  });
  source.addEventListener('error', () => {
    if (source.readyState !== EventSource.CLOSED || events !== source) return;
    // 連線被拒（例如 server 重啟後登入失效）時不會自動重連，重新確認登入狀態
    events = null;
    checkAuth();
  });
  source.addEventListener('phase', (event) => {
    try {
      recordServerTime(JSON.parse(event.data));
    } catch {
      // 格式錯誤的事件直接略過，下面重新讀取摘要
    }
    loadSummary();
  });
  source.addEventListener('presence', () => dispatch({ type: 'presenceChanged' }));
}

async function checkAuth() {
  try {
    const { data } = await requestJson('/api/teacher/auth');
    dispatch({ type: 'authChecked', authenticated: data.authenticated === true });
    if (state.auth === 'in') {
      openEvents();
      loadSummary();
    }
  } catch (error) {
    checkingView.textContent = `無法連線到伺服器：${error.message}`;
  }
}

function renderGroups(groups) {
  groupsList.replaceChildren(...groups.map((group) => {
    const item = document.createElement('li');
    item.className = group.online ? 'online' : '';
    const name = document.createElement('span');
    name.textContent = group.name;
    const status = document.createElement('span');
    status.className = 'state';
    status.textContent = group.statusText;
    item.append(name, status);
    return item;
  }));
}

function renderResults(results) {
  revealNextButton.disabled = !results.canRevealNext;
  revealAllButton.disabled = !results.canRevealAll;
  revealedCount.textContent = results.revealedText;
  resultsLoading.hidden = !results.loading;
  resultsList.replaceChildren(...results.rows.map((row) => {
    const item = document.createElement('li');
    item.className = row.revealed ? '' : 'hidden-result';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = row.label;
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = row.text;
    item.append(label, text);
    return item;
  }));
}

function render() {
  const view = getBoardView(state, Date.now() + clockOffset);
  checkingView.hidden = view.view !== 'checking';
  loginView.hidden = view.view !== 'login';
  boardView.hidden = view.view !== 'board';
  if (view.view === 'login') loginMessage.textContent = view.message;
  if (view.view !== 'board') {
    updateCountdownTimer(false);
    return;
  }

  phaseHeading.textContent = view.phaseText;
  countdownDisplay.hidden = view.countdownText === '';
  countdownDisplay.textContent = view.countdownText === '' ? '' : `剩餘 ${view.countdownText}`;
  updateCountdownTimer(view.countdownText !== '');

  presenceSection.hidden = view.results !== null || view.groups.length === 0;
  onlineCount.textContent = view.onlineText;
  renderGroups(view.groups);

  resultsSection.hidden = view.results === null;
  if (view.results) {
    renderResults(view.results);
  } else {
    resultsList.replaceChildren();
    revealedCount.textContent = '';
  }
}

function updateCountdownTimer(running) {
  if (running && countdownTimer === null) countdownTimer = setInterval(render, 1000);
  if (!running && countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

revealNextButton.addEventListener('click', () => dispatch({ type: 'revealNext' }));
revealAllButton.addEventListener('click', () => dispatch({ type: 'revealAll' }));

checkAuth();
