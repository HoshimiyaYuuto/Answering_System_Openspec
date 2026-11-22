import { applySubmission, getAnsweringScreen, getEntryNextStep, getPhaseDisplay, getQuestionStatus, getStoredEntryNextStep, getSubmitErrorNextStep, isReconnecting, isStaleRequest, validateAnswers } from './logic.js';
import { createDraftStore } from './drafts.js';

const selection = document.querySelector('#selection');
const waiting = document.querySelector('#waiting');
const groupList = document.querySelector('#groups');
const status = document.querySelector('#status');
const refreshButton = document.querySelector('#refresh');
const groupName = document.querySelector('#group-name');
const phaseText = document.querySelector('#phase-text');
const answering = document.querySelector('#answering');
const answeringMessage = document.querySelector('#answering-message');
const questionGrid = document.querySelector('#question-grid');
const questionPage = document.querySelector('#question-page');
const retryQuestionsButton = document.querySelector('#retry-questions');
const ended = document.querySelector('#ended');

let draftStorage;
try {
  draftStorage = localStorage;
} catch {
  draftStorage = undefined;
}
const drafts = createDraftStore(draftStorage);

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
let answeringRequestId = 0;
let currentEntry = null;
let loadedQuestions = [];
let loadedSubmissions = [];
let activeQuestionId = null;
let answeringView = 'grid';
let isSubmitting = false;
let questionInputs = [];
let questionSubmitButton = null;
let questionBackButton = null;

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
  answeringRequestId += 1;
  currentEntry = null;
  waiting.hidden = true;
  answering.hidden = true;
  ended.hidden = true;
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
    currentEntry = next.entry;
    groupName.textContent = next.entry.group.name;
    if (next.entry.phase) phase = next.entry.phase;
    showPhaseScreen();
    return;
  }
  showSelection(next.message);
}

function showPhaseScreen() {
  const screen = getAnsweringScreen(Boolean(currentEntry?.valid), phase);
  selection.hidden = screen !== 'select-group';
  waiting.hidden = screen !== 'waiting';
  answering.hidden = screen !== 'answering';
  ended.hidden = screen !== 'ended';
  if (screen === 'waiting') updateWaitingView();
  if (screen === 'answering') loadAnsweringData();
  if (screen === 'ended') {
    answeringRequestId += 1;
    questionGrid.replaceChildren();
    questionPage.replaceChildren();
    answeringMessage.textContent = '';
    answeringMessage.hidden = true;
    questionGrid.hidden = true;
    answeringView = 'grid';
    activeQuestionId = null;
  }
}

function renderQuestionGrid(questions, submissions) {
  questionGrid.replaceChildren();
  for (const question of questions) {
    const hasSubmission = submissions.some((submission) => submission.questionId === question.id);
    if (hasSubmission) drafts.remove(studentId, question.id);
    const hasDraft = drafts.has(studentId, question.id, question.blanks.length);
    const statusByKey = {
      unanswered: '未作答',
      draft: '草稿',
      submitted: '已送出',
    };
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `第 ${question.id} 題：${statusByKey[getQuestionStatus(hasSubmission, hasDraft)]}`;
    button.addEventListener('click', () => openQuestion(question.id));
    questionGrid.append(button);
  }
}

function showQuestionGrid() {
  answeringView = 'grid';
  questionGrid.hidden = false;
  questionPage.hidden = true;
  renderQuestionGrid(loadedQuestions, loadedSubmissions);
}

function openQuestion(questionId) {
  const question = loadedQuestions.find((item) => item.id === questionId);
  if (!question) return;
  activeQuestionId = questionId;
  answeringView = 'question';
  renderQuestionPage(question);
}

function saveCurrentDraft() {
  if (activeQuestionId === null || !questionInputs.length) return;
  const values = questionInputs.map((input) => input.value);
  const question = loadedQuestions.find((item) => item.id === activeQuestionId);
  if (question) drafts.set(studentId, activeQuestionId, values);
}

