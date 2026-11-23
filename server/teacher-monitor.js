// 組出老師監看資料。名次與勝者一律取自 computeResults() 的結果，這裡只負責對應組名與答案。
// 純函式：所有資料由呼叫端傳入，不讀 session 或 HTTP。

function groupNameOf(groupsById, groupId) {
  return groupsById.get(groupId)?.name ?? `組 ${groupId}`;
}

export function buildMonitor({ phase, questions = [], groups = [], submissions = [], results = [] }) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const sortedGroups = [...groups].sort((left, right) => left.id - right.id);
  const resultsById = new Map(results.map((result) => [result.questionId, result]));

  const questionsOut = [...questions]
    .sort((left, right) => left.id - right.id)
    .map((question) => {
      const result = resultsById.get(question.id);
      const placeByRank = new Map((result?.placings ?? []).map(({ rank, place }) => [rank, place]));
      const records = submissions
        .filter((submission) => submission.questionId === question.id)
        .sort((left, right) => left.rank - right.rank);
      const entries = records.map((submission) => ({
        groupId: submission.groupId,
        groupName: groupNameOf(groupsById, submission.groupId),
        rank: submission.rank,
        status: submission.status,
        place: submission.status === 'valid' ? placeByRank.get(submission.rank) ?? null : null,
        answers: [...submission.answers],
        submittedAt: submission.submittedAt,
      }));
      const groupsWithRecords = new Set(records.map(({ groupId }) => groupId));
      const winnerRecord = result?.winner
        ? records.find((submission) => submission.rank === result.winner.rank)
        : null;

      return {
        id: question.id,
        prompt: question.prompt ?? '',
        settled: result?.settled ?? true,
        winner: winnerRecord
          ? {
            groupId: winnerRecord.groupId,
            groupName: groupNameOf(groupsById, winnerRecord.groupId),
            answers: [...winnerRecord.answers],
          }
          : null,
        winnerSource: winnerRecord ? result.winnerSource : null,
        submittedCount: records.filter(({ status }) => status === 'valid').length,
        entries,
        notSubmitted: sortedGroups
          .filter(({ id }) => !groupsWithRecords.has(id))
          .map(({ id, name }) => ({ groupId: id, groupName: name })),
      };
    });

  return { phase, groupCount: groups.length, questions: questionsOut };
}
