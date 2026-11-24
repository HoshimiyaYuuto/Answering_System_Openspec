# Proposal: add-teacher-monitoring

## Why

學生已經可以送出答案（`add-buzz-in-submission`），每題的勝者與名次也有共用的推導函式（`add-results-computation`），但老師端目前什麼都看不到：搶答中不知道哪些組送出了、送了什麼，結束後也看不到每題由誰搶答成功。這是 D9 與驗收 AC-000-05（老師端 A 為第 1、B 為第 2）、AC-000-07（結束後 2 秒內顯示結果）的前提，也是 Demo 的核心畫面。

## What Changes

- 新增老師專用的監看查詢：回傳每題的題目內容、各組的送出狀態（未送出／已送出／已作廢）、答案、送出時間、名次，以及每題的勝者與勝者來源。名次與勝者一律由 `computeResults()` 推導，不在監看另寫規則。任何階段都可查詢，需老師登入。
- 新增老師專用的即時通知：`GET /api/events` 以老師身分連線時，任何一組送出後都會收到通知，老師端收到後重新查詢監看資料。學生連線、未登入連線與公開事件不受影響，仍看不到任何作答資訊（D7、AC-S-07）。
- 老師控制台新增「作答監看」區塊：
  - 搶答中：每題一列，顯示已送出組數與第 1 名的組別與答案，可展開看各組的狀態、答案、送出時間與名次。
  - 已結束：同一個區塊改稱「搶答結果」，每題顯示勝者組別與答案；無人作答的題目標示「無人作答」。
  - 判定中（之後公平順位啟用時才會出現）的題目標示「判定中」。
- 同步更新 `docs/api-contract.md`。

不在本 change 範圍：作廢、老師改選、公平順位的操作與規則（只顯示 `computeResults()` 已提供的狀態）；各組是否在線；投影看板（D16）；CSV 匯出；學生結果頁（學生端成員的 `add-student-results`）。

對應 `docs/explore_summary.md`：第 2 節（教師端「監看、結果頁」）、第 3 節 D6、D7、D9、第 5 節 `teacher-monitoring-results`、第 7 節（server 為順位的唯一裁判）、第 9 節 AC-000-05、AC-000-07、AC-S-07。

## Capabilities

### New Capabilities

- `teacher-monitoring`：老師在搶答中與結束後檢視各題各組的送出狀態、答案、名次與勝者，包括監看查詢、老師專用的即時通知，以及控制台的監看區塊。

### Modified Capabilities

無。`/api/events` 新增的老師連線方式由本能力自己的 Requirement 規範，未以老師身分連線時的行為不變（與 `add-buzz-in-submission` 處理 `studentId` 參數的方式相同）。

## Impact

- **負責人**：教師端成員。
- **程式**：新增 `server/teacher-monitor.js`（組出監看資料的純函式）、`public/teacher/monitor-logic.js` 與各自的測試；修改 `server/index.js`（監看端點、老師事件連線）、`public/teacher/index.html`、`public/teacher/app.js`。
- **API**：新增 `GET /api/teacher/monitor`；`GET /api/events` 新增可選參數 `role=teacher`。須同步更新 `docs/api-contract.md`。
- **依賴**：學生端成員的 `add-buzz-in-submission`（PR #8：`submissions.listSubmissions()`、`submissions.subscribe()`、`/api/events` 的連線結構），以及教師端成員的 `add-results-computation`（PR #9：`computeResults()`）。兩者都合併到 main 後才 apply。
- **之後的 change 依賴本 change**：作廢（在監看區塊加作廢按鈕）、老師改選（在結果區塊加改選操作）、投影看板（可重用監看資料）。
- 相依套件：不新增。
