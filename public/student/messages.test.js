// add-student-language-switch task 1.2
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslator, translateError } from '../shared/i18n.js';
import { STUDENT_ERROR_CODES, STUDENT_MESSAGES } from './messages.js';
import { buildResultsRows, formatAnswers, getEntryNextStep, getPhaseDisplay, getResultsLoadNextStep } from './logic.js';

const en = createTranslator(STUDENT_MESSAGES, 'en');
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('both languages have the same keys, non-empty values and the same placeholders', () => {
  const zhKeys = Object.keys(STUDENT_MESSAGES['zh-TW']).sort();
  const enKeys = Object.keys(STUDENT_MESSAGES.en).sort();
  assert.deepEqual(enKeys, zhKeys);
  for (const key of zhKeys) {
    for (const language of ['zh-TW', 'en']) {
      assert.ok(STUDENT_MESSAGES[language][key].length > 0, `${language} ${key} is empty`);
    }
    assert.deepEqual(placeholders(STUDENT_MESSAGES.en[key]), placeholders(STUDENT_MESSAGES['zh-TW'][key]), key);
  }
});

test('English messages contain no Chinese characters', () => {
  for (const [key, value] of Object.entries(STUDENT_MESSAGES.en)) {
    assert.doesNotMatch(value, /[一-鿿]/, key);
  }
});

test('every student error code has an English message', () => {
  for (const code of STUDENT_ERROR_CODES) {
    assert.ok(en.has(`error.${code}`), code);
    assert.notEqual(translateError(en, code, '伺服器原文'), '伺服器原文', code);
  }
});

const results = {
  fairRankingEnabled: true,
  questions: [
    {
      questionId: 1,
      blanks: [{ index: 0, prefix: '', prompt: '題目一' }],
      winner: { groupName: '第 1 組', answers: ['水'], byFairRanking: false },
      own: { place: 1, isWinner: true, answers: ['水'] },
    },
    {
      questionId: 3,
      blanks: [{ index: 0, prefix: '（1）', prompt: 'a' }, { index: 1, prefix: '（2）', prompt: 'b' }],
      winner: { groupName: '第 2 組', answers: ['臺北', '新北'], byFairRanking: true },
      own: { place: 2, isWinner: false, answers: ['高雄', '臺南'] },
    },
    { questionId: 4, blanks: [], winner: null, own: null },
  ],
};

test('results in English keep group names and answers as entered', () => {
  const view = buildResultsRows(results, en);
  assert.equal(view.summary.text, 'Your group won 1 of 3 questions');
  assert.equal(view.fairRankingNotice, 'Fair ranking was used in this session');
  assert.equal(view.rows[0].label, 'Question 1');
  assert.equal(view.rows[0].winnerText, '第 1 組: 水');
  assert.equal(view.rows[0].ownText, 'Your group placed #1 (won): 水');
  assert.equal(view.rows[1].winnerText, '第 2 組: （1）臺北; （2）新北 (decided by fair ranking)');
  assert.equal(view.rows[1].ownText, 'Your group placed #2: （1）高雄; （2）臺南');
  assert.equal(view.rows[2].winnerText, 'No answers');
  assert.equal(view.rows[2].ownText, 'Your group did not answer');
});

test('Chinese output of the result rows is unchanged', () => {
  const view = buildResultsRows(results);
  assert.equal(view.summary.text, '本組成功 1 題／共 3 題');
  assert.equal(view.rows[1].winnerText, '第 2 組：（1）臺北；（2）新北（本題因公平順位改判）');
  assert.equal(view.rows[1].ownText, '本組第 2 名：（1）高雄；（2）臺南');
  assert.equal(formatAnswers(results.questions[1].blanks, ['甲', '乙']), '（1）甲；（2）乙');
});

test('phase, entry and result-loading messages in English', () => {
  assert.equal(getPhaseDisplay('準備中', en).message, 'Please wait until the teacher starts the activity.');
  assert.equal(getPhaseDisplay('搶答中', en).canChangeGroup, false);
  assert.equal(getEntryNextStep({ valid: false, reason: 'activity_reset' }, en).message, 'The activity was reset. Please choose your group again');
  assert.equal(getEntryNextStep({ valid: false, reason: 'unknown' }, en).message, 'Your entry is not valid. Please choose your group again.');
  assert.equal(getResultsLoadNextStep(500, en).message, 'Could not load the results. Please try again later');
  assert.equal(en('phase.搶答中'), 'Answering');
});
