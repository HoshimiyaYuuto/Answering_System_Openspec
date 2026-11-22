# Tasks: add-results-computation

測試資料一律手寫，形狀與 `docs/submission-record.md` 第 1 節相同；不 import `server/submissions.js`，所以不需要等 `add-buzz-in-submission` 合併。

## 1. 推導函式

- [x] 1.1 新增 `server/results.js` 與 `server/results.test.js`：`computeResults()` 與 `ResultsComputationError`，依 design 第 1–4 節實作先到先得、過濾非 `valid`、無作答題目、依題號排序、忽略未知題號、未支援設定丟錯；驗證：`node --test server/results.test.js` 涵蓋 spec 的每個 Scenario（題號 5、1、3 排序；題號 99 被忽略；推導前後輸入以 `structuredClone` 比對相同；順位亂序輸入；作廢第 1 筆後由順位 2 勝出且名次連續；作廢後重送；無作答與只有作廢作答都得到 `settled: true`、`winner: null`、`winnerSource: null`、`placings: []`；不同 `now` 結果以 `deepStrictEqual` 相同；`fairRankingEnabled: true` 與 `overrides: { 1: 2 }` 丟出對應 `code`，`overrides: {}` 正常回傳），另加一個 50 組 × 50 題的案例（組數上限依 D20 統一為 50）確認每題名次 1–50 連續且結果在 100 毫秒內完成
- [x] 1.2 更新 `docs/submission-record.md` 第 2 節：補上「`winner` 為 null 時 `winnerSource` 也為 null」「結果不含 `answers`，需要答案時以 `questionId` + `winner.rank` 查作答紀錄」，以及「`fairRankingEnabled` 為 true 或 `overrides` 不是空的時，在對應 change 完成前會丟錯」；驗證：逐項對照 design 第 1、3 節與 `server/results.js` 的實際回傳，文件中的欄位名稱、null 規則與實作一致

## 2. 整合檢查

- [x] 2.1 確認本 change 沒有改動 `server/index.js` 與任何 API；驗證：`git diff --stat main` 只列出 `server/results.js`、`server/results.test.js`、`docs/submission-record.md` 與本 change 的規劃文件，`npm test` 全部通過，`openspec validate add-results-computation --strict` 通過

## Workflow follow-up

- 開 PR 請學生端成員 review，合併後執行 archive。
- `add-guided-notes-export` 以 `openspec-update-change` 改用 `computeResults()` 的 `winner`，移除自己的 `selectWinningAnswers()`。
