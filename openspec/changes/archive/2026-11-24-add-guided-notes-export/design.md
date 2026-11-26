# Design: add-guided-notes-export

## Context

動機見 proposal.md。目前狀態：

- `server/guided-notes-import.js` 的 `exportSource()` 已回傳原始檔 `fileBuffer`、`sheetName`，以及每個空格的 `index`、`prefix`、`anchorCell`、`answerCell`。匯出要的位置資料大多已經有。
- 缺的是試算表 ID。`toGoogleSheetsExportUrl()` 會解析出 `id`，但 `downloadGuidedNotes()` 只回傳 `{ buffer, name }`，`index.js` 也只把 `{ type: 'link', name }` 當作來源。
- `locateBlank()` 遇到「前綴格右側沒有空白格」時，會退回把答案位置設為前綴格本身。這在匯入空白學習單時沒問題，但寫回過一次後重新讀取，H5 已經有答案，答案位置就會變成 G5，第二次寫回會蓋掉前綴。
- 已確認的版面（以現有 fixtures 實測）：
  - `02-official-group.xlsx` 的題組：前綴在 G 欄，答案位置在 H 欄。
  - `04-mixed-groups.xlsx` 的題組：前綴位於合併填答區，答案位置等於前綴格（例如 G7）。
  - `01`、`03`、`05` 都是單題。
- 作答資料由學生端成員的 `add-buzz-in-submission`（PR #8）提供：`createApplication` 已有 `submissions` 選項（預設 `createSubmissions()`），`submissions.listSubmissions()` 回傳 `{ questionId, groupId, answers, submittedAt, rank, status }`，依題號、`rank` 排序。
- 每題勝者由 `add-results-computation`（PR #9）的 `computeResults()` 推導，回傳 `{ questionId, settled, winner: { groupId, rank } | null, winnerSource, placings }`，不含答案。兩者的格式見 `docs/submission-record.md`。
- 老師端點一律掛 `requireTeacher`，檢查順序為登入 → 階段 → 內容。
- SpecKit 組 006 的可觀察行為（只比行為，不看程式）：
  - 端點是 `POST /api/export/guided-notes/writeback`，回傳 `{ writtenCells }`。
  - 只用 `values.batchUpdate` 加 RAW 寫入。
  - 錯誤代碼為 `SHEET_*` 一組。
  - 寫回前會比對版面。

## Goals / Non-Goals

**Goals:**

- 下載 xlsx 和寫回試算表使用同一個「答案 → 儲存格內容」函式，兩條路的結果一定一致。
- 重新定位直接重用匯入的解析器，不另外寫一套規則。
- 測試完全不連 Google：token、寫入、重新讀取都可以注入替身。
- 不新增 npm 相依套件。

**Non-Goals:**

- 不做 OAuth（老師授權自己的 Google 帳號）。
- 不清除「這次無人作答、上一次寫回留下的答案」。寫回只寫有成功答案的格子。
- 勝者規則不在本 change：一律讀 `computeResults()` 的 `winner`。公平順位、作廢、老師改選之後由各自的 change 加進 `computeResults()`，匯出不需要修改。
- 不支援同一份試算表中有多個工作表都要寫回。只寫匯入時選中的那一個工作表（重新讀取時同樣取第一個有題目的工作表）。

## Decisions

### 1. 模組切分

| 檔案 | 內容 | 相依 |
|---|---|---|
| `server/guided-notes-export.js` | 純函式：`winningAnswers(results, submissions)`、`buildCellWrites(questions, winners)`、`relocateQuestions(imported, fresh)`、`buildAnswerWorkbook({ fileBuffer, sheetName, writes })`，以及 `GuidedNotesExportError` | `exceljs` |
| `server/google-sheets.js` | `loadServiceAccount(path)`、`createSheetsClient({ credentials, fetchImpl, now })`，以及 Google 錯誤分類 | `node:crypto`、`node:fs`、`fetch` |
| `server/index.js` | 三個端點、寫回進行中旗標 | 上面兩個模組、`server/results.js` |

`createApplication()` 新增一個可注入選項，並沿用兩個既有選項：

- `sheetsClient`（新增）：預設依 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 建立；沒有設定或讀取失敗時為 `null`。
- 既有的 `downloadGuidedNotesImpl`：重新讀取時也用它。
- 既有的 `submissions`：測試注入 `createSubmissions()` 後直接呼叫 `submit()` 建立作答，不需要開發用路由。

測試只要換掉 `sheetsClient` 與 `downloadGuidedNotesImpl`，就能涵蓋所有 Google 情境。

### 2. 勝者與儲存格內容

