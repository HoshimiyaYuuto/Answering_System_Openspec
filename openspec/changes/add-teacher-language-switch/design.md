# Design

## Context

- **共用核心**：`add-student-language-switch` 提供 `public/shared/i18n.js`，內容有：
  - `detectLanguage`、`readStoredLanguage`、`storeLanguage`、`watchLanguage`；
  - `createTranslator`、`translateError`；
  - `applyDocumentLanguage`、`applyStaticText`、`mountLanguageSwitch`。

  以及 `/shared` 靜態路徑。本 change 直接使用，不修改。
- **控制台**（`public/teacher/app.js`，約 830 行）：
  - 由多個 reducer 驅動：`consoleState`、`importState`、`exportState`、`monitorState`；
  - 各自有 `renderConsole()`、`renderImport()`、`renderExport()`、`renderMonitor()`，全部用取代的方式重畫；
  - 組別區塊例外：`renderGroups(groups)` 會重建輸入框，重建會清掉老師正在編輯的內容。
- **訊息的存放方式**：reducer 目前存的是已經組好的中文句子，例如 `consoleState.message`、`exportState.result.text`，還有 `app.js` 直接寫入的 `textContent`。
- **四個 logic 檔**有 `node --test`，回傳的都是中文。教師端約 210 處文字。
- **看板**（`board.js` + `board-logic.js`）：用 `render()` 依 `getBoardView(state, now)` 重畫，揭曉進度在 `state.revealed`。
- **匯入警告**：`server/guided-notes-import.js` 的 `readQuestions` 在作答格已有內容時，推入一句中文。這是唯一的警告種類。

## Goals / Non-Goals

**Goals**
- 切換語言只改顯示：任何 reducer 狀態、輸入框的值、進行中的請求都不受影響。
- 繁中輸出與現在逐字相同，四個 logic 檔的既有測試不改斷言。
- 教師訊息表兩種語言的 key 相同，以測試保證。

**Non-Goals**
- server 錯誤的原文、CSV 欄名、xlsx 內容：維持繁中。
- 學生頁：由學生端 change 處理。

## Decisions

### 1. 控制台與看板原地重畫

- 模組層級保存 `language` 與 `t`。
- `setLanguage(next)` 依序執行：
  1. `storeLanguage`；
  2. 重建 `t`；
  3. `applyDocumentLanguage`；
  4. `applyStaticText(document, t)`；
  5. 更新切換器的按下狀態；
  6. 依序呼叫 `renderConsole()`、`renderImport()`、`renderExport()`、`renderMonitor()`、`renderGroupsLock()`、`relabelGroups()`。
- `watchLanguage` 收到其他分頁的變更時，同樣呼叫 `setLanguage`，但不再寫入儲存。
- **組別區塊**：新增 `relabelGroups()`，只更新每列 label 的文字節點（第 N 組名稱），不重建輸入框。
- **看板**：`setLanguage` 之後呼叫既有的 `render()`。`state.revealed` 不動，所以揭曉進度保留。

**替代方案**：像學生頁一樣重新載入。

**不採用原因**：重新載入會丟失以下資料，違反 spec：
- 匯入預覽，它只存在 server 的暫存 `previewId` 與頁面狀態；
- 組別編輯中的內容、確認對話框；
- 看板的揭曉進度。

### 2. 訊息以「描述」保存，畫面時才翻譯

- 原本存中文句子的地方，改為存以下其中一種：
  - `{ key, params }`：前端自己的訊息；
  - `{ code, fallback }`：伺服器錯誤，`fallback` 為伺服器原文；
  - 字串：舊的呼叫方式，原樣顯示。
- 新增 `renderMessage(t, value)`，依型別分別處理：
  - 字串原樣回傳；
  - `{ key }` 用 `t`；
  - `{ code }` 用 `translateError`。
- reducer 不在乎 `message` 是什麼型別，只負責保存與清除，所以 `console-logic`、`export-logic` 的既有測試不需要改。

### 3. logic 檔接受 `t`

會產生文字的函式多一個最後參數 `t`，預設為繁中 translator：

| 檔案 | 函式 |
|---|---|
| `console-logic.js` | `getSetupBlockedReason`、`describeSummary`、`describeFairRanking`、`describeAction`、`parseCountdown` 的錯誤訊息 |
| `import-logic.js` | `getBlockedReason`、`describeCurrent`、`describePreview`、`getSummaryRows` |
| `export-logic.js` | `getExportView`，以及 reducer 產生的結果文字（改存 `{ key, params }`，見第 2 節） |
| `monitor-logic.js` | `getMonitorView`（`formatLocalTime` 不變） |
| `board-logic.js` | `getBoardView` |

