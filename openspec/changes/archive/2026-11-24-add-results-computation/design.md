# Design: add-results-computation

## Context

- 動機見 proposal。輸入與輸出的格式已和學生端成員約定在 `docs/submission-record.md`（v0.3）第 1、2 節，本 design 只決定第一版的做法。
- 作答紀錄由 `add-buzz-in-submission` 的 `server/submissions.js` 保存，`listSubmissions()` 回傳 `{ questionId, groupId, answers, submittedAt, rank, status }` 的陣列（依題號、`rank` 排序）。該 change 尚未合併，但本 change 只依賴這個資料形狀，不 import 它。
- `session.questions` 由匯入寫入，每題有 `id`（學習單題號，可能不連續）與 `blanks`。
- 專案為 ESM（`"type": "module"`），測試以 `node --test` 執行，沒有額外測試套件。

## Goals / Non-Goals

**Goals:**

- 一個不依賴 HTTP、`session` 或時鐘的純函式，所有輸入由呼叫端傳入。
- 呼叫方式一次定好，之後的公平順位與老師改選只補邏輯，不改簽名與輸出形狀。

**Non-Goals:**

- 快取或增量計算：組數上限目前為 100（D20 尚待與 SpecKit 統一），100 組 × 50 題最多 5,000 筆，每次全部重算即可。
- 接上任何呼叫端：`add-guided-notes-export` 等 change 各自接上。

## Decisions

### 1. 簽名與輸出

```js
export function computeResults({ questions, submissions, fairRankingEnabled = false, overrides = {}, now } = {})
// 回傳 Array<{ questionId, settled, winner, winnerSource, placings }>
```

- `questions` 只讀每題的 `id`；結果依 `id` 由小到大排序（`docs/submission-record.md`「依題號順序回傳」），不依傳入順序。
- `winner` 為 `{ groupId, rank }` 或 `null`；`winnerSource` 在 `winner` 為 `null` 時也是 `null`，否則第一版恆為 `'arrival'`。
- `placings` 為 `[{ groupId, rank, place }]`。
- 回傳的是新物件，不回傳輸入物件的參照；結果不含 `answers`。需要答案的呼叫端以 `questionId` + `winner.rank` 到作答紀錄查詢（`docs/submission-record.md` 第 1 節：這組值可唯一指定一筆作答）。

替代方案：在結果中直接附上勝者的 `answers`。這會讓結果重複保存答案，學生端呼叫時也容易不小心把他組答案帶出去，所以不採用，由需要答案的呼叫端自己查。

### 2. 第一版的推導步驟

1. 檢查設定（第 3 點）。
2. 以 `questions` 的 `id` 建立題號集合；不在集合內的作答略過。
3. 每題取 `status === 'valid'` 的作答，依 `rank` 升冪排序（不假設輸入已排序），依序給 `place` 1、2、3…。
4. 有作答時 `winner` 為第 1 名，`winnerSource: 'arrival'`；沒有時兩者為 `null`、`placings: []`。
5. `settled` 一律為 `true`：未啟用公平順位時沒有判定中的狀態（`docs/submission-record.md` 第 2 節）。

`now` 在第一版不讀取。公平順位 change 加入時才用它判斷 3 秒批次是否結束。

### 3. 未支援的設定直接丟錯

`fairRankingEnabled === true` 或 `overrides` 有任何鍵時，丟出 `ResultsComputationError`，`code` 分別為 `FAIR_RANKING_NOT_SUPPORTED`、`OVERRIDE_NOT_SUPPORTED`。

替代方案：忽略設定、照先到先得回傳。目前沒有任何地方能設定這兩項，但如果之後的 change 先加了設定畫面卻忘了補推導邏輯，忽略會默默產生錯的結果，寫回試算表後很難發現。丟錯能讓問題在測試時就出現。這個錯誤只在 server 內部，不是 API 錯誤代碼，不寫入 `docs/api-contract.md`。

### 4. 輸入驗證只做到不出錯

輸入來自 server 自己的模組，不是使用者。函式不重新驗證 `answers` 或 `submittedAt`；`questions`、`submissions` 缺少時視為空陣列。

## Risks / Trade-offs

- [`add-buzz-in-submission` 合併時資料形狀改變] → 已核對 PR #8 的 `submissions.js`，欄位與排序一致；測試資料照它的形狀手寫，形狀若改變，`docs/submission-record.md` 必須先改。
- [公平順位加入後需要改動推導流程] → 第 2 點的步驟是「每題獨立」，公平順位需要「依題目判定先後累計成功題數」，屆時會改寫第 2、3 步；簽名與輸出不變，所以呼叫端不受影響。
- [每次全部重算] → 5,000 筆的排序在毫秒內完成；若之後監看頁頻繁呼叫造成負擔，再由呼叫端節流。
