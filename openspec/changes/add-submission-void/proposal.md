# Proposal

## Why

共同契約 D24（2026-11-13 兩組已 Confirmed）規定搶答中老師可以作廢某組某題的作答，讓該組重送；SpecKit 組已實作，本組還沒有。作答紀錄格式早已預留 `status: 'voided'` 與 `voidedAt`（`docs/submission-record.md` 第 1 節），判定結果、監看、CSV 與寫回也已會排除已作廢的作答，只差「作廢」這個動作本身與後續重送。兩組功能必須一致，且公平順位的作廢重判（D25）要以此為基礎，所以現在先做。

對應 `docs/explore_summary.md`：第 2 節 D5、D24；第 3 節模組表 `void-submission`；第 4 節「隱私與推送」（作答變更只送老師與該組）。

## What Changes

- 新增老師作廢端點：已登入老師在「搶答中」以題號與該筆作答的接收順位作廢一筆有效作答。作廢只把紀錄改為已作廢並記下作廢時間，不刪除紀錄、不重用或遞補順位。
- 作廢後該組可重送同一題；重送是新的一筆，順位排在該題目前最大順位之後，其他組的順位不變。
- 作廢後立即通知：已登入老師的連線收到既有的「監看資料已改變」通知；只有被作廢組別的學生連線收到新的作廢事件（不含順位）。其他組與公開通道不會收到任何訊息。
- 學生查詢本組作答狀態時，回應新增「已作廢且尚未重送」的題目清單，讓學生頁重新整理後仍知道可以重送。原有 `submissions` 欄位的內容與形狀不變。
- 老師控制台的作答監看在搶答中，每筆有效作答旁顯示「作廢」按鈕，按下後需再次確認；已作廢的作答維持顯示「已作廢」。
- 判定結果、學生結果、CSV、xlsx 匯出與寫回不需修改：它們已只計有效作答。

不在本 change 範圍：學生頁顯示「已作廢，可重新送出」與重送流程的畫面（拆到學生端 change，見 Impact）；公平順位下的作廢重判（D25，隨 `add-fair-ranking` 加入）；結束後改選勝者（O3，兩組已決定不做）。

## Capabilities

### New Capabilities
- `submission-void`：老師在搶答中作廢某組某題的作答，包含端點規則、紀錄的狀態變化、重送資格、作廢通知的對象，以及老師控制台的作廢操作。

### Modified Capabilities
- `buzz-in-submission`：
  - 「每組每題只有一筆作答」改為「每組每題同時最多一筆有效作答」，作廢後可重送。
  - 本組作答狀態新增已作廢且尚未重送的題目。
  - 組別事件新增只送給該組的作廢事件。

## Impact

- **程式**：
  - `server/submissions.js`：新增作廢操作，讓重送可以通過查重。
  - `server/index.js`：新增作廢端點；作廢後通知老師與該組；本組作答狀態加上已作廢清單。
  - `public/teacher/monitor-logic.js`、`public/teacher/app.js`：在監看畫面加上作廢按鈕與確認。
- **API**：
  - 新增 `POST /api/teacher/submissions/void`。
  - `GET /api/student/submissions` 新增 `voided` 欄位，原有欄位不變，可相容。
  - `GET /api/events` 新增 `void` 事件，只送給帶有效 `studentId` 且屬於被作廢組別的連線。
  - 新增錯誤代碼。
  - 以上都要同步更新 `docs/api-contract.md`。
- **負責人**：
  - 本 change 由教師端成員負責。模組表原本把 server 的作廢資料模型分給學生端成員，但學生端成員目前無法開發，所以 server 部分也由本 change 處理，並更新 `docs/explore_summary.md` 模組表。
  - 學生頁的作廢提示與重送畫面另開學生端 change `add-student-void-notice`（修改 `student-answering-ui`）。該 change 依賴本 change 提供的 `void` 事件與 `voided` 欄位。在它完成前，學生頁重新整理後就能重送；server 端行為不受影響。
- **不受影響**：`server/results.js`、`server/results-csv.js`、Guided Notes 匯出與寫回、`server/student-results.js`。這些已會排除已作廢的作答，既有測試應維持通過。
