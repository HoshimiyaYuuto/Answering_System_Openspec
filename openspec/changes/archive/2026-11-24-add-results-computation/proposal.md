# Proposal: add-results-computation

## Why

學生結果頁、老師監看與結果、xlsx 匯出、Google 試算表寫回與 CSV 都要知道「每題誰搶答成功、各組第幾名」。如果各功能各自從作答紀錄推導，作廢、公平順位、老師改選加入後很容易出現不一致的結果。`docs/submission-record.md` 已和學生端成員約定由單一函式 `computeResults()` 推導，本 change 先建立這個函式的第一版，讓之後的功能都從同一個地方讀取結果。

## What Changes

- 新增 `server/results.js` 的純函式 `computeResults({ questions, submissions, fairRankingEnabled, overrides, now })`，依 `docs/submission-record.md` 第 2 節的格式回傳每題的判定結果（`questionId`、`settled`、`winner`、`winnerSource`、`placings`）。
- 第一版只支援：
  - 先到先得：有效作答依 `rank` 排出連續的名次 `place`，第 1 名為勝者，`winnerSource` 為 `'arrival'`。
  - 過濾作廢：`status` 不是 `'valid'` 的作答不計入名次與勝者。
  - 沒有有效作答的題目：`settled` 為 true、`winner` 與 `winnerSource` 為 null、`placings` 為空陣列。
- 參數形狀一次定好：`fairRankingEnabled` 為 true 或 `overrides` 不是空的時，第一版丟出錯誤，不默默回傳錯誤的結果；`now` 先接收但不影響結果。之後的公平順位與老師改選 change 只需補上邏輯，不改呼叫方式。
- 更新 `docs/submission-record.md`：補上 `winner` 為 null 時 `winnerSource` 也為 null，以及第一版遇到未支援設定時的行為。
- 本 change 不新增 HTTP 端點、不改 `server/index.js`，也不接上任何畫面或匯出。

對應 `docs/explore_summary.md`：第 3 節 D6、D13（「順位」「是否搶答成功」欄位的來源）、D24（作廢不計入結果）；第 4 節 O3 與第 3 節 D14、D25 只預留參數，不實作；第 7 節（server 為順位與結果的唯一裁判）。

## Capabilities

### New Capabilities

- `question-results`：由作答紀錄推導每題的判定結果（勝者、勝者來源、名次、是否已判定），供結果、監看、匯出與寫回共用。

### Modified Capabilities

無。

## Impact

- **負責人**：教師端成員。
- **程式**：新增 `server/results.js` 與 `server/results.test.js`。沒有新增套件。
- **文件**：`docs/submission-record.md`（第 2 節）。
- **依賴**：不依賴 `add-buzz-in-submission` 的程式；輸入的作答紀錄格式以它的 design 第 4 節與 `docs/submission-record.md` 第 1 節為準，測試以手寫資料進行。
- **之後的 change 依賴本 change**：`add-guided-notes-export`（改用 `computeResults` 的 `winner` 取代自己的勝者選擇）、`add-student-results`（學生端成員）、教師端監看與結果、CSV 匯出、作廢、公平順位、老師改選。
- **不在範圍**：公平順位（D14、D25）、老師改選（O3）、作廢操作本身（D24）、任何 API 或畫面。
