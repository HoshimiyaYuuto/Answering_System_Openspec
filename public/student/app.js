import { applySubmission, buildResultsRows, getAnsweringScreen, getEntryNextStep, getEventErrorNextStep, getPhaseDisplay, getQuestionStatus, getResultsLoadNextStep, getStoredEntryNextStep, isReconnecting, isStaleRequest, mergeSubmissions, validateAnswers } from './logic.js';
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
const resultsSection = document.querySelector('#results-section');
const resultsSummary = document.querySelector('#results-summary');
const resultsList = document.querySelector('#results-list');
const resultsLoadingMessage = document.querySelector('#results-loading');
const resultsErrorMessage = document.querySelector('#results-error');
const retryResultsButton = document.querySelector('#results-retry');

let draftStorage;
try {
  draftStorage = localStorage;
} catch {
  draftStorage = undefined;
}
const drafts = createDraftStore(draftStorage);
drafts.setActivityId(null);

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
let changingGroup = false;
let groupsRequestId = 0;
let answeringRequestId = 0;
let synchronizationRequestId = 0;
let submissionsSnapshotRequestId = 0;
let currentEntry = null;
let activityId = null;
let eventSource = null;
let eventSourceUrl = null;
let closedEntryRetryTimer = null;
let closedEntryRetrySource = null;
let closedEntryCheckSource = null;
let loadedQuestions = [];
let loadedSubmissions = [];
let activeQuestionId = null;
let answeringView = 'grid';
let isSubmitting = false;
let questionInputs = [];
let questionSubmitButton = null;
let questionBackButton = null;
let resultsLoaded = false;
let resultsLoading = false;
let resultsRequestId = 0;
let resultsRequestController = null;

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
    error.status = response.status;
    throw error;
  }
  return body;
}

function showSelection(message = '') {
  answeringRequestId += 1;
  synchronizationRequestId += 1;
  submissionsSnapshotRequestId += 1;
  clearClosedEntryRetry();
  closedEntryCheckSource = null;
  clearResultsView();
  loadedSubmissions = [];
  currentEntry = null;
  ensureEventSource();
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
    clearClosedEntryRetry();
    if (currentEntry?.group?.id !== next.entry.group.id) {
      answeringRequestId += 1;
      synchronizationRequestId += 1;
      submissionsSnapshotRequestId += 1;
      loadedSubmissions = [];
    }
    currentEntry = next.entry;
    groupName.textContent = next.entry.group.name;
    if (next.entry.phase) phase = next.entry.phase;
    ensureEventSource();
    showPhaseScreen();
    return;
  }
  showSelection(next.message);
}

function showPhaseScreen() {
  const screen = getAnsweringScreen(Boolean(currentEntry?.valid), phase);
  if (screen !== 'ended') clearResultsView();
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
    loadStudentResults();
  }
}

function clearResultsView() {
  resultsRequestId += 1;
  if (resultsRequestController) {
    resultsRequestController.abort();
    resultsRequestController = null;
  }
  resultsLoaded = false;
  resultsLoading = false;
  resultsSection.hidden = true;
  resultsSummary.textContent = '';
  resultsSummary.hidden = true;
  resultsList.replaceChildren();
  resultsList.hidden = true;
  resultsLoadingMessage.hidden = true;
  resultsErrorMessage.textContent = '';
  resultsErrorMessage.hidden = true;
  retryResultsButton.hidden = true;
}

function renderStudentResults(results) {
  const view = buildResultsRows(results);
  resultsSummary.textContent = view.summary.text;
  resultsSummary.hidden = false;
  resultsList.replaceChildren();
  for (const row of view.rows) {
    const item = document.createElement('li');
    item.textContent = `${row.label}：${row.winnerText}；${row.ownText}`;
    resultsList.append(item);
  }
  resultsList.hidden = false;
  resultsLoadingMessage.hidden = true;
  resultsErrorMessage.textContent = '';
  resultsErrorMessage.hidden = true;
  retryResultsButton.hidden = true;
  resultsSection.hidden = false;
  resultsLoaded = true;
}

function showResultsError(message) {
  resultsSection.hidden = false;
  resultsSummary.hidden = true;
  resultsList.hidden = true;
  resultsLoadingMessage.hidden = true;
  resultsErrorMessage.textContent = message;
  resultsErrorMessage.hidden = false;
  retryResultsButton.hidden = false;
}