function renderQuestionPage(question, options = {}) {
  const blanks = [...question.blanks].sort((a, b) => a.index - b.index);
  const submission = loadedSubmissions.find((item) => item.questionId === question.id);
  const locked = Boolean(submission);
  const savedDraft = locked ? null : drafts.get(studentId, question.id, blanks.length);
  questionPage.replaceChildren();
  questionInputs = [];
  questionSubmitButton = null;
  questionBackButton = null;
  questionPage.hidden = false;
  questionGrid.hidden = true;

  const title = document.createElement('h3');
  title.textContent = `第 ${question.id} 題`;
  questionPage.append(title);

  const message = document.createElement('p');
  message.className = 'message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = options.message || (locked ? '已送出' : '');
  questionPage.append(message);
  const validationMessages = [];

  blanks.forEach((blank, index) => {
    const blankLabel = [blank.prefix, blank.prompt].filter(Boolean).join(' ') || `第 ${question.id} 題第 ${index + 1} 格答案`;
    const label = document.createElement('label');
    label.htmlFor = `answer-${question.id}-${index}`;
    label.textContent = blankLabel;
    questionPage.append(label);

    const input = document.createElement('input');
    input.id = `answer-${question.id}-${index}`;
    input.className = 'answer-input';
    input.type = 'text';
    input.minLength = 1;
    input.setAttribute('aria-label', blankLabel);
    input.value = locked ? (submission.answers[index] ?? '') : (savedDraft?.[index] ?? '');
    input.disabled = locked || isSubmitting;
    questionInputs.push(input);
    questionPage.append(input);

    const validationMessage = document.createElement('p');
    validationMessage.className = 'message';
    validationMessage.setAttribute('role', 'status');
    validationMessages.push(validationMessage);
    questionPage.append(validationMessage);
    input.addEventListener('input', () => {
      if (!locked) {
        drafts.set(studentId, question.id, questionInputs.map((item) => item.value));
        renderQuestionGrid(loadedQuestions, loadedSubmissions);
      }
    });
  });

  if (options.validationErrors) {
    for (const error of options.validationErrors) {
      if (error.index !== null && validationMessages[error.index]) {
        validationMessages[error.index].textContent = error.reason === 'too-long'
          ? '答案不可超過 200 字。'
          : error.reason === 'empty'
            ? '請填寫此空格。'
            : '答案格式錯誤。';
      } else if (error.reason === 'wrong-count') {
        message.textContent = '請填寫所有空格。';
      }
    }
  }

  if (!locked) {
    questionSubmitButton = document.createElement('button');
    questionSubmitButton.type = 'button';
    questionSubmitButton.textContent = isSubmitting ? '送出中…' : '送出答案';
    questionSubmitButton.disabled = isSubmitting;
    questionSubmitButton.addEventListener('click', submitCurrentQuestion);
    questionPage.append(questionSubmitButton);
  }

  questionBackButton = document.createElement('button');
  questionBackButton.type = 'button';
  questionBackButton.className = 'secondary';
  questionBackButton.textContent = '返回題號格';
  questionBackButton.disabled = isSubmitting;
  questionBackButton.addEventListener('click', () => {
    saveCurrentDraft();
    showQuestionGrid();
  });
  questionPage.append(questionBackButton);
}

function setQuestionControlsDisabled(disabled) {
  for (const input of questionInputs) input.disabled = disabled;
  if (questionSubmitButton) questionSubmitButton.disabled = disabled;
  if (questionBackButton) questionBackButton.disabled = disabled;
}

async function refreshSubmissions() {
  const query = `studentId=${encodeURIComponent(studentId)}`;
  const response = await requestJson(`/api/student/submissions?${query}`);
  const submissions = response?.data?.submissions;
  if (!Array.isArray(submissions)) throw new Error('伺服器回應格式錯誤。');
  loadedSubmissions = submissions;
  renderQuestionGrid(loadedQuestions, loadedSubmissions);
  return submissions;
}