- `winningAnswers(results, submissions)`：對每個 `winner` 不是 `null` 的結果，以 `questionId` + `winner.rank` 在作答紀錄中找出那一筆，回傳 `Map<questionId, string[]>`（該筆的 `answers`）。勝者怎麼選完全由 `computeResults()` 決定，這裡只負責查答案。
  - 替代方案：在 `computeResults()` 的結果中直接附上答案。不採用，理由見 `add-results-computation` design 第 1 節（避免結果重複保存答案、學生端誤帶他組答案）。
- `buildCellWrites(questions, winners)`：對有勝者的題目，逐空格產生 `{ cell, value }`。
  - 有前綴且 `answerCell === anchorCell`（04 型）時，值為 `prefix + answer`。
  - 其他情況，值只有 `answer`。
  - 無勝者的題目不產生任何寫入。
- 下載 xlsx 和寫回 Google 都只吃這份 `writes`。

替代方案：在 xlsx 與 Google 兩邊各自判斷前綴。不採用，因為兩邊的規則可能分歧，SpecKit 也特別強調兩條路要一致。

### 3. 下載 xlsx

`exceljs` 讀入原始檔，在 `sheetName` 工作表逐格設定 `cell.value = value`（字串），再 `writeBuffer()`。

- exceljs 只有在值是 `{ formula }` 物件時才寫公式，所以「=1+1」會存成文字。
- 回應標頭：
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="guided-notes-answers.xlsx"; filename*=UTF-8''<原檔名去掉 .xlsx>（搶答結果）.xlsx`
- 錯誤時回 JSON envelope，所以前端用 `fetch` 取 blob 後再觸發下載，不用 `<a href>` 直連，這樣才能顯示錯誤訊息。

### 4. 保存寫回目標，並修正前綴右側已有內容的情況

- `downloadGuidedNotes()` 改為回傳 `{ buffer, name, spreadsheetId }`。
- `createPreview()` 多收一個 `target`：連結來源為 `{ spreadsheetId }`，上傳來源為 `null`。
  - `target` 不放進 `source`，因為 `summarize()` 會原樣複製 `source` 到老師摘要。
  - `exportSource()` 多回傳 `target`。
- `locateBlank()`：前綴右側找不到空白格時，改用「前綴合併範圍右側第一個起始格」作為答案位置；只有右側沒有任何格子時，才退回前綴格。
  - 答案位置不是前綴格且已有內容時，加入既有格式的警告「第 N 題第 M 格（H5）已有內容，匯出時會被取代」。

替代方案：重新定位時改用「列偏移量」推算位置，不改解析器。不採用，原因有兩個：

- 欄位也可能被移動。
- 匯入與重新定位用不同規則，反而違反「同一套規則」的要求（O6）。

### 5. 寫回流程

`POST /api/teacher/guided-notes/writeback` 依序檢查，任一步失敗就回錯誤，且不寫入：

1. `requireTeacher` → 401 `TEACHER_AUTH_REQUIRED`
2. 階段不是「已結束」→ 409 `EXPORT_NOT_ALLOWED`
3. 沒有匯入 → 409 `NO_GUIDED_NOTES`
4. `target` 為 `null` → 409 `GUIDED_NOTES_NOT_LINK`
5. `sheetsClient` 為 `null` → 503 `SHEET_NOT_CONFIGURED`
6. 已有寫回進行中 → 409 `WRITEBACK_IN_PROGRESS`（模組內的布林旗標，在 `finally` 中清除）
7. 取一次 `all = submissions.listSubmissions()`，計算 `winners = winningAnswers(computeResults({ questions: session.questions, submissions: all }), all)`（下載 xlsx 用同一段）。為空時直接回 `{ writtenCells: 0, remapped: false }`，不連 Google。
8. 重新讀取：以 `downloadGuidedNotesImpl` 下載 `https://docs.google.com/spreadsheets/d/<id>`，再以 `parseGuidedNotes()` 解析。
   - 下載失敗 → 502 `SHEET_CHECK_FAILED`。
   - 解析失敗（找不到表頭、題號重複等）→ 409 `SHEET_MODIFIED`。
9. `relocateQuestions(imported, fresh)`：
   - 題號集合不同，或任一題空格數不同 → 409 `SHEET_MODIFIED`，訊息列出第一個差異（例如「線上試算表找不到第 3 題」「第 2 題的空格數由 2 變成 3」）。
   - 否則取 fresh 的 `sheetName`、`anchorCell`、`answerCell`，但沿用匯入時的 `prefix`。原因是寫回過的 04 型格子會變成「（1）甲」，解析器已讀不出前綴。
   - 任一位置或工作表名稱不同時，`remapped = true`。
10. `buildCellWrites()` → `sheetsClient.batchUpdateValues(spreadsheetId, sheetName, writes)` → 回 `{ data: { writtenCells, remapped } }`。

重新讀取走「知道連結者可檢視」的匯出網址，也就是和匯入同一條路。

