const MIN_ANSWER_LENGTH = 1;
const MAX_ANSWER_LENGTH = 200;

export function createSubmissions({ now = () => new Date() } = {}) {
  const submissions = [];
  const validByQuestionAndGroup = new Map();
  const nextRankByQuestion = new Map();
  const listeners = new Set();
  const voidListeners = new Set();

  function questionGroupKey(questionId, groupId) {
    return JSON.stringify([questionId, groupId]);
  }

  function submit({ questionId, groupId, answers, blanksCount }) {
    if (!Array.isArray(answers) || answers.length !== blanksCount) {
      return { ok: false, code: 'INVALID_ANSWER' };
    }

    const normalizedAnswers = [];
    for (const answer of answers) {
      if (typeof answer !== 'string') return { ok: false, code: 'INVALID_ANSWER' };
      const trimmed = answer.trim();
      // 以 Unicode 字元（code point）計算，與學生頁的 Array.from 一致，emoji 等補充平面字元算 1 字
      const length = Array.from(trimmed).length;
      if (length < MIN_ANSWER_LENGTH || length > MAX_ANSWER_LENGTH) {
        return { ok: false, code: 'INVALID_ANSWER' };
      }
      normalizedAnswers.push(trimmed);
    }

    const key = questionGroupKey(questionId, groupId);
    if (validByQuestionAndGroup.has(key)) return { ok: false, code: 'ALREADY_SUBMITTED' };

    const rank = (nextRankByQuestion.get(questionId) ?? 0) + 1;
    const submission = {
      questionId,
      groupId,
      answers: normalizedAnswers,
      submittedAt: now().toISOString(),
      rank,
      status: 'valid',
      voidedAt: null,
    };
    nextRankByQuestion.set(questionId, rank);
    submissions.push(submission);
    validByQuestionAndGroup.set(key, submission);
    for (const listener of listeners) {
      try {
        listener({ ...submission, answers: [...submission.answers] });
      } catch {
        // A subscriber failure must not undo or hide a stored submission.
      }
    }
    return { ok: true, submission: { ...submission, answers: [...submission.answers] } };
  }

  // 作廢與查重表的更新在同一個同步區段完成，與同組重送不會交錯（design 第 3 節）
  function voidSubmission({ questionId, rank }) {
    const submission = submissions.find((item) => item.questionId === questionId && item.rank === rank);
    if (!submission) return { ok: false, code: 'SUBMISSION_NOT_FOUND' };
    if (submission.status !== 'valid') return { ok: false, code: 'ALREADY_VOIDED' };
    submission.status = 'voided';
    submission.voidedAt = now().toISOString();
    validByQuestionAndGroup.delete(questionGroupKey(questionId, submission.groupId));
    const snapshot = { ...submission, answers: [...submission.answers] };
    for (const listener of voidListeners) {
      try {
        listener({ ...snapshot, answers: [...snapshot.answers] });
      } catch {
        // A subscriber failure must not undo or hide a void.
      }
    }
    return { ok: true, submission: snapshot };
  }

  return {
    submit,
    voidSubmission,
    listSubmissions() {
      return submissions
        .slice()
        .sort((left, right) => left.questionId - right.questionId || left.rank - right.rank)
        .map((submission) => ({ ...submission, answers: [...submission.answers] }));
    },
    listByGroup(groupId) {
      return submissions
        .filter((submission) => submission.groupId === groupId && submission.status === 'valid')
        .slice()
        .sort((left, right) => left.questionId - right.questionId)
        .map((submission) => ({ ...submission, answers: [...submission.answers] }));
    },
    // 本組有作廢紀錄、但目前沒有有效作答的題目；同題作廢多次時取最後一次的作廢時間
    listVoidedPendingByGroup(groupId) {
      const latest = new Map();
      for (const submission of submissions) {
        if (submission.groupId !== groupId || submission.status !== 'voided') continue;
        if (validByQuestionAndGroup.has(questionGroupKey(submission.questionId, groupId))) continue;
        const previous = latest.get(submission.questionId);
        if (!previous || submission.voidedAt > previous) latest.set(submission.questionId, submission.voidedAt);
      }
      return [...latest.entries()]
        .sort(([left], [right]) => left - right)
        .map(([questionId, voidedAt]) => ({ questionId, voidedAt }));
    },
    subscribeVoid(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener 必須為函式。');
      voidListeners.add(listener);
      return () => voidListeners.delete(listener);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener 必須為函式。');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      submissions.length = 0;
      validByQuestionAndGroup.clear();
      nextRankByQuestion.clear();
    },
  };
}
