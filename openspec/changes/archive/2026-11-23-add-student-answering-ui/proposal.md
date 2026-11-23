# Proposal: add-student-answering-ui

## Why

學生端目前只有選組與等待畫面，搶答中只顯示「作答功能即將開放」。`add-buzz-in-submission` 已提供讀題目、提交、取得本組作答狀態與組別限定的即時事件，學生端還沒有任何畫面使用它們，搶答無法實際進行。

## What Changes

- 搶答中顯示題號格，每題以文字標示狀態（未作答、草稿、已送出），點題號進入作答頁。
- 作答頁顯示該題的各個空格（前綴與提示）與輸入框；送出前在前端去除前後空白並驗證每格 1–200 字元、題組須全部填寫。
- 送出成功後該題鎖定並顯示「已送出」；同組其他裝置透過 `submission` 事件在 2 秒內同步鎖定；重新整理後由本組作答狀態恢復。
- 草稿只保存在本機瀏覽器，重新整理後恢復，送出成功後清除。
- 學生進場成功後，即時連線改為帶 `studentId` 的 `GET /api/events?studentId=...`；進場失效時回到選組畫面。
- 已結束時鎖定所有作答並顯示「活動已結束」。
- 搶答中畫面不顯示順位、他組是否送出或題目是否被搶走。
- 對應 `docs/explore_summary.md` 第 6 節第 4、5、6、7、8、10 項，以及 D4、D5、D7、D10、D23。

## Capabilities

### New Capabilities

- `student-answering-ui`：學生端搶答作答畫面、草稿、送出、鎖定與同步。

### Modified Capabilities

無。既有 `groups-and-entry` 的需求說明學生端「以 `GET /api/events` 同步階段」，帶可選的 `studentId` 參數仍是同一個端點，沒有牴觸；沒有 `studentId` 的行為不變。

## Impact

- **負責人**：學生端成員。
- **程式**：修改 `public/student/index.html`、`public/student/app.js`、`public/student/logic.js`、`public/student/logic.test.js`；新增 `public/student/drafts.js` 與 `public/student/drafts.test.js`。不修改 `server/`，也不修改 `docs/api-contract.md`。
- **依賴**：`add-buzz-in-submission` 已合併的端點與事件格式。
- **不在範圍**：結果頁（順位、最終勝者、結束後各題成功組別）、倒數顯示、教師端、作廢與公平順位、跨裝置草稿同步、server 變更。結果頁由 `add-student-results` 處理。
