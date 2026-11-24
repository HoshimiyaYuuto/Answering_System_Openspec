import assert from 'node:assert/strict';
import { createApplication } from './index.js';
import { createSubmissions } from './submissions.js';

const submissions = createSubmissions();
const server = createApplication({ environment: 'development', submissions }).listen(0, '127.0.0.1');
const clients = [];

async function assertStatus(response, expected, context) {
  if (response.status === expected) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(`${context}: expected HTTP ${expected}, got ${response.status}; code=${body.error?.code ?? 'unknown'}; body=${JSON.stringify(body)}`);
}

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const summary = (await fetch(`${baseUrl}/api/session`)).json();
  const { questionCount } = (await summary).data;
  assert.ok(questionCount >= 50, `expected at least 50 seeded questions, got ${questionCount}`);

  const connectClient = async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const nextBlock = async (timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          return block;
        }
        let timeout;
        const next = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('timed out waiting for SSE data')), deadline - Date.now());
          }),
        ]).finally(() => clearTimeout(timeout));
        if (next.done) throw new Error('SSE connection closed before phase event');
        buffer += decoder.decode(next.value, { stream: true });
      }
      throw new Error('timed out waiting for SSE event');
    };

    const client = { controller, reader, nextBlock };
    clients.push(client);
    assert.equal(await nextBlock(), 'retry: 3000');
    return client;
  };

  const connectedClients = await Promise.all(Array.from({ length: 100 }, connectClient));
  const emittedAt = Date.now();
  const phaseResponse = await fetch(`${baseUrl}/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD`, { method: 'POST' });
  assert.equal(phaseResponse.status, 200);

  const latencies = await Promise.all(connectedClients.map(async (client, index) => {
    const event = await client.nextBlock(2_000);
    const latencyMs = Date.now() - emittedAt;
    assert.match(event, /^event: phase\ndata: \{"phase":"搶答中","serverTime":"[^"\n]+"\}$/);
    return { client: index + 1, latencyMs };
  }));

  const maxLatency = Math.max(...latencies.map(({ latencyMs }) => latencyMs));
  console.log(JSON.stringify({ clients: latencies.length, questionCount, maxLatencyMs: maxLatency, allWithin2Seconds: maxLatency < 2_000 }));
  assert.equal(latencies.length, 100);
  assert.ok(maxLatency < 2_000, `all 100 clients must receive phase event within 2 seconds; max was ${maxLatency}ms`);

  const students = Array.from({ length: 100 }, (_, index) => ({ studentId: `load-student-${String(index + 1).padStart(3, '0')}`, groupId: index + 1 }));
  const entries = await Promise.all(students.map(({ studentId, groupId }) => fetch(`${baseUrl}/api/student/entry`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId, groupId }),
  })));
  for (let index = 0; index < entries.length; index += 1) await assertStatus(entries[index], 200, `student entry ${students[index].studentId}`);

  const questionResponse = await fetch(`${baseUrl}/api/student/questions?studentId=${students[0].studentId}`);
  await assertStatus(questionResponse, 200, 'get student questions');
  const { questions } = (await questionResponse.json()).data;
  assert.equal(questions.length, 50, `expected 50 questions, got ${questions.length}`);
  for (const question of questions) assert.ok(Array.isArray(question.blanks), `question ${question.id} has no blanks array`);

  const expectedRanks = Array.from({ length: 100 }, (_, index) => index + 1);
  const submittedAnswers = new Map();
  const totalStartedAt = Date.now();
  let slowestQuestionMs = 0;
  let submissionCount = 0;
  for (const question of questions) {
    const questionStartedAt = Date.now();
    const responses = await Promise.all(students.map(({ studentId, groupId }) => {
      const answers = Array.from({ length: question.blanks.length }, (_, index) => `answer-${question.id}-${groupId}-${index + 1}`);
      submittedAnswers.set(`${groupId}:${question.id}`, answers);
      return fetch(`${baseUrl}/api/student/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId, questionId: question.id, answers }),
      });
    }));
    for (let index = 0; index < responses.length; index += 1) {
      await assertStatus(responses[index], 200, `submission question ${question.id}, group ${index + 1}`);
    }
    submissionCount += responses.length;
    slowestQuestionMs = Math.max(slowestQuestionMs, Date.now() - questionStartedAt);
  }
  const totalMs = Date.now() - totalStartedAt;

  const stored = submissions.listSubmissions();
  assert.equal(submissionCount, 5_000);
  assert.equal(stored.length, 5_000, `expected 5000 stored submissions, got ${stored.length}`);
  for (const question of questions) {
    const rows = stored.filter((submission) => submission.questionId === question.id);
    assert.equal(rows.length, 100, `question ${question.id}: expected 100 rows, got ${rows.length}`);
    assert.deepEqual(rows.map(({ rank }) => rank).sort((left, right) => left - right), expectedRanks, `question ${question.id} ranks`);
    assert.equal(new Set(rows.map(({ groupId }) => groupId)).size, 100, `question ${question.id} groups must be unique`);
    assert.ok(rows.every(({ status }) => status === 'valid'), `question ${question.id} contains non-valid submission`);
  }

  const duplicateResponse = await fetch(`${baseUrl}/api/student/submissions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: students[0].studentId, questionId: 1, answers: ['answer-1-1'] }),
  });
  await assertStatus(duplicateResponse, 409, 'duplicate submission');
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateBody.error?.code, 'ALREADY_SUBMITTED', `duplicate submission returned ${JSON.stringify(duplicateBody)}`);

  const endedResponse = await fetch(`${baseUrl}/api/dev/phase/${encodeURIComponent('已結束')}`, { method: 'POST' });
  await assertStatus(endedResponse, 200, 'set phase to ended');

  const groupsResponse = await fetch(`${baseUrl}/api/groups`);
  await assertStatus(groupsResponse, 200, 'get groups');
  const { groups } = (await groupsResponse.json()).data;
  const groupNames = new Map(groups.map(({ id, name }) => [id, name]));

  {
    const resultsStartedAt = Date.now();
    const timedResults = await Promise.all(students.map(async ({ studentId }) => {
      const response = await fetch(`${baseUrl}/api/student/results?studentId=${encodeURIComponent(studentId)}`);
      const statusResponse = response.clone();
      const bodyText = await response.text();
      // totalMs is the wall-clock duration for all 100 requests through body consumption.
      // Each request's elapsedMs runs from the common start until its response body is consumed.
      return { studentId, statusResponse, bodyText, elapsedMs: Date.now() - resultsStartedAt };
    }));
    const totalMs = Date.now() - resultsStartedAt;
    const slowestMs = Math.max(...timedResults.map(({ elapsedMs }) => elapsedMs));
    const rankOneByQuestion = new Map(questions.map((question) => [
      question.id,
      stored.find((row) => row.questionId === question.id && row.rank === 1),
    ]));
    const winnersByQuestion = new Map();

    for (const result of timedResults) {
      const student = students.find(({ studentId }) => studentId === result.studentId);
      const context = `student ${result.studentId}`;
      await assertStatus(result.statusResponse, 200, `get results ${context}, questions 1-50`);
      for (const forbidden of ['"rank"', '"groupId"', '"placings"', '"settled"', '"winnerSource"']) {
        assert.equal(result.bodyText.includes(forbidden), false, `${context}, questions 1-50: response contains ${forbidden}`);
      }

      let resultQuestions;
      try {
        resultQuestions = JSON.parse(result.bodyText).data.questions;
      } catch (error) {
        throw new Error(`${context}, questions 1-50: invalid results JSON: ${error.message}`);
      }
      assert.ok(Array.isArray(resultQuestions), `${context}, question 50: questions is not an array`);
      assert.equal(resultQuestions.length, 50, `${context}, question 50: expected 50 questions, got ${resultQuestions.length}`);

      for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
        const question = questions[questionIndex];
        const resultQuestion = resultQuestions[questionIndex];
        const questionContext = `${context}, question ${question.id}`;
        assert.equal(resultQuestion.questionId, question.id, `${questionContext}: question id/order differs`);
        assert.deepEqual(resultQuestion.blanks, question.blanks, `${questionContext}: blanks differ`);

        const ownAnswers = submittedAnswers.get(`${student.groupId}:${question.id}`);
        const ownSubmission = stored.find((row) => row.groupId === student.groupId && row.questionId === question.id);
        const winningSubmission = rankOneByQuestion.get(question.id);
        assert.ok(ownSubmission, `${questionContext}: stored own submission missing`);
        assert.ok(winningSubmission, `${questionContext}: rank 1 submission missing`);
        assert.ok(resultQuestion.own !== null, `${questionContext}: own result is null`);
        assert.deepEqual(resultQuestion.own.answers, ownAnswers, `${questionContext}: own answers differ`);
        assert.equal(resultQuestion.own.place, ownSubmission.rank, `${questionContext}: own place differs from stored rank`);
        assert.equal(resultQuestion.own.isWinner, ownSubmission.rank === 1, `${questionContext}: own isWinner mismatch`);

        assert.ok(resultQuestion.winner !== null, `${questionContext}: winner is null`);
        assert.deepEqual(resultQuestion.winner.answers, winningSubmission.answers, `${questionContext}: winner answers differ`);
        assert.equal(resultQuestion.winner.groupName, groupNames.get(winningSubmission.groupId), `${questionContext}: winner group name differs`);

        const winnerJson = JSON.stringify(resultQuestion.winner);
        if (winnersByQuestion.has(question.id)) {
          assert.equal(winnerJson, winnersByQuestion.get(question.id), `${questionContext}: winner differs between students`);
        } else {
          winnersByQuestion.set(question.id, winnerJson);
        }

        const allowedAnswers = new Set([...ownAnswers, ...winningSubmission.answers]);
        for (const match of result.bodyText.matchAll(/answer-(\d+)-\d+-\d+/g)) {
          if (Number(match[1]) !== question.id) continue;
          assert.ok(allowedAnswers.has(match[0]), `${questionContext}: response exposes another group's answer ${match[0]}`);
        }
      }
    }

    console.log(JSON.stringify({ students: 100, totalMs, slowestMs }));
    assert.ok(totalMs <= 5_000, `100 student result requests must complete within 5,000ms; actual totalMs=${totalMs}, slowestMs=${slowestMs}`);
  }

  console.log(JSON.stringify({ submissions: submissionCount, totalMs, slowestQuestionMs }));
  assert.ok(totalMs <= 10_000, `5,000 submissions must complete within 10,000ms; actual totalMs=${totalMs}, slowestQuestionMs=${slowestQuestionMs}`);
} finally {
  await Promise.all(clients.map(async ({ reader, controller }) => {
    await reader.cancel().catch(() => {});
    controller.abort();
  }));
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
