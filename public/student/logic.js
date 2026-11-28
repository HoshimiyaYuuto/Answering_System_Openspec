import { createTranslator } from '../shared/i18n.js';
import { STUDENT_MESSAGES } from './messages.js';

// 產生文字的函式最後一個參數是翻譯函式 t，預設為繁中（add-student-language-switch design 第 3 節）
const ZH = createTranslator(STUDENT_MESSAGES, 'zh-TW');

// 老師重設活動後的說明；reset 事件與 activity_reset 原因共用（add-student-countdown-and-reset design 第 4 節）
export const RESET_MESSAGE = ZH('entry.reset');

const ENTRY_REASON_KEYS = {
  group_removed: 'entry.groupRemoved',
  entry_reset: 'entry.entryReset',
  activity_reset: 'entry.reset',
};

// 依 server 時間計算倒數剩餘時間，無條件進位到秒、不小於 0，格式為 m:ss（design 第 1 節）
export function formatRemaining(countdownEndsAt, serverNowMs) {
  const endsAt = Date.parse(countdownEndsAt);
  if (!Number.isFinite(endsAt) || !Number.isFinite(serverNowMs)) return '';
  const remaining = Math.max(0, Math.ceil((endsAt - serverNowMs) / 1000));
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
}

export function isReconnecting(lastEventAt, now = Date.now()) {
  return !Number.isFinite(lastEventAt) || now - lastEventAt > 40_000;
}

export function isStaleRequest(requestId, latestRequestId) {
  return requestId !== latestRequestId;
}

export function getEntryNextStep(response, t = ZH) {
  const entry = response?.data ?? response;
  if (entry?.valid === true) return { screen: 'waiting', entry };
  if (entry?.valid === false) {
    return {
      screen: 'select-group',
      reason: entry.reason,
      message: t(ENTRY_REASON_KEYS[entry.reason] ?? 'entry.invalid'),
    };
  }
  return { screen: 'select-group', reason: null, message: '' };
}

export function getStoredEntryNextStep(hasStoredStudentId, response, t = ZH) {
  if (!hasStoredStudentId) return { screen: 'select-group', message: '', shouldExplain: false };
  const next = getEntryNextStep(response, t);
  return { ...next, shouldExplain: next.screen === 'select-group' && Boolean(next.reason) };
}

// phase 是 API 的階段值（中文字串，契約值不翻譯），只翻譯顯示的說明
export function getPhaseDisplay(phase, t = ZH) {
  switch (phase) {
    case '準備中':
      return { message: t('phase.message.準備中'), canChangeGroup: true };
    case '搶答中':
      return { message: t('phase.message.搶答中'), canChangeGroup: false };
    case '已結束':
      return { message: t('phase.message.已結束'), canChangeGroup: false };
    default:
      return { message: '', canChangeGroup: false };
  }
}

export function getAnsweringScreen(entryValid, phase) {
  if (!entryValid) return 'select-group';
  if (phase === '準備中') return 'waiting';
  if (phase === '搶答中') return 'answering';
  if (phase === '已結束') return 'ended';
  return 'select-group';
}

export function getQuestionStatus(hasSubmission, hasDraft, isVoided = false) {
  if (hasSubmission) return 'submitted';
  if (isVoided) return 'voided';
  if (hasDraft) return 'draft';
  return 'unanswered';
}

export function validateAnswers(values, blanksCount) {
  if (!Array.isArray(values)) return { ok: false, errors: [{ index: 0, reason: 'not-array' }] };
  const errors = [];
  if (values.length !== blanksCount) errors.push({ index: null, reason: 'wrong-count' });
  const answers = values.map((value, index) => {
    if (typeof value !== 'string') {
      errors.push({ index, reason: 'not-string' });
      return value;
    }
    const trimmed = value.trim();
    const length = Array.from(trimmed).length;
    if (length < 1) errors.push({ index, reason: 'empty' });
    else if (length > 200) errors.push({ index, reason: 'too-long' });
    return trimmed;
  });
  return errors.length ? { ok: false, errors } : { ok: true, answers };
}

export function applySubmission(submissions, submission) {
  const current = Array.isArray(submissions) ? submissions : [];
  const index = current.findIndex((item) => item.questionId === submission.questionId);
  if (index === -1) return [...current, { ...submission, answers: [...submission.answers] }];
  const next = current.slice();
  next[index] = { ...submission, answers: [...submission.answers] };
  return next;
}

// a 的時間嚴格晚於 b；任一方不是有效時間時視為不晚（server 時間皆為 ISO 8601 UTC）
function isLater(a, b) {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && left > right;
}

// 同題保留較新的作答；時間相同或無法比較時保留本機的（add-student-void-notice design 第 2 節）
export function mergeSubmissions(current, snapshot) {
  const merged = new Map();
  for (const submission of Array.isArray(snapshot) ? snapshot : []) {
    merged.set(submission.questionId, { ...submission, answers: [...submission.answers] });
  }
  for (const submission of Array.isArray(current) ? current : []) {
    const fromSnapshot = merged.get(submission.questionId);
    if (fromSnapshot && isLater(fromSnapshot.submittedAt, submission.submittedAt)) continue;
    merged.set(submission.questionId, { ...submission, answers: [...submission.answers] });
  }
  return [...merged.values()];
}

