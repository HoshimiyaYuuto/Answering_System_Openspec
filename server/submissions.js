const MIN_ANSWER_LENGTH = 1;
const MAX_ANSWER_LENGTH = 200;

export function createSubmissions({ now = () => new Date() } = {}) {
  const submissions = [];
  const validByQuestionAndGroup = new Map();
  const nextRankByQuestion = new Map();
  const listeners = new Set();

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

  return {
    submit,
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
