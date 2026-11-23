import { computeResults } from './results.js';

function publicBlanks(blanks = []) {
  return blanks.map(({ index, prefix, prompt }) => ({ index, prefix, prompt }));
}

export function buildStudentResults({ questions = [], submissions = [], groups = [], groupId } = {}) {
  const computed = computeResults({ questions, submissions });
  const groupsById = new Map(groups.map(({ id, name }) => [id, name]));
  const submissionsByQuestion = new Map();

  for (const submission of submissions) {
    if (submission.status !== 'valid') continue;
    const questionSubmissions = submissionsByQuestion.get(submission.questionId) ?? [];
    questionSubmissions.push(submission);
    submissionsByQuestion.set(submission.questionId, questionSubmissions);
  }

  return {
    questions: [...questions]
      .sort((left, right) => left.id - right.id)
      .map((question) => {
        const result = computed.find(({ questionId }) => questionId === question.id);
        const validSubmissions = submissionsByQuestion.get(question.id) ?? [];
        const winningSubmission = result?.winner
          ? validSubmissions.find(({ rank }) => rank === result.winner.rank)
          : null;
        const ownPlacing = result?.placings.find((placing) => placing.groupId === groupId);
        const ownSubmission = ownPlacing
          ? validSubmissions.find((submission) => submission.groupId === groupId)
          : null;

        return {
          questionId: question.id,
          blanks: publicBlanks(question.blanks),
          winner: winningSubmission
            ? {
              groupName: groupsById.get(winningSubmission.groupId) ?? '（已移除的組別）',
              answers: [...winningSubmission.answers],
            }
            : null,
          own: ownPlacing && ownSubmission
            ? {
              place: ownPlacing.place,
              isWinner: ownPlacing.place === 1,
              answers: [...ownSubmission.answers],
            }
            : null,
        };
      }),
  };
}