- 替代方案 A：以服務帳號呼叫 `spreadsheets.get` 取得值與合併範圍。這樣要另寫一個把 API 回應轉成解析器輸入的轉接層，也就失去「同一套規則」的保證。
- 替代方案 B：帶服務帳號 token 下載匯出網址。這需要額外的 Drive 權限範圍，而目前沒有驗證過服務帳號能否這樣下載。

上述兩種都不採用。代價是老師在匯入後若取消連結檢視，寫回會回 `SHEET_CHECK_FAILED`；訊息會說明要恢復檢視權限。

替代方案：讀不到就不檢查，直接用匯入時的位置寫入（SpecKit 006 早期版本是這樣）。不採用，因為 O6 明確要求不能只信匯入時的位置。

### 6. Google 認證與寫入（`server/google-sheets.js`）

- **金鑰**：`GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 指向 repo 外的 JSON 檔。server 啟動時讀取 `client_email` 與 `private_key`。
  - 檔案不存在、不是 JSON、缺欄位時，`sheetsClient` 為 `null`，並記一行 log「Google 服務帳號金鑰檔無法讀取，寫回功能停用」。log 不印路徑以外的內容。
  - 替代方案：像 SpecKit 一樣把信箱與私鑰放在兩個環境變數。不採用，因為私鑰含換行，放進 `.env` 容易出錯，也比較容易被誤貼。
- **Token**：自行組 JWT。
  - header 為 `{ alg: 'RS256', typ: 'JWT' }`。
  - claim 為 `iss` = 信箱、`scope` = `https://www.googleapis.com/auth/spreadsheets`、`aud` = `https://oauth2.googleapis.com/token`、`iat`、`exp = iat + 3600`。
  - 以 `crypto.sign('RSA-SHA256', ...)` 簽章後，POST 到 token 端點。
  - access token 快取到到期前 60 秒。
  - 替代方案：`googleapis` 或 `google-auth-library`。不採用，因為它們會帶進大量相依套件，而我們只需要兩個 HTTP 呼叫。
- **寫入**：一次 `POST https://sheets.googleapis.com/v4/spreadsheets/<id>/values:batchUpdate`，body 為 `{ valueInputOption: 'RAW', data: [{ range: "'<工作表>'!H5", values: [['甲']] }, ...] }`。
  - 工作表名稱以單引號包住，名稱內的 `'` 改成 `''`。
  - 回應的 `totalUpdatedCells` 作為 `writtenCells`。
  - 不使用 `spreadsheets.batchUpdate`，因為它會動到格式。
- **逾時**：token 與寫入各 10 秒（`AbortSignal.timeout`）。
- **錯誤分類**：只讀 Google 回應的 HTTP 狀態、`error.status`、`error.details[].reason` 與 `error.message` 來判斷，回給老師的訊息是我們自己的中文訊息，不轉貼 Google 原文。

| 情況 | 代碼 | HTTP |
|---|---|---|
| token 端點回 400／401（`invalid_grant`、`invalid_client`），或 Sheets 回 401 | `SHEET_AUTH_FAILED` | 503 |
| Sheets 回 403，且 reason 為 `SERVICE_DISABLED` 或 `accessNotConfigured` | `SHEET_API_DISABLED` | 503 |
| Sheets 回其他 403 | `SHEET_NOT_EDITABLE`（訊息含服務帳號信箱） | 422 |
| Sheets 回 404 | `SHEET_NOT_FOUND` | 422 |
| Sheets 回 400，訊息含 `not supported for this document` | `SHEET_NOT_NATIVE` | 422 |
| Sheets 回 400，訊息含 `Unable to parse range` | `SHEET_TAB_NOT_FOUND` | 422 |
| 429、5xx、其他 400、網路錯誤、逾時 | `SHEET_UNAVAILABLE` | 502 |

### 7. 查詢設定

- `GET /api/teacher/guided-notes/writeback`（`requireTeacher`）回傳 `{ data: { configured, serviceAccountEmail, target } }`，其中 `target` 為 `'link' | 'file' | null`。服務帳號信箱不是機密，可以顯示。
- 不新增開發用路由。手動驗證走真實流程：學生進場 → 老師開始 → 學生以 `POST /api/student/submissions` 送出 → 老師結束 → 匯出。
  - 替代方案：開發用路由直接注入勝者答案。不採用，因為真實送出 API 已存在，注入會繞過 `computeResults()`，驗證不到兩者的串接。

### 8. 老師控制台的匯出區塊

`public/teacher/export-logic.js` 是純函式，有自己的測試，風格比照 `console-logic.js`。

**狀態**：

- `phase`
- `importSource`：`'link' | 'file' | null`，來自匯入摘要
- `config`：`{ configured, serviceAccountEmail }`，`null` 表示讀取中
- `action`：`'idle' | 'writing' | 'downloading'`
- `result`：`{ tone: 'ok' | 'error', text } | null`