// 依題號合併作廢紀錄，保留較晚的作廢時間
export function mergeVoided(current, snapshot) {
  const merged = new Map();
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(snapshot) ? snapshot : [])]) {
    const existing = merged.get(item.questionId);
    if (!existing || isLater(item.voidedAt, existing.voidedAt)) merged.set(item.questionId, { ...item });
  }
  return [...merged.values()];
}

// 同題同時有作答與作廢時：作答晚於作廢是重送，移除作廢；否則作答已被作廢，移除作答（design 第 1 節）
export function reconcileVoided(submissions, voided) {
  const currentSubmissions = Array.isArray(submissions) ? submissions : [];
  const currentVoided = Array.isArray(voided) ? voided : [];
  const voidedByQuestion = new Map(currentVoided.map((item) => [item.questionId, item]));
  const submissionByQuestion = new Map(currentSubmissions.map((item) => [item.questionId, item]));
  return {
    submissions: currentSubmissions
      .filter((item) => {
        const voidedItem = voidedByQuestion.get(item.questionId);
        return !voidedItem || isLater(item.submittedAt, voidedItem.voidedAt);
      })
      .map((item) => ({ ...item, answers: [...item.answers] })),
    voided: currentVoided
      .filter((item) => {
        const submission = submissionByQuestion.get(item.questionId);
        return !submission || !isLater(submission.submittedAt, item.voidedAt);
      })
      .map((item) => ({ ...item })),
  };
}

export function applyVoid(state, update) {
  return reconcileVoided(state?.submissions, mergeVoided(state?.voided, [update]));
}

export function getSubmitErrorNextStep(error) {
  const code = error?.code ?? error?.error?.code;
  if (code === 'ALREADY_SUBMITTED') return { action: 'refresh-submissions' };
  if (code === 'SUBMISSION_NOT_ALLOWED') return { action: 'refresh-session' };
  if (code === 'STUDENT_NOT_ENTERED') return { action: 'restore-entry' };
  if (code === 'QUESTION_NOT_FOUND') return { action: 'reload-questions' };
  if (code === 'INVALID_ANSWER') return { action: 'show-message' };
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.type === 'network') return { action: 'retry' };
  return { action: 'show-message' };
}

export function getEventErrorNextStep(readyState) {
  if (readyState === 2) return { action: 'restore-entry' };
  if (readyState === 0) return { action: 'wait' };
  return { action: 'wait' };
}

export function formatAnswers(blanks, answers, t = ZH) {
  const orderedBlanks = Array.isArray(blanks)
    ? blanks.map((blank, originalIndex) => ({ blank, originalIndex }))
      .sort((left, right) => left.blank.index - right.blank.index || left.originalIndex - right.originalIndex)
    : [];
  const values = Array.isArray(answers) ? answers : [];
  if (orderedBlanks.length === 1 && !orderedBlanks[0].blank.prefix) {
    const answer = values[0];
    return typeof answer === 'string' ? answer : '';
  }
  return orderedBlanks.map(({ blank }, index) => {
    const answer = values[index];
    return `${blank.prefix ?? ''}${typeof answer === 'string' ? answer : ''}`;
  }).join(t('results.answerSeparator'));
}

export const FAIR_RANKING_NOTICE = ZH('results.fairRankingNotice');
export const FAIR_RANKING_REJUDGED = ZH('results.fairRankingRejudged');

// 公平順位說明只認 true；欄位缺少或其他值都視為未啟用、未改判（add-student-fair-ranking-notice design 第 1 節）
export function buildResultsRows(results, t = ZH) {
  const questions = Array.isArray(results?.questions) ? results.questions : [];
  const orderedQuestions = [...questions].sort((left, right) => left.questionId - right.questionId);
  const rows = orderedQuestions.map((question) => {
    const winner = question?.winner ?? null;
    const own = question?.own ?? null;
    const isOwnWinner = own?.isWinner === true;
    return {
      questionId: question.questionId,
      label: t('results.questionLabel', { id: question.questionId }),
      winnerText: winner
        ? `${t('results.winner', { group: winner.groupName, answers: formatAnswers(question.blanks, winner.answers, t) })}${winner.byFairRanking === true ? t('results.fairRankingRejudged') : ''}`
        : t('results.noAnswer'),
      ownText: own
        ? t('results.own', {
          place: own.place,
          success: isOwnWinner ? t('results.ownSuccess') : '',
          answers: formatAnswers(question.blanks, own.answers, t),
        })
        : t('results.ownNone'),
      isOwnWinner,
    };
  });
  const ownWins = rows.filter(({ isOwnWinner }) => isOwnWinner).length;
  const total = rows.length;
  return {
    summary: { ownWins, total, text: t('results.summary', { wins: ownWins, total }) },
    fairRankingNotice: results?.fairRankingEnabled === true ? t('results.fairRankingNotice') : '',
    rows,
  };
}

export function getResultsLoadNextStep(status, t = ZH) {
  const message = t('results.loadFailed');
  if (status === 403) return { action: 'restore-entry', message };
  if (status === 409) return { action: 'refresh-session', message };
  return { action: 'show-message', message };
}
