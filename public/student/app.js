import { applySubmission, buildResultsRows, getAnsweringScreen, getEntryNextStep, getEventErrorNextStep, getPhaseDisplay, getQuestionStatus, getResultsLoadNextStep, getStoredEntryNextStep, isPhaseSnapshotCurrent, isReconnecting, isStaleRequest, mergeSubmissions, resolveResponsePhase, mergeVoided, reconcileVoided, applyVoid, validateAnswers, formatRemaining } from './logic.js';
import { createDraftStore } from './drafts.js';
import {
  applyDocumentLanguage,
  applyStaticText,
  createTranslator,
  detectLanguage,
  mountLanguageSwitch,
  readStoredLanguage,
  storeLanguage,
  translateError,
  watchLanguage,
} from '../shared/i18n.js';
import { STUDENT_MESSAGES } from './messages.js';

// 介面語言（add-student-language-switch design 第 4、5 節）：啟動時決定語言；
// 切換時先存草稿再重新載入，走既有的「重新整理後還原」流程
const language = detectLanguage(readStoredLanguage(), navigator.languages);
const t = createTranslator(STUDENT_MESSAGES, language);
applyDocumentLanguage(language, t('page.title'));
applyStaticText(document, t);

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
const resultsFairRanking = document.querySelector('#results-fair-ranking');
const resultsList = document.querySelector('#results-list');
const resultsLoadingMessage = document.querySelector('#results-loading');
const resultsErrorMessage = document.querySelector('#results-error');
const retryResultsButton = document.querySelector('#results-retry');
const countdownDisplay = document.querySelector('#countdown');

let draftStorage;
try {
  draftStorage = localStorage;
} catch {
  draftStorage = undefined;
}
const drafts = createDraftStore(draftStorage);
drafts.setActivityId(null);

function reloadWithLanguage(next, { store = true } = {}) {
  if (next === language) return;
  if (store) storeLanguage(next);
  saveCurrentDraft();
  window.location.reload();
}

mountLanguageSwitch(document.querySelector('#language-switch'), {
  language,
  label: t('language.label'),
  onChange: (next) => reloadWithLanguage(next),
});
watchLanguage((next) => reloadWithLanguage(next, { store: false }));

const reconnectBanner = document.createElement('p');
reconnectBanner.textContent = t('common.reconnecting');
reconnectBanner.setAttribute('role', 'status');
reconnectBanner.setAttribute('aria-live', 'polite');
reconnectBanner.hidden = true;
document.querySelector('main').prepend(reconnectBanner);

const changeGroupButton = document.createElement('button');
changeGroupButton.type = 'button';
changeGroupButton.textContent = t('waiting.changeGroup');
waiting.append(changeGroupButton);

let studentId;
let storedStudentId = false;
let phase = '準備中';
// 每收到一次 phase 事件就加一；請求送出時記下版本，回應抵達時版本已變表示回應中的階段較舊。
let phaseVersion = 0;
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
// 本組已被老師作廢且尚未重送的題目 [{ questionId, voidedAt }]（add-student-void-notice）
let loadedVoided = [];
// 倒數以 server 時間計算：記下 server 與本機時鐘的差（add-student-countdown-and-reset design 第 2 節）
let countdownEndsAt = null;
let clockOffset = 0;
let countdownTimer = null;
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
    const error = new Error(translateError(t, body?.error?.code, body?.error?.message || t('error.generic')));
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
  loadedVoided = [];
  currentEntry = null;
  ensureEventSource();
  waiting.hidden = true;
  answering.hidden = true;
  ended.hidden = true;
  selection.hidden = false;
  loadGroups(message);
}

function updateWaitingView() {
  const display = getPhaseDisplay(phase, t);
  phaseText.textContent = t('waiting.phaseLine', { phase: t(`phase.${phase}`), message: display.message });
  changeGroupButton.hidden = !display.canChangeGroup;
}

