# Design

## Context

- 學生頁由 `public/student/index.html`、`app.js`（約 1000 行，處理 DOM 與請求）、`logic.js`（純函式，有 `node --test`）、`drafts.js` 組成。
- **需要翻譯的文字**約 110 處：
  - `index.html` 的靜態標題與按鈕；
  - `app.js` 動態產生的提示、按鈕與錯誤；
  - `logic.js` 回傳的訊息與結果文字。
- **伺服器錯誤**：`app.js` 目前直接顯示 `body.error.message`（繁中）。學生端會遇到的代碼有：
  - 進場：`INVALID_STUDENT_ID`、`STUDENT_NOT_ENTERED`、`GROUP_NOT_FOUND`、`GROUP_CHANGE_NOT_ALLOWED`；
  - 題目與作答：`QUESTIONS_NOT_AVAILABLE`、`QUESTION_NOT_FOUND`、`SUBMISSION_NOT_ALLOWED`、`ALREADY_SUBMITTED`、`INVALID_ANSWER`；
  - 結果：`RESULTS_NOT_AVAILABLE`；
  - 通用：`INVALID_JSON`、`BODY_TOO_LARGE`、`NOT_FOUND`、`INTERNAL_ERROR`。
- **草稿**：每次輸入都會寫入 localStorage，重新整理或重連都會還原（O4）；重連流程也會從 server 還原階段、組別與已送出答案。
- **階段值**：API 的階段值是中文字串（`準備中`、`搶答中`、`已結束`），這是契約值，不能改，只翻譯顯示。
- **靜態路徑**：server 目前只提供 `/student`、`/teacher`。
- SpecKit 007 的可觀察行為見 proposal.md。

## Goals / Non-Goals

**Goals**
- 兩種語言的訊息表 key 完全相同，用測試保證，對應 SpecKit FR-008 的「漏翻譯就失敗」。
- 繁中輸出與現在逐字相同：`logic.js` 的既有測試不改斷言。
- 共用核心不依賴學生頁，教師端 change 可以直接使用。

**Non-Goals**
- 伺服器多語言、CSV、匯出：維持繁中。
- 第三種語言。

## Decisions

### 1. 共用核心 `public/shared/i18n.js`

純 ES module，可在瀏覽器與 Node 測試使用，DOM 相關函式只在呼叫時才碰 `document`：

- `LANGUAGES = ['zh-TW', 'en']`，`LANGUAGE_STORAGE_KEY = 'classroom.language'`（與 SpecKit 同名，方便對照）。
- `detectLanguage(stored, browserLanguages)`：規則同 spec。
- `readStoredLanguage()`、`storeLanguage(lang)`：用 try/catch 包住 localStorage，私密模式讀寫失敗時當作沒選過。
- `createTranslator(messages, lang)`：
  - 回傳 `t(key, params)`，`{name}` 形式的插值；
  - 找不到 key 時回傳繁中版本，再找不到就回傳 key，測試保證不會發生。
- `translateError(t, code, fallback)`：
  - 繁中介面一律回傳 `fallback`（伺服器原文），確保與改版前逐字相同；
  - 英文介面有 `error.<code>` 就用它，否則回傳 `fallback`（伺服器原文）。
  - apply 時發現：若繁中也查訊息表，表中的句子與 server 原文可能不同（例如帶列號的細節），所以改為繁中不查表。
- `applyDocumentLanguage(lang, title)`：設定 `<html lang>` 與 `document.title`。
- `applyStaticText(root, t)`：
  - 把 `[data-i18n]` 元素的 `textContent` 換成 `t(key)`；
  - `[data-i18n-attr]`（格式 `aria-label:key`）設定屬性。
- `mountLanguageSwitch(container, { language, label, onChange })`：
  - 產生「中文」「EN」兩個按鈕；
  - 外框為 `role="group"` 並帶 `aria-label`，按鈕用 `aria-pressed`。
- `watchLanguage(onChange)`：監聽 `storage` 事件，其他分頁改了 key 時呼叫。

server 新增 `app.use('/shared', express.static(resolve(publicRoot, 'shared')))`。

**替代方案**：教師頁直接 `import '/student/i18n.js'`。

