const ENTRY_REASON_MESSAGES = {
  group_removed: '你原本的組別已被老師移除，請重新選擇組別',
  entry_reset: '進場狀態已失效（例如伺服器重新啟動），請重新選擇組別',
};

export function isReconnecting(lastEventAt, now = Date.now()) {
  return !Number.isFinite(lastEventAt) || now - lastEventAt > 40_000;
}

export function isStaleRequest(requestId, latestRequestId) {
  return requestId !== latestRequestId;
}

export function getEntryNextStep(response) {
  const entry = response?.data ?? response;
  if (entry?.valid === true) return { screen: 'waiting', entry };
  if (entry?.valid === false) {
    return {
      screen: 'select-group',
      reason: entry.reason,
      message: ENTRY_REASON_MESSAGES[entry.reason] ?? '進場狀態無效，請重新選擇組別。',
    };
  }
  return { screen: 'select-group', reason: null, message: '' };
}

export function getStoredEntryNextStep(hasStoredStudentId, response) {
  if (!hasStoredStudentId) return { screen: 'select-group', message: '', shouldExplain: false };
  const next = getEntryNextStep(response);
  return { ...next, shouldExplain: next.screen === 'select-group' && Boolean(next.reason) };
}

export function getPhaseDisplay(phase) {
  switch (phase) {
    case '準備中':
      return { message: '請稍候，老師開始活動後再繼續。', canChangeGroup: true };
    case '搶答中':
      return { message: '搶答已開始，請作答', canChangeGroup: false };
    case '已結束':
      return { message: '活動已結束', canChangeGroup: false };
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

export function getQuestionStatus(hasSubmission, hasDraft) {
  if (hasSubmission) return 'submitted';
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

export function mergeSubmissions(current, snapshot) {
  const merged = new Map();
  for (const submission of Array.isArray(snapshot) ? snapshot : []) {
    merged.set(submission.questionId, { ...submission, answers: [...submission.answers] });
  }
  for (const submission of Array.isArray(current) ? current : []) {
    merged.set(submission.questionId, { ...submission, answers: [...submission.answers] });
  }
  return [...merged.values()];
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

export function formatAnswers(blanks, answers) {
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
  }).join('；');
}

export function buildResultsRows(results) {
  const questions = Array.isArray(results?.questions) ? results.questions : [];
  const orderedQuestions = [...questions].sort((left, right) => left.questionId - right.questionId);
  const rows = orderedQuestions.map((question) => {
    const winner = question?.winner ?? null;
    const own = question?.own ?? null;
    const isOwnWinner = own?.isWinner === true;
    return {
      questionId: question.questionId,
      label: `第 ${question.questionId} 題`,
      winnerText: winner
        ? `${winner.groupName}：${formatAnswers(question.blanks, winner.answers)}`
        : '無人作答',
      ownText: own
        ? `本組第 ${own.place} 名${isOwnWinner ? '（成功）' : ''}：${formatAnswers(question.blanks, own.answers)}`
        : '本組未作答',
      isOwnWinner,
    };
  });
  const ownWins = rows.filter(({ isOwnWinner }) => isOwnWinner).length;
  const total = rows.length;
  return {
    summary: { ownWins, total, text: `本組成功 ${ownWins} 題／共 ${total} 題` },
    rows,
  };
}

export function getResultsLoadNextStep(status) {
  if (status === 403) return { action: 'restore-entry', message: '無法載入結果，請稍後再試' };
  if (status === 409) return { action: 'refresh-session', message: '無法載入結果，請稍後再試' };
  return { action: 'show-message', message: '無法載入結果，請稍後再試' };
}