function showEntryResult(response, requestPhaseVersion = phaseVersion) {
  const next = getEntryNextStep(response, t);
  if (next.screen === 'waiting') {
    clearClosedEntryRetry();
    if (currentEntry?.group?.id !== next.entry.group.id) {
      answeringRequestId += 1;
      synchronizationRequestId += 1;
      submissionsSnapshotRequestId += 1;
      loadedSubmissions = [];
      loadedVoided = [];
    }
    currentEntry = next.entry;
    groupName.textContent = next.entry.group.name;
    phase = resolveResponsePhase({
      responsePhase: next.entry.phase,
      currentPhase: phase,
      requestPhaseVersion,
      currentPhaseVersion: phaseVersion,
    });
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
  renderCountdown();
}

function recordServerTime(data) {
  if (!data || typeof data !== 'object') return;
  const serverTime = Date.parse(data.serverTime);
  if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
  if ('countdownEndsAt' in data) countdownEndsAt = typeof data.countdownEndsAt === 'string' ? data.countdownEndsAt : null;
  renderCountdown();
}

function renderCountdown() {
  const running = !answering.hidden && phase === '搶答中' && countdownEndsAt !== null;
  countdownDisplay.hidden = !running;
  countdownDisplay.textContent = running ? t('countdown.remaining', { time: formatRemaining(countdownEndsAt, Date.now() + clockOffset) }) : '';
  if (running && countdownTimer === null) countdownTimer = setInterval(renderCountdown, 1000);
  if (!running && countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
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
  resultsFairRanking.textContent = '';
  resultsFairRanking.hidden = true;
  resultsList.replaceChildren();
  resultsList.hidden = true;
  resultsLoadingMessage.hidden = true;
  resultsErrorMessage.textContent = '';
  resultsErrorMessage.hidden = true;
  retryResultsButton.hidden = true;
}

function renderStudentResults(results) {
  const view = buildResultsRows(results, t);
  resultsSummary.textContent = view.summary.text;
  resultsSummary.hidden = false;
  resultsFairRanking.textContent = view.fairRankingNotice;
  resultsFairRanking.hidden = view.fairRankingNotice === '';
  resultsList.replaceChildren();
  for (const row of view.rows) {
    const item = document.createElement('li');
    item.textContent = t('results.row', { label: row.label, winner: row.winnerText, own: row.ownText });
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
      const error = new Error(translateError(t, body?.error?.code, body?.error?.message || t('error.generic')));
      error.status = response.status;
      error.code = body?.error?.code;
      throw error;
    }
    if (!Array.isArray(body?.data?.questions)) throw new Error(t('error.badResponse'));
    if (isStaleRequest(requestId, resultsRequestId)) return;
    renderStudentResults({ questions: body.data.questions, fairRankingEnabled: body.data.fairRankingEnabled });
  } catch (error) {
    if (isStaleRequest(requestId, resultsRequestId)) return;
    const next = getResultsLoadNextStep(Number.isInteger(error.status) ? error.status : null, t);
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
    const questionStatus = getQuestionStatus(hasSubmission, hasDraft, isVoidedQuestion(question.id));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('grid.button', { id: question.id, status: t(`grid.status.${questionStatus}`) });
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
  title.textContent = t('question.title', { id: question.id });
  questionPage.append(title);

  const message = document.createElement('p');
  message.className = 'message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const voidedNotice = !locked && isVoidedQuestion(question.id) ? t('question.voidedNotice') : '';
  message.textContent = options.message || (locked ? t('question.submitted') : voidedNotice);
  questionPage.append(message);
  const validationMessages = [];

  blanks.forEach((blank, index) => {
    const blankLabel = [blank.prefix, blank.prompt].filter(Boolean).join(' ') || t('question.blankLabel', { id: question.id, n: index + 1 });
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
          ? t('validation.tooLong')
          : error.reason === 'empty'
            ? t('validation.empty')
            : t('validation.invalid');
      } else if (error.reason === 'wrong-count') {
        message.textContent = t('validation.allBlanks');
      }
    }
  }

  if (!locked) {
    questionSubmitButton = document.createElement('button');
    questionSubmitButton.type = 'button';
    questionSubmitButton.textContent = isSubmitting ? t('question.submitting') : t('question.submit');
    questionSubmitButton.disabled = isSubmitting;
    questionSubmitButton.addEventListener('click', submitCurrentQuestion);
    questionPage.append(questionSubmitButton);
  }

  questionBackButton = document.createElement('button');
  questionBackButton.type = 'button';
  questionBackButton.className = 'secondary';
  questionBackButton.textContent = t('question.back');
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
  applyGroupSnapshot(response?.data);
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

// 快照合併：作答保留較新的，作廢保留較晚的，再依時間決定同題誰有效（design 第 1、3 節）
function applyGroupSnapshot(data) {
  const submissions = projectSubmissions(data?.submissions);
  const voided = projectVoided(data?.voided);
  const next = reconcileVoided(mergeSubmissions(loadedSubmissions, submissions), mergeVoided(loadedVoided, voided));
  loadedSubmissions = next.submissions;
  loadedVoided = next.voided;
}

// 舊版 server 沒有 voided 欄位時視為空陣列
function projectVoided(voided) {
  if (voided === undefined) return [];
  if (!Array.isArray(voided)) throw new Error(t('error.badResponse'));
  return voided.map((item) => {
    if (!item || typeof item !== 'object' || !isValidQuestionId(item.questionId) || typeof item.voidedAt !== 'string') {
      throw new Error(t('error.badResponse'));
    }
    return { questionId: item.questionId, voidedAt: item.voidedAt };
  });
}

function questionLockState(questionId) {
  const submission = loadedSubmissions.find((item) => item.questionId === questionId);
  if (submission) return `submitted:${submission.submittedAt}`;
  return isVoidedQuestion(questionId) ? 'voided' : 'open';
}

function isVoidedQuestion(questionId) {
  return loadedVoided.some((item) => item.questionId === questionId);
}

function projectSubmissions(submissions) {
  if (!Array.isArray(submissions)) throw new Error(t('error.badResponse'));
  return submissions.map((submission) => {
    if (!submission || typeof submission !== 'object'
      || !isValidQuestionId(submission.questionId)
      || !Array.isArray(submission.answers)
      || !submission.answers.every((answer) => typeof answer === 'string')
      || typeof submission.submittedAt !== 'string') {
      throw new Error(t('error.badResponse'));
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

  // 等待回應期間活動可能結束（activeQuestionId 會被清成 null），之後一律用送出當下的題號
  const questionId = activeQuestionId;
  isSubmitting = true;
  setQuestionControlsDisabled(true);
  if (questionSubmitButton) questionSubmitButton.textContent = t('question.submitting');
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
      body: JSON.stringify({ studentId, questionId, answers: result.answers }),
      signal: controller.signal,
    });
    const data = response?.data ?? {};
    loadedSubmissions = applySubmission(loadedSubmissions, {
      questionId,
      answers: result.answers,
      submittedAt: data.submittedAt,
    });
    clearResolvedVoids();
    drafts.remove(studentId, questionId);
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    if (answeringView === 'question' && activeQuestionId === questionId) renderQuestionPage(question);
  } catch (caught) {
    const error = timedOut
      ? Object.assign(new Error(t('error.noResponse')), { name: 'AbortError' })
      : caught;
    if (error instanceof TypeError && !error.code) error.type = 'network';
    const next = getSubmitErrorNextStep(error);
    if (next.action === 'refresh-submissions') {
      try {
        const submissions = await refreshSubmissions();
        const matching = submissions.find((item) => item.questionId === questionId);
        if (matching) {
          drafts.remove(studentId, questionId);
          if (answeringView === 'question' && activeQuestionId === questionId) {
            renderQuestionPage(question, { message: t('question.submittedElsewhere') });
          }
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
        recordServerTime(session.data);
        if (phase === '已結束') showPhaseScreen();
        else messageForCurrentQuestion(error.message);
      } catch (refreshError) {
        messageForCurrentQuestion(refreshError.message);
      }
    } else if (next.action === 'restore-entry') {
      saveCurrentDraft();
      showSelection(t('entry.expired'));
    } else if (next.action === 'reload-questions') {
      saveCurrentDraft();
      await loadAnsweringData();
      messageForCurrentQuestion(error.message);
    } else if (next.action === 'retry') {
      messageForCurrentQuestion(t('error.noResponse'));
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
      if (questionSubmitButton && !isLocked) questionSubmitButton.textContent = t('question.submit');
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
  answeringMessage.textContent = t('answering.loading');
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
    // 先檢查格式，格式錯誤時不改任何狀態
    projectSubmissions(submissionsResponse?.data?.submissions);
    projectVoided(submissionsResponse?.data?.voided);
    if (!Array.isArray(questions)) throw new Error(t('error.badResponse'));
    updateActivityId(sessionResponse?.data);
    recordServerTime(sessionResponse?.data);
    loadedQuestions = questions;
    if (!isStaleRequest(snapshotRequestId, submissionsSnapshotRequestId)) {
      applyGroupSnapshot(submissionsResponse?.data);
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
      showSelection(t('entry.expired'));
      return;
    }
    answeringMessage.textContent = t('answering.loadFailed');
    answeringMessage.hidden = false;
    retryQuestionsButton.hidden = false;
  }
}

async function loadGroups(message = '') {
  const requestId = ++groupsRequestId;
  status.textContent = t('selection.loading');
  groupList.replaceChildren();
  refreshButton.hidden = true;
  try {
    const { data } = await requestJson('/api/groups');
    if (isStaleRequest(requestId, groupsRequestId)) return;
    if (!data.groups.length) {
      status.textContent = t('selection.noGroups');
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
  const requestPhaseVersion = phaseVersion;
  try {
    const entry = await requestJson(`/api/student/entry?studentId=${encodeURIComponent(studentId)}`);
    const next = getStoredEntryNextStep(storedStudentId, entry, t);
    if (next.screen === 'waiting') showEntryResult(entry, requestPhaseVersion);
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
  const requestPhaseVersion = phaseVersion;
  try {
    const response = await requestJson('/api/student/entry', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: pendingStudentId, groupId }),
    });
    if (isNewStudent) persistStudentId(pendingStudentId);
    showEntryResult(response, requestPhaseVersion);
  } catch (error) {
    if (error.code === 'GROUP_NOT_FOUND') await loadGroups(t('selection.groupGone'));
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
  const requestPhaseVersion = phaseVersion;
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
      // 等待期間若已收到較新的 phase 事件，這份 session 摘要的階段與 activityId 已過期，不予套用。
      const sessionPhaseCurrent = isPhaseSnapshotCurrent(requestPhaseVersion, phaseVersion);
      if (sessionPhaseCurrent) updateActivityId(session?.data);
      const nextPhase = resolveResponsePhase({
        responsePhase: session?.data?.phase,
        currentPhase: phase,
        requestPhaseVersion,
        currentPhaseVersion: phaseVersion,
      });
      const phaseChanged = phase !== nextPhase;
      recordServerTime(session?.data);
      if (phaseChanged && nextPhase === '已結束' && answeringView === 'question') saveCurrentDraft();
      phase = nextPhase;
      const before = activeQuestionId !== null ? questionLockState(activeQuestionId) : null;
      if (!isStaleRequest(submissionsRequestId, submissionsSnapshotRequestId)) {
        applyGroupSnapshot(submissionsResponse?.data);
      }
      renderQuestionGrid(loadedQuestions, loadedSubmissions);
      if (answeringView === 'question' && activeQuestionId !== null) {
        const question = loadedQuestions.find((item) => item.id === activeQuestionId);
        // 鎖定或作廢狀態有變化時才重繪，避免打斷正在輸入的學生
        if (question && questionLockState(activeQuestionId) !== before) renderQuestionPage(question);
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
    throw new Error(t('error.badResponse'));
  }
  if (sessionData?.phase === '搶答中' && nextActivityId === null) {
    throw new Error(t('error.badResponse'));
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
    phaseVersion += 1;
    phase = update.phase;
    recordServerTime(update);
    if (currentEntry?.valid) showPhaseScreen();
  } catch {
    // Ignore malformed event data; the next session snapshot will resynchronize.
  }
}

function handleHeartbeat(event) {
  lastEventAt = Date.now();
  reconnectBanner.hidden = true;
  // heartbeat 只帶 serverTime：只更新時鐘差，不改倒數結束時間
  try {
    const update = typeof event?.data === 'string' ? JSON.parse(event.data) : null;
    if (update && typeof update === 'object' && !Array.isArray(update)) recordServerTime({ serverTime: update.serverTime });
  } catch {
    // Ignore malformed heartbeat data.
  }
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
    clearResolvedVoids();
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

// 重送後作答晚於作廢，作廢提示就會被移除
function clearResolvedVoids() {
  const next = reconcileVoided(loadedSubmissions, loadedVoided);
  loadedSubmissions = next.submissions;
  loadedVoided = next.voided;
}

// 本組某題被老師作廢：解鎖並提示可重送（add-student-void-notice design 第 3 節）
function handleVoid(event) {
  try {
    if (typeof event.data !== 'string') return;
    const update = JSON.parse(event.data);
    if (!update || typeof update !== 'object' || Array.isArray(update)) return;
    if (!currentEntry?.valid || !studentId || !isValidQuestionId(update.questionId) || typeof update.voidedAt !== 'string') return;
    lastEventAt = Date.now();
    reconnectBanner.hidden = true;
    const next = applyVoid({ submissions: loadedSubmissions, voided: loadedVoided }, { questionId: update.questionId, voidedAt: update.voidedAt });
    loadedSubmissions = next.submissions;
    loadedVoided = next.voided;
    renderQuestionGrid(loadedQuestions, loadedSubmissions);
    if (answeringView === 'question' && activeQuestionId === update.questionId) {
      const question = loadedQuestions.find((item) => item.id === update.questionId);
      if (question) renderQuestionPage(question);
    }
  } catch {
    // Ignore malformed event data; a later synchronization will reload the group's state.
  }
}

// 老師重設活動：回選組頁並說明；上一場的草稿不再儲存（add-student-countdown-and-reset design 第 3 節）
function handleReset() {
  if (!currentEntry?.valid) return;
  lastEventAt = Date.now();
  reconnectBanner.hidden = true;
  countdownEndsAt = null;
  activeQuestionId = null;
  answeringView = 'grid';
  showSelection(t('entry.reset'));
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
  source.addEventListener('void', handleVoid);
  source.addEventListener('reset', handleReset);
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
    showSelection(t('entry.expired'));
    return;
  }
  if (closedEntryCheckSource === source || closedEntryRetrySource === source) return;
  const requestedStudentId = studentId;
  const requestPhaseVersion = phaseVersion;
  closedEntryCheckSource = source;
  try {
    const entry = await requestJson(`/api/student/entry?studentId=${encodeURIComponent(requestedStudentId)}`);
    if (source !== eventSource || studentId !== requestedStudentId) return;
    clearClosedEntryRetry(source);
    const next = getStoredEntryNextStep(storedStudentId, entry, t);
    if (next.screen === 'waiting') {
      showEntryResult(entry, requestPhaseVersion);
      return;
    }
    showSelection(next.message || t('entry.expired'));
  } catch (error) {
    if (source !== eventSource || studentId !== requestedStudentId) return;
    if (error.code === 'STUDENT_NOT_ENTERED') {
      clearClosedEntryRetry(source);
      showSelection(t('entry.expired'));
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
  showSelection(t('selection.chooseNew'));
});

studentId = getStoredStudentId();
storedStudentId = Boolean(studentId);
ensureEventSource();
if (storedStudentId) restoreEntry();
else showSelection();
