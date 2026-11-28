// 介面語言共用核心（add-student-language-switch design 第 1 節）。
// 純 ES module：瀏覽器與 node --test 都能載入；DOM 相關函式只在呼叫時才碰 document。
// 行為對齊 SpecKit 007：預設依瀏覽器語言、記在 localStorage、其他分頁跟著改。

export const LANGUAGES = ['zh-TW', 'en'];
export const DEFAULT_LANGUAGE = 'zh-TW';
export const LANGUAGE_STORAGE_KEY = 'classroom.language';

function isLanguage(value) {
  return LANGUAGES.includes(value);
}

// 已選過的優先；否則看瀏覽器語言清單的第一個 en* 或 zh*；都沒有用繁中
export function detectLanguage(stored, browserLanguages = []) {
  if (isLanguage(stored)) return stored;
  for (const language of browserLanguages ?? []) {
    const normalized = String(language).toLowerCase();
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('zh')) return 'zh-TW';
  }
  return DEFAULT_LANGUAGE;
}

// 私密模式或被封鎖時 localStorage 可能丟例外：讀不到就當作沒選過，寫不進去就只在本頁生效
export function readStoredLanguage(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeLanguage(language, storage = globalThis.localStorage) {
  if (!isLanguage(language)) return;
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 無法儲存時仍可切換，只是不保留
  }
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (params && name in params ? String(params[name]) : match));
}

// 回傳 t(key, params)：先找目前語言，缺漏時退回繁中，兩者都缺時回傳 key（測試保證不會發生）
export function createTranslator(messages, language) {
  const primary = messages?.[language] ?? {};
  const fallback = messages?.[DEFAULT_LANGUAGE] ?? {};
  const t = (key, params) => {
    const template = primary[key] ?? fallback[key];
    return typeof template === 'string' ? interpolate(template, params) : key;
  };
  t.language = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  t.has = (key) => typeof primary[key] === 'string';
  return t;
}

// 伺服器錯誤：繁中介面一律顯示伺服器原文（與改版前相同）；
// 其他語言有 error.<code> 的翻譯就用它，否則顯示伺服器原文
export function translateError(t, code, fallback) {
  const key = `error.${code}`;
  if (t.language === DEFAULT_LANGUAGE && fallback) return fallback;
  if (code && t.has?.(key)) return t(key);
  return fallback ?? '';
}

export function applyDocumentLanguage(language, title, doc = globalThis.document) {
  if (!doc) return;
  doc.documentElement.lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
  if (typeof title === 'string') doc.title = title;
}

// data-i18n="key" 換文字；data-i18n-attr="aria-label:key;placeholder:key" 換屬性
export function applyStaticText(root, t) {
  if (!root?.querySelectorAll) return;
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of element.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) element.setAttribute(attribute, t(key));
    }
  }
}

const SWITCH_OPTIONS = [
  { language: 'zh-TW', text: '中文' },
  { language: 'en', text: 'EN' },
];

// 右上角的「中文／EN」切換器；按鈕文字固定不翻譯，與 SpecKit 相同
export function mountLanguageSwitch(container, { language, label, onChange }) {
  if (!container) return { update() {} };
  const doc = container.ownerDocument;
  container.setAttribute('role', 'group');
  const buttons = SWITCH_OPTIONS.map((option) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = option.text;
    button.dataset.language = option.language;
    button.lang = option.language;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      onChange(option.language);
    });
    return button;
  });
  container.replaceChildren(...buttons);
  function update(current, currentLabel) {
    if (typeof currentLabel === 'string') container.setAttribute('aria-label', currentLabel);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.language === current));
  }
  update(language, label);
  return { update };
}

// 其他分頁改了語言時通知（storage 事件只會在「其他」分頁觸發）
export function watchLanguage(onChange, target = globalThis) {
  if (!target?.addEventListener) return () => {};
  const listener = (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY || !isLanguage(event.newValue)) return;
    onChange(event.newValue);
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