async function submitCurrentQuestion() {
  if (isSubmitting || activeQuestionId === null || loadedSubmissions.some((item) => item.questionId === activeQuestionId)) return;
  const question = loadedQuestions.find((item) => item.id === activeQuestionId);
  if (!question) return;
  const result = validateAnswers(questionInputs.map((input) => input.value), question.blanks.length);
  if (!result.ok) {
    saveCurrentDraft();
    renderQuestionPage(question, { validationErrors: result.errors });
    return;
  }

  isSubmitting = true;
  setQuestionControlsDisabled(true);
  if (questionSubmitButton) questionSubmitButton.textContent = '送出中…';
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);
  try {
    const response = await requestJson('/api/student/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, questionId: activeQuestionId, answers: result.answers }),
      signal: controller.signal,
    });
    const data = response?.data ?? {};
    loadedSubmissions = applySubmission(loadedSubmissions, {
      questionId: activeQuestionId,
      answers: result.answers,
      submittedAt: data.submittedAt,
    });
    drafts.remove(studentId, activeQuestionId);
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    renderQuestionPage(question);
  } catch (caught) {
    const error = timedOut
      ? Object.assign(new Error('伺服器沒有回應'), { name: 'AbortError' })
      : caught;
    if (error instanceof TypeError && !error.code) error.type = 'network';
    const next = getSubmitErrorNextStep(error);
    if (next.action === 'refresh-submissions') {
      try {
        const submissions = await refreshSubmissions();
        const matching = submissions.find((item) => item.questionId === activeQuestionId);
        if (matching) {
          drafts.remove(studentId, activeQuestionId);
          renderQuestionPage(question, { message: '本組已由其他裝置送出' });
        } else {
          messageForCurrentQuestion(error.message);
        }
      } catch (refreshError) {
        messageForCurrentQuestion(refreshError.message);
      }
    } else if (next.action === 'refresh-session') {
      saveCurrentDraft();
      try {
        const session = await requestJson('/api/session');
        phase = session.data.phase;
        if (phase === '已結束') showPhaseScreen();
        else messageForCurrentQuestion(error.message);
      } catch (refreshError) {
        messageForCurrentQuestion(refreshError.message);
      }
    } else if (next.action === 'restore-entry') {
      saveCurrentDraft();
      showSelection('進場狀態已失效，請重新選擇組別。');
    } else if (next.action === 'reload-questions') {
      saveCurrentDraft();
      await loadAnsweringData();
      messageForCurrentQuestion(error.message);
    } else if (next.action === 'retry') {
      messageForCurrentQuestion('伺服器沒有回應');
    } else {
      messageForCurrentQuestion(error.message);
    }
  } finally {
    clearTimeout(timeout);
    isSubmitting = false;
    if (answeringView === 'question' && activeQuestionId !== null) {
      const isLocked = loadedSubmissions.some((item) => item.questionId === activeQuestionId);
      setQuestionControlsDisabled(isLocked);
      if (questionBackButton) questionBackButton.disabled = false;
      if (questionSubmitButton && !isLocked) questionSubmitButton.textContent = '送出答案';
    }
  }
}

function messageForCurrentQuestion(text) {
  const message = questionPage.querySelector('[role="status"]');
  if (message) message.textContent = text;
}

async function loadAnsweringData() {
  if (!studentId || phase !== '搶答中' || !currentEntry?.valid) return;
  const requestId = ++answeringRequestId;
  answeringMessage.textContent = '載入題目中…';
  answeringMessage.hidden = false;
  questionGrid.hidden = true;
  retryQuestionsButton.hidden = true;
  try {
    const query = `studentId=${encodeURIComponent(studentId)}`;
    const [questionsResponse, submissionsResponse] = await Promise.all([
      requestJson(`/api/student/questions?${query}`),
      requestJson(`/api/student/submissions?${query}`),
    ]);
    if (isStaleRequest(requestId, answeringRequestId)) return;
    const questions = questionsResponse?.data?.questions;
    const submissions = submissionsResponse?.data?.submissions;
    if (!Array.isArray(questions) || !Array.isArray(submissions)) throw new Error('伺服器回應格式錯誤。');
    loadedQuestions = questions;
    loadedSubmissions = submissions;
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    answeringMessage.textContent = '';
    answeringMessage.hidden = true;
    questionGrid.hidden = answeringView !== 'grid';
    questionPage.hidden = answeringView !== 'question';
  } catch (error) {
    if (isStaleRequest(requestId, answeringRequestId)) return;
    if (error.code === 'STUDENT_NOT_ENTERED') {
      showSelection('進場狀態已失效，請重新選擇組別。');
      return;
    }
    answeringMessage.textContent = '無法載入題目，請稍後再試';
    answeringMessage.hidden = false;
    retryQuestionsButton.hidden = false;
  }
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
    if (currentEntry?.valid) {
      phase = session.data.phase;
      showPhaseScreen();
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
    if (currentEntry?.valid) showPhaseScreen();
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
retryQuestionsButton.addEventListener('click', () => loadAnsweringData());
changeGroupButton.addEventListener('click', () => {
  if (phase !== '準備中') return;
  changingGroup = true;
  showSelection('請選擇新的組別。');
});

studentId = getStoredStudentId();
storedStudentId = Boolean(studentId);
if (storedStudentId) restoreEntry();
else showSelection();