**不採用原因**：教師頁會依賴學生頁的檔案位置，學生頁重構時容易誤刪。獨立的 `/shared` 只多一行路由。

### 2. 學生訊息表 `public/student/messages.js`

- 匯出 `STUDENT_MESSAGES = { 'zh-TW': {...}, en: {...} }`，key 以畫面分組，例如：
  - `selection.title`、`phase.準備中`、`grid.status.draft`；
  - `results.summary`（帶 `{wins}`、`{total}`）；
  - `error.GROUP_NOT_FOUND`。
- 繁中值直接搬自現在的字串，確保逐字相同。
- 測試檢查兩種語言的 key 集合相同、沒有空字串、插值參數名稱一致。

### 3. `logic.js` 接受翻譯函式

- 會產生文字的函式多一個最後參數 `t`：`getEntryNextStep`、`getStoredEntryNextStep`、`getPhaseDisplay`、`buildResultsRows`、`getResultsLoadNextStep`、`formatAnswers` 的分隔符號。
- 預設值為繁中的 translator，所以既有呼叫與測試完全不用改。
- 匯出的常數（`RESET_MESSAGE`、`FAIR_RANKING_NOTICE` 等）保留，值不變，供既有測試使用；`app.js` 改用 `t()`。

### 4. 切換時重新載入頁面

- 按切換器或收到其他分頁的 `storage` 事件時：
  1. 先寫入語言（若是本頁按的）；
  2. 呼叫 `saveCurrentDraft()`；
  3. `location.reload()`。
- 重新載入後，`app.js` 一開始就用新語言：
  - 套用 `applyDocumentLanguage` 與 `applyStaticText`；
  - 掛上切換器；
  - 照既有流程還原進場、階段、草稿與已送出答案。

**替代方案**：不重新載入，逐一重畫目前畫面（選組、等待、題號格、題目頁、結果）。

**不採用原因**：
- `app.js` 有六種畫面與多個非同步狀態（送出中、重連中、結果載入中），逐一重畫容易漏掉某個狀態，留下混雜兩種語言的畫面；
- 重新載入走的是已經測過的「重新整理後還原」流程（AC-000-06），草稿每次輸入都已存好，送出中的請求在 server 端照常完成，重新載入後由既有同步流程顯示為已送出；
- 代價是切換時畫面會閃一下、目前開著的題目頁回到題號格。這在可接受範圍：學生通常只會在一開始切換一次。

### 5. `app.js` 的改法

- 啟動時：
  - `const language = detectLanguage(readStoredLanguage(), navigator.languages)`；
  - `const t = createTranslator(STUDENT_MESSAGES, language)`。
- 所有寫死的中文改成 `t(key)`；階段顯示用 `t('phase.' + phase)`，比對 API 值的程式碼不動。
- 伺服器錯誤一律經過 `translateError(t, error.code, error.message)`。
- `index.html`：
  - 靜態文字加上 `data-i18n`；
  - `<html lang="zh-TW">`；
  - header 加 `<div id="language-switch">`，以 CSS 固定在右上角。

### 畫面狀態機

語言切換不新增畫面狀態，只在每個既有畫面加上「切換 → 重新載入 → 還原到同一個畫面」：

| 畫面 | 切換後回到 |
|---|---|
| 選組 | 選組（新語言） |
| 等待（準備中） | 等待 |
| 題號格（搶答中） | 題號格，草稿與已送出狀態保留 |
| 題目頁（搶答中） | 題號格。草稿已存，再點題號即可繼續 |
| 結果（已結束） | 結果，重新讀取 |
| 重新連線中 | 重新載入後照既有重連流程 |

## Risks / Trade-offs

- **[風險] 英文翻譯不自然** → 文字短且集中在訊息表，demo 前可以一次檢查；繁中不受影響。
- **[風險] 載入時先閃一下中文**（HTML 原文是繁中，module 執行後才換成英文）→ module 腳本在第一次繪製前通常已執行，影響很小；若明顯，可以在 `<html>` 加 `class="i18n-pending"` 先隱藏內容。先不做，視手動測試結果決定。
- **[取捨] 兩組實作不同**：SpecKit 是 React 原地重畫，本組是重新載入。可觀察結果相同（立即換語言、狀態保留），沒有違反 007 的任何 FR。
