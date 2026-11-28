// add-student-language-switch task 1.1
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LANGUAGE_STORAGE_KEY,
  createTranslator,
  detectLanguage,
  readStoredLanguage,
  storeLanguage,
  translateError,
  watchLanguage,
} from './i18n.js';

test('a stored choice wins over the browser languages', () => {
  assert.equal(detectLanguage('en', ['zh-TW']), 'en');
  assert.equal(detectLanguage('zh-TW', ['en-US']), 'zh-TW');
});

test('the first en or zh browser language decides', () => {
  assert.equal(detectLanguage(null, ['en-US', 'zh-TW']), 'en');
  assert.equal(detectLanguage(null, ['zh-TW', 'en']), 'zh-TW');
  assert.equal(detectLanguage(null, ['ja-JP', 'EN-gb']), 'en');
  assert.equal(detectLanguage(null, ['zh-CN']), 'zh-TW');
});

test('other or missing languages fall back to Traditional Chinese', () => {
  assert.equal(detectLanguage(null, ['ja-JP']), 'zh-TW');
  assert.equal(detectLanguage(null, []), 'zh-TW');
  assert.equal(detectLanguage(null, undefined), 'zh-TW');
  assert.equal(detectLanguage('fr', ['en-US']), 'en', 'an invalid stored value is ignored');
});

test('storage failures never throw', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readStoredLanguage(broken), null);
  assert.doesNotThrow(() => storeLanguage('en', broken));

  const values = new Map();
  const memory = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  storeLanguage('en', memory);
  assert.equal(readStoredLanguage(memory), 'en');
  storeLanguage('fr', memory);
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'en', 'invalid languages are not stored');
});

const messages = {
  'zh-TW': { greet: '你好，{name}', only: '只有中文', 'error.KNOWN': '中文錯誤' },
  en: { greet: 'Hello, {name}', 'error.KNOWN': 'Known error' },
};

test('translator interpolates and falls back to Chinese, then to the key', () => {
  const en = createTranslator(messages, 'en');
  assert.equal(en('greet', { name: '第 1 組' }), 'Hello, 第 1 組');
  assert.equal(en('greet'), 'Hello, {name}', 'missing params stay visible');
  assert.equal(en('only'), '只有中文');
  assert.equal(en('missing'), 'missing');
  assert.equal(en.language, 'en');
  assert.equal(createTranslator(messages, 'zh-TW')('greet', { name: 'A' }), '你好，A');
});

test('server errors use the translation when there is one, otherwise the original text', () => {
  const en = createTranslator(messages, 'en');
  assert.equal(translateError(en, 'KNOWN', '伺服器原文'), 'Known error');
  assert.equal(translateError(en, 'UNKNOWN', '伺服器原文'), '伺服器原文');
  assert.equal(translateError(en, undefined, '伺服器原文'), '伺服器原文');
  const zh = createTranslator(messages, 'zh-TW');
  assert.equal(translateError(zh, 'KNOWN', '伺服器原文'), '伺服器原文', 'Chinese keeps the server text exactly');
  assert.equal(translateError(zh, 'KNOWN', undefined), '中文錯誤', 'the table is only a fallback without server text');
});

test('watchLanguage reacts only to valid changes of the language key', () => {
  const listeners = [];
  const target = { addEventListener: (_type, listener) => listeners.push(listener), removeEventListener: () => {} };
  const seen = [];
  watchLanguage((language) => seen.push(language), target);
  listeners[0]({ key: 'other', newValue: 'en' });
  listeners[0]({ key: LANGUAGE_STORAGE_KEY, newValue: 'fr' });
  listeners[0]({ key: LANGUAGE_STORAGE_KEY, newValue: 'en' });
  assert.deepEqual(seen, ['en']);
});