**畫面**（區塊內的顯示，由 `getExportView(state)` 決定）：

| 畫面 | 條件 | 顯示 |
|---|---|---|
| `notEnded` | `phase !== '已結束'` | 說明「活動結束後才能匯出」，兩個按鈕停用 |
| `noImport` | 已結束、`importSource === null` | 說明尚未匯入學習單，兩個按鈕停用 |
| `fileOnly` | 已結束、`importSource === 'file'` | 只有下載可用，說明上傳的檔案沒有線上試算表可寫回 |
| `notConfigured` | 已結束、連結來源、`config.configured === false` | 只有下載可用，說明 server 未設定服務帳號 |
| `ready` | 已結束、連結來源、已設定 | 兩個按鈕可用，顯示服務帳號信箱與「請把試算表共用給此信箱並設為編輯者」 |

`action !== 'idle'` 時兩個按鈕都停用。`result` 顯示在區塊底部。

**事件**：

| 事件 | 效果 |
|---|---|
| `configLoaded`、`importLoaded` | 更新對應欄位 |
| `phaseChanged` | 更新 `phase`，清除 `result` |
| `requestWriteback` | `action` 改為 `writing` |
| `writebackDone({ writtenCells, remapped })` | 顯示「已寫入 N 格」；`remapped` 時加上版面變動的說明 |
| `writebackFailed(error)` | 顯示 server 訊息，加上「也可以改用下載 xlsx」 |
| `requestDownload`、`downloadDone`、`downloadFailed` | 與寫回相同的模式 |

所有結束事件都會把 `action` 改回 `idle`。

**`app.js` 的串接**：

- 進入控制台與 SSE `open` 時，和匯入狀態一起讀取 `GET .../writeback`。這兩個請求各自帶序號，丟棄過期回應。
- 匯入確認後送出 `importLoaded`。
- 401 回應沿用既有的 `handleAuthError`，回到登入畫面。

### 9. 與 `docs/api-contract.md` 的一致性

- 新增「Guided Notes 匯出」一節，列三個端點、回應形狀與錯誤表。
- `EXPORT_NOT_ALLOWED` 對應既有的 `IMPORT_NOT_ALLOWED`，維持「動作_NOT_ALLOWED」的命名方式。
- 寫回錯誤沿用 SpecKit 006 的 `SHEET_*` 與 `NO_GUIDED_NOTES`、`GUIDED_NOTES_NOT_LINK` 名稱，方便兩組互測。以下與 SpecKit 不同，屬於內部差異，使用者看到的行為一致：
  - 端點路徑：我們放在 `/api/teacher/guided-notes/` 底下，與匯入一致。
  - 狀態類錯誤一律用 409，與本組既有慣例一致。
  - 沒有 `force` 參數：O6 要求題號對不上時拒絕寫入，不給「仍要寫回」。
- 成功回應包在 `{ "data": ... }`，錯誤用既有 envelope。

## Risks / Trade-offs

- [exceljs 讀寫一輪可能遺失部分格式，例如條件式格式或圖片] → 這只影響「下載 xlsx」這條備援路；主流程的 Google 寫回只改值。在 README 說明，並在人工驗證中以官方範本確認可接受。
- [老師在匯入後取消連結檢視，重新讀取會失敗] → 回 `SHEET_CHECK_FAILED`，訊息說明要恢復「知道連結者可檢視」，或改用下載 xlsx。
- [重新讀取到寫入之間，老師又改了試算表] → 這段時間差很短，接受這個風險，不另外加鎖。
- [第二次寫回時，本次無人作答的題目會留著上一次的答案] → 與 SpecKit 相同，在 README 與成功訊息中說明。
- [Google 錯誤訊息的英文字串之後可能變動，分類會落到 `SHEET_UNAVAILABLE`] → 優先依 HTTP 狀態與 `reason` 判斷，字串比對只用在 400 的兩種情況；分類失準時，老師仍能看到可行動的備援提示。
- [金鑰檔外流] → 金鑰只放在 `C:\Users\<使用者>\.secrets\` 這類 repo 外的位置，`.env` 只寫路徑，log 與回應都不帶金鑰內容。服務帳號只被授權給明確共用給它的試算表。
- [PR #8 或 #9 在 review 中改了介面] → apply 前先把本分支更新到最新的 main，並對照 `docs/submission-record.md`；介面不同時先停下來更新本 design。

## Migration Plan

- 不需要資料遷移；狀態都在記憶體。
- 部署時，在 `.env` 加上 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`。沒加也能啟動，只是寫回回 `SHEET_NOT_CONFIGURED`。
- 回滾：移除三個端點與兩個新模組，並把 `downloadGuidedNotes()` 與 `locateBlank()` 改回原樣。匯入的其他行為不受影響。

