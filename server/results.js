// 由作答紀錄推導每題的判定結果。格式見 docs/submission-record.md 第 2 節。
// 純函式：不讀 session、HTTP 或時鐘，所有輸入由呼叫端傳入。

export class ResultsComputationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function computeResults({
  questions = [],
  submissions = [],
  fairRankingEnabled = false,
  overrides = {},
  // now：公平順位判斷 3 秒批次用，第一版不讀取。
} = {}) {
  if (fairRankingEnabled === true) {
    throw new ResultsComputationError('FAIR_RANKING_NOT_SUPPORTED', '公平順位尚未支援。');
  }
  if (overrides && Object.keys(overrides).length > 0) {
    throw new ResultsComputationError('OVERRIDE_NOT_SUPPORTED', '老師改選尚未支援。');
  }

  const validByQuestion = new Map(questions.map(({ id }) => [id, []]));
  for (const submission of submissions) {
    if (submission.status !== 'valid') continue;
    validByQuestion.get(submission.questionId)?.push(submission);
  }

  return [...validByQuestion.keys()]
    .sort((left, right) => left - right)
    .map((questionId) => {
      const placings = validByQuestion
        .get(questionId)
        .slice()
        .sort((left, right) => left.rank - right.rank)
        .map(({ groupId, rank }, index) => ({ groupId, rank, place: index + 1 }));
      const first = placings[0];
      return {
        questionId,
        settled: true,
        winner: first ? { groupId: first.groupId, rank: first.rank } : null,
        winnerSource: first ? 'arrival' : null,
        placings,
      };
    });
}
