// 由作答紀錄推導每題的判定結果。格式見 docs/submission-record.md 第 2 節。
// 純函式：不讀 session、HTTP 或時鐘，所有輸入由呼叫端傳入。

export class ResultsComputationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const FAIR_BATCH_MS = 3000;

export function computeResults({
  questions = [],
  submissions = [],
  fairRankingEnabled = false,
  overrides = {},
  // now：判斷公平順位的 3 秒批次是否結束；省略時視為所有批次都已結束。
  now = Infinity,
} = {}) {
  if (overrides && Object.keys(overrides).length > 0) {
    throw new ResultsComputationError('OVERRIDE_NOT_SUPPORTED', '老師改選尚未支援。');
  }

  const validByQuestion = new Map(questions.map(({ id }) => [id, []]));
  for (const submission of submissions) {
    if (submission.status !== 'valid') continue;
    validByQuestion.get(submission.questionId)?.push(submission);
  }
  const byRank = (left, right) => left.rank - right.rank;
  const toPlacings = (list) => list.map(({ groupId, rank }, index) => ({ groupId, rank, place: index + 1 }));
  const empty = (questionId) => ({ questionId, settled: true, winner: null, winnerSource: null, placings: [] });
  const questionIds = [...validByQuestion.keys()].sort((left, right) => left - right);

  if (fairRankingEnabled !== true) {
    return questionIds.map((questionId) => {
      const placings = toPlacings(validByQuestion.get(questionId).slice().sort(byRank));
      const first = placings[0];
      if (!first) return empty(questionId);
      return {
        questionId,
        settled: true,
        winner: { groupId: first.groupId, rank: first.rank },
        winnerSource: 'arrival',
        placings,
      };
    });
  }

  // 公平順位：依每題第一個有效作答的送達時間決定判定順序，逐題累計成功題數。
  const pending = [];
  for (const questionId of questionIds) {
    const sorted = validByQuestion.get(questionId).slice().sort(byRank);
    if (sorted.length > 0) pending.push({ questionId, sorted, t0: Date.parse(sorted[0].submittedAt) });
  }
  pending.sort((left, right) => left.t0 - right.t0 || left.questionId - right.questionId);

  const wins = new Map();
  const judged = new Map();
  for (const { questionId, sorted, t0 } of pending) {
    const first = sorted[0];
    const closesAt = t0 + FAIR_BATCH_MS;
    if (now < closesAt) {
      judged.set(questionId, { questionId, settled: false, winner: null, winnerSource: null, placings: toPlacings(sorted) });
      continue;
    }
    const batch = [];
    const rest = [];
    for (const submission of sorted) {
      (Date.parse(submission.submittedAt) <= closesAt ? batch : rest).push(submission);
    }
    batch.sort((left, right) => (wins.get(left.groupId) ?? 0) - (wins.get(right.groupId) ?? 0) || left.rank - right.rank);
    const placings = toPlacings([...batch, ...rest]);
    const winner = placings[0];
    wins.set(winner.groupId, (wins.get(winner.groupId) ?? 0) + 1);
    judged.set(questionId, {
      questionId,
      settled: true,
      winner: { groupId: winner.groupId, rank: winner.rank },
      winnerSource: winner.rank === first.rank ? 'arrival' : 'fair',
      placings,
    });
  }
  return questionIds.map((questionId) => judged.get(questionId) ?? empty(questionId));
}