- 階段顯示用 `t('phase.' + phase)`，比對 API 階段值的程式碼不動。
- apply 時補上的函式：
  - `console-logic.js` 的 `describeLoginError(state, t)`：reducer 另存 `loginErrorMessage`（描述），`loginError` 仍是繁中文字，既有測試不變；
  - `import-logic.js` 的 `describeWarnings(summary, t)`：第 5 節的提醒組句；
  - `messages.js` 匯出 `renderMessage` 與繁中 translator `ZH`，供各 logic 檔當預設值。
- `app.js` 原本直接寫入 `textContent` 的訊息（載入失敗、組別結果、作廢失敗等）改用 `showMessage(element, value)`：記下描述，`setLanguage` 重畫各區塊後，把切換前仍顯示中的訊息用新語言重寫一次，並保留原本的 `hidden` 狀態。
- 匯出的中文常數保留，值不變，供既有測試使用。

### 4. 教師訊息表 `public/teacher/messages.js`

- `TEACHER_MESSAGES = { 'zh-TW': {...}, en: {...} }`，控制台與看板共用一份。
- 繁中值直接搬自現在的字串。
- 錯誤代碼涵蓋 `docs/api-contract.md` 中教師端會遇到的代碼：
  - 登入：`WRONG_PASSWORD`、`TOO_MANY_ATTEMPTS`、`INVALID_LOGIN_REQUEST`、`TEACHER_PASSWORD_NOT_SET`、`TEACHER_AUTH_REQUIRED`；
  - 組別：`INVALID_GROUPS`、`GROUP_CONFIG_NOT_ALLOWED`；
  - 匯入：`IMPORT_*`；
  - 匯出與寫回：`EXPORT_NOT_ALLOWED`、`NO_GUIDED_NOTES`、`GUIDED_NOTES_NOT_LINK`、`SHEET_*`、`WRITEBACK_IN_PROGRESS`；
  - 作廢：`VOID_NOT_ALLOWED`、`INVALID_VOID_REQUEST`、`ALREADY_VOIDED`、`SUBMISSION_NOT_FOUND`、`QUESTION_NOT_FOUND`；
  - 階段：`INVALID_PHASE_TRANSITION`、`NO_GROUPS`、`QUESTIONS_REQUIRED`、`COUNTDOWN_OUT_OF_RANGE`、`INVALID_FAIR_RANKING`；
  - 通用：`INVALID_JSON`、`BODY_TOO_LARGE`、`NOT_FOUND`、`INTERNAL_ERROR`。
- 測試會比對這份清單與契約中的錯誤表。

### 5. 匯入警告結構化（`server/guided-notes-import.js`）

- `readQuestions` 推入中文警告的同時，推入：

  ```js
  { code: 'ANSWER_CELL_NOT_EMPTY', questionId: id, blankIndex: index, cell: blank.answerCell }
  ```

- 預覽與 `currentSummary()` 都帶出 `warningDetails`。
- 前端：英文介面時依 `warningDetails` 以 `t('import.warning.ANSWER_CELL_NOT_EMPTY', params)` 組句；繁中介面照舊顯示 `warnings`。
- 未知的 `code`，或舊回應沒有 `warningDetails` 時，英文介面退回顯示 `warnings` 原文。

**替代方案**：前端用正規表示式解析中文警告句子。

**不採用原因**：句子一改就會壞，而且難以測試；新增欄位只動一處，又不影響既有用戶端。

### 6. 切換器位置

- 控制台：放在 `<header>` 右側，登出按鈕左邊。未登入時也顯示。
- 看板：右上角固定，投影時字級較大。

### 畫面狀態機

語言切換不新增畫面狀態，只在既有狀態上重畫：

| 畫面 | 切換後 |
|---|---|
| 未設定密碼／登入（含錯誤訊息） | 同一畫面，訊息換語言 |
| 控制台準備中，匯入預覽未確認 | 預覽保留，摘要表格、題型、提醒換語言 |
| 控制台準備中，組別編輯中 | 輸入框內容保留，只換 label |
| 結束或重設確認中 | 確認對話框保留 |
| 搶答中 | 倒數、監看列換語言，展開狀態保留 |
| 已結束 | 搶答結果、匯出按鈕與結果訊息換語言 |
| 看板（任一階段） | 同一畫面，揭曉進度保留 |

## Risks / Trade-offs

- **[風險] 漏掉 `app.js` 直接寫入的中文** → apply 時以 `grep` 掃描 `public/teacher` 中的中文字元，除了訊息表與註解以外不得殘留；這個檢查寫進 task 的驗證。
- **[風險] 伺服器錯誤帶細節**（例如題號重複的列號）→ 英文版以錯誤代碼顯示通用英文，細節不會出現。這與 SpecKit 的做法相同；繁中版仍顯示完整原文。
- **[取捨] 學生頁重新載入、教師端原地重畫，兩邊做法不同** → 兩者都符合 spec。教師端有不能遺失的狀態，所以不能用重新載入。