async function loadStudentResults() {
  if (!studentId || !currentEntry?.valid || phase !== '已結束') return;
  if (resultsLoading || resultsLoaded || !resultsErrorMessage.hidden) return;

  resultsLoading = true;
  const requestId = ++resultsRequestId;
  const controller = new AbortController();
  resultsRequestController = controller;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  resultsSection.hidden = false;
  resultsSummary.hidden = true;
  resultsList.replaceChildren();
  resultsList.hidden = true;
  resultsLoadingMessage.hidden = false;
  resultsErrorMessage.textContent = '';
  resultsErrorMessage.hidden = true;
  retryResultsButton.hidden = true;

  try {
    const response = await fetch(`/api/student/results?studentId=${encodeURIComponent(studentId)}`, {
      signal: controller.signal,
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = new Error(body?.error?.message || '伺服器發生錯誤。');
      error.status = response.status;
      error.code = body?.error?.code;
      throw error;
    }
    if (!Array.isArray(body?.data?.questions)) throw new Error('伺服器回應格式錯誤。');
    if (isStaleRequest(requestId, resultsRequestId)) return;
    renderStudentResults({ questions: body.data.questions });
  } catch (error) {
    if (isStaleRequest(requestId, resultsRequestId)) return;
    const next = getResultsLoadNextStep(Number.isInteger(error.status) ? error.status : null);
    if (next.action === 'restore-entry') {
      clearResultsView();
      await restoreEntry();
      return;
    }
    if (next.action === 'refresh-session') {
      await synchronizeFromServer();
      if (isStaleRequest(requestId, resultsRequestId)) return;
      if (phase !== '已結束') {
        clearResultsView();
        return;
      }
    }
    if (phase === '已結束') showResultsError(next.message);
  } finally {
    clearTimeout(timeout);
    if (!isStaleRequest(requestId, resultsRequestId)) {
      resultsLoading = false;
      resultsRequestController = null;
    }
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
  const requestedStudentId = studentId;
  const requestedGroupId = currentEntry?.group?.id;
  const requestId = ++submissionsSnapshotRequestId;
  const query = `studentId=${encodeURIComponent(requestedStudentId)}`;
  const response = await requestJson(`/api/student/submissions?${query}`);
  if (isStaleRequest(requestId, submissionsSnapshotRequestId)
    || !isCurrentEntryContext(requestedStudentId, requestedGroupId)) return loadedSubmissions;
  const submissions = projectSubmissions(response?.data?.submissions);
  loadedSubmissions = mergeSubmissions(loadedSubmissions, submissions);
  renderQuestionGrid(loadedQuestions, loadedSubmissions);
  return loadedSubmissions;
}

function isCurrentEntryContext(requestedStudentId, requestedGroupId) {
  return studentId === requestedStudentId
    && currentEntry?.valid === true
    && currentEntry.group?.id === requestedGroupId;
}

function isValidQuestionId(questionId) {
  return (typeof questionId === 'number' && Number.isFinite(questionId))
    || (typeof questionId === 'string' && questionId.length > 0);
}

function projectSubmissions(submissions) {
  if (!Array.isArray(submissions)) throw new Error('伺服器回應格式錯誤。');
  return submissions.map((submission) => {
    if (!submission || typeof submission !== 'object'
      || !isValidQuestionId(submission.questionId)
      || !Array.isArray(submission.answers)
      || !submission.answers.every((answer) => typeof answer === 'string')
      || typeof submission.submittedAt !== 'string') {
      throw new Error('伺服器回應格式錯誤。');
    }
    return {
      questionId: submission.questionId,
      answers: submission.answers.slice(),
      submittedAt: submission.submittedAt,
    };
  });
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
  const requestedStudentId = studentId;
  const requestedGroupId = currentEntry.group?.id;
  const snapshotRequestId = ++submissionsSnapshotRequestId;
  answeringMessage.textContent = '載入題目中…';
  answeringMessage.hidden = false;
  questionGrid.hidden = true;
  retryQuestionsButton.hidden = true;
  try {
    const query = `studentId=${encodeURIComponent(requestedStudentId)}`;
    const [questionsResponse, submissionsResponse, sessionResponse] = await Promise.all([
      requestJson(`/api/student/questions?${query}`),
      requestJson(`/api/student/submissions?${query}`),
      requestJson('/api/session'),
    ]);
    if (isStaleRequest(requestId, answeringRequestId)
      || !isCurrentEntryContext(requestedStudentId, requestedGroupId)) return;
    const questions = questionsResponse?.data?.questions;
    const submissions = projectSubmissions(submissionsResponse?.data?.submissions);
    if (!Array.isArray(questions)) throw new Error('伺服器回應格式錯誤。');
    updateActivityId(sessionResponse?.data);
    loadedQuestions = questions;
    if (!isStaleRequest(snapshotRequestId, submissionsSnapshotRequestId)) {
      loadedSubmissions = mergeSubmissions(loadedSubmissions, submissions);
    }
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    answeringMessage.textContent = '';
    answeringMessage.hidden = true;
    questionGrid.hidden = answeringView !== 'grid';
    questionPage.hidden = answeringView !== 'question';
  } catch (error) {
    if (isStaleRequest(requestId, answeringRequestId)
      || !isCurrentEntryContext(requestedStudentId, requestedGroupId)) return;
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
  const requestId = ++synchronizationRequestId;
  const requestedStudentId = studentId;
  const requestedGroupId = currentEntry?.group?.id;
  const submissionsRequestId = currentEntry?.valid ? ++submissionsSnapshotRequestId : null;
  try {
    const submissionsPath = requestedStudentId && currentEntry?.valid
      ? `/api/student/submissions?studentId=${encodeURIComponent(requestedStudentId)}`
      : null;
    const [session, , submissionsResponse] = await Promise.all([
      requestJson('/api/session'),
      restoreEntry(),
      submissionsPath ? requestJson(submissionsPath) : Promise.resolve(null),
    ]);
    if (isStaleRequest(requestId, synchronizationRequestId)
      || !isCurrentEntryContext(requestedStudentId, requestedGroupId)) return;
    if (currentEntry?.valid) {
      updateActivityId(session?.data);
      const phaseChanged = phase !== session.data.phase;
      if (phaseChanged && session.data.phase === '已結束' && answeringView === 'question') saveCurrentDraft();
      phase = session.data.phase;
      if (!isStaleRequest(submissionsRequestId, submissionsSnapshotRequestId)) {
        const submissions = projectSubmissions(submissionsResponse?.data?.submissions);
        loadedSubmissions = mergeSubmissions(loadedSubmissions, submissions);
      }
      renderQuestionGrid(loadedQuestions, loadedSubmissions);
      if (answeringView === 'question' && activeQuestionId !== null) {
        const question = loadedQuestions.find((item) => item.id === activeQuestionId);
        if (question && loadedSubmissions.some((item) => item.questionId === activeQuestionId)) renderQuestionPage(question);
      }
      if (phaseChanged) showPhaseScreen();
    }
  } catch (error) {
    if (!waiting.hidden) status.textContent = error.message;
  }
}

function updateActivityId(sessionData) {
  const nextActivityId = sessionData?.activityId;
  if (nextActivityId !== null && (typeof nextActivityId !== 'string' || nextActivityId.length === 0)) {
    throw new Error('伺服器回應格式錯誤。');
  }
  if (sessionData?.phase === '搶答中' && nextActivityId === null) {
    throw new Error('伺服器回應格式錯誤。');
  }
  if (activityId !== nextActivityId && activeQuestionId !== null) saveCurrentDraft();
  activityId = nextActivityId;
  drafts.setActivityId(activityId);
}

function handlePhase(event) {
  try {
    if (typeof event.data !== 'string') return;
    const update = JSON.parse(event.data);
    if (!update || typeof update !== 'object' || Array.isArray(update)) return;
    if (!['準備中', '搶答中', '已結束'].includes(update.phase)) return;
    lastEventAt = Date.now();
    reconnectBanner.hidden = true;
    if (update.phase === '已結束' && answeringView === 'question') saveCurrentDraft();
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

function handleSubmission(event) {
  try {
    if (typeof event.data !== 'string') return;
    const update = JSON.parse(event.data);
    if (!update || typeof update !== 'object' || Array.isArray(update)) return;
    const validQuestionId = (typeof update.questionId === 'number' && Number.isFinite(update.questionId))
      || (typeof update.questionId === 'string' && update.questionId.length > 0);
    if (!currentEntry?.valid || !studentId || !validQuestionId || !Array.isArray(update.answers)
      || !update.answers.every((answer) => typeof answer === 'string')
      || typeof update.submittedAt !== 'string') return;

    const submission = {
      questionId: update.questionId,
      answers: update.answers.slice(),
      submittedAt: update.submittedAt,
    };
    loadedSubmissions = applySubmission(loadedSubmissions, submission);
    drafts.remove(studentId, submission.questionId);
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    if (answeringView === 'question' && activeQuestionId === submission.questionId) {
      const question = loadedQuestions.find((item) => item.id === submission.questionId);
      if (question) renderQuestionPage(question);
    }
  } catch {
    // Ignore malformed event data; a later synchronization will reload the group's submissions.
  }
}

function ensureEventSource() {
  const targetUrl = currentEntry?.valid && studentId
    ? `/api/events?studentId=${encodeURIComponent(studentId)}`
    : '/api/events';
  if (eventSource && eventSourceUrl === targetUrl && eventSource.readyState !== 2) return;
  if (eventSource) {
    clearClosedEntryRetry(eventSource);
    if (closedEntryCheckSource === eventSource) closedEntryCheckSource = null;
    eventSource.close();
  }

  eventSourceUrl = targetUrl;
  let hasOpened = false;
  let reconnecting = false;
  const source = new EventSource(targetUrl);
  eventSource = source;
  source.addEventListener('phase', handlePhase);
  source.addEventListener('heartbeat', handleHeartbeat);
  source.addEventListener('submission', handleSubmission);
  source.addEventListener('error', () => {
    if (source !== eventSource) return;
    if (getEventErrorNextStep(source.readyState).action === 'restore-entry') {
      reconnecting = false;
      if (currentEntry?.valid && eventSourceUrl === `/api/events?studentId=${encodeURIComponent(studentId)}`) {
        confirmEntryAfterClosedEventSource(source);
      }
      return;
    }
    reconnecting = true;
  });
  source.addEventListener('open', () => {
    if (source !== eventSource) return;
    lastEventAt = Date.now();
    reconnectBanner.hidden = true;
    if (!hasOpened) {
      hasOpened = true;
      if (targetUrl !== '/api/events') {
        reconnecting = false;
        synchronizeFromServer();
      }
      return;
    }
    if (!reconnecting) return;
    reconnecting = false;
    synchronizeFromServer();
  });
}

function clearClosedEntryRetry(source = null) {
  if (source && closedEntryRetrySource !== source) return;
  if (closedEntryRetryTimer !== null) clearTimeout(closedEntryRetryTimer);
  closedEntryRetryTimer = null;
  closedEntryRetrySource = null;
}

function scheduleClosedEntryRetry(source, requestedStudentId) {
  if (source !== eventSource || closedEntryRetryTimer !== null) return;
  closedEntryRetrySource = source;
  closedEntryRetryTimer = setTimeout(() => {
    if (closedEntryRetrySource !== source) return;
    closedEntryRetryTimer = null;
    closedEntryRetrySource = null;
    if (source === eventSource && studentId === requestedStudentId) {
      confirmEntryAfterClosedEventSource(source);
    }
  }, 3_000);
}

async function confirmEntryAfterClosedEventSource(source) {
  if (source !== eventSource) return;
  if (!studentId) {
    showSelection('進場狀態已失效，請重新選擇組別。');
    return;
  }
  if (closedEntryCheckSource === source || closedEntryRetrySource === source) return;
  const requestedStudentId = studentId;
  closedEntryCheckSource = source;
  try {
    const entry = await requestJson(`/api/student/entry?studentId=${encodeURIComponent(requestedStudentId)}`);
    if (source !== eventSource || studentId !== requestedStudentId) return;
    clearClosedEntryRetry(source);
    const next = getStoredEntryNextStep(storedStudentId, entry);
    if (next.screen === 'waiting') {
      showEntryResult(entry);
      return;
    }
    showSelection(next.message || '進場狀態已失效，請重新選擇組別。');
  } catch (error) {
    if (source !== eventSource || studentId !== requestedStudentId) return;
    if (error.code === 'STUDENT_NOT_ENTERED') {
      clearClosedEntryRetry(source);
      showSelection('進場狀態已失效，請重新選擇組別。');
    } else if (error instanceof TypeError || error?.name === 'AbortError' || error.status >= 500) {
      scheduleClosedEntryRetry(source, requestedStudentId);
    }
  } finally {
    if (closedEntryCheckSource === source) closedEntryCheckSource = null;
  }
}

setInterval(() => {
  reconnectBanner.hidden = !isReconnecting(lastEventAt);
}, 5_000);

refreshButton.addEventListener('click', () => loadGroups());
retryQuestionsButton.addEventListener('click', () => loadAnsweringData());
retryResultsButton.addEventListener('click', () => {
  resultsErrorMessage.hidden = true;
  retryResultsButton.hidden = true;
  loadStudentResults();
});
changeGroupButton.addEventListener('click', () => {
  if (phase !== '準備中') return;
  changingGroup = true;
  showSelection('請選擇新的組別。');
});

studentId = getStoredStudentId();
storedStudentId = Boolean(studentId);
ensureEventSource();
if (storedStudentId) restoreEntry();
else showSelection();
