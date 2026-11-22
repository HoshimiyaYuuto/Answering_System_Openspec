# Proposal: add-buzz-in-submission

## Why

目前 server 雖保存匯入題目與學生進場資料，卻沒有讓學生讀題、提交答案或取得本組作答狀態的 API。建立這些能力後，各組才能在同一題上公平競速，並在重新整理或同組多裝置之間恢復與同步狀態，同時避免學生從任何回應推知他組的進度。

## What Changes

- 新增學生讀取題目、提交整題答案、讀取本人組別作答狀態的 API。
- 依進場紀錄所屬組別記錄每題答案與 server 接收順位；成功提交後該組該題鎖定，答案不判斷對錯。順位只在 server 內部保存，本 change 不對學生公開。
- `GET /api/events` 可選擇帶 `studentId`，讓該組連線額外收到只屬於本組的作答事件；公開階段事件與 `GET /api/session` 不帶任何作答資訊。
- 將 development 的 50 題種子改為符合匯入題目的 `id`、`prompt`、`blanks` 結構，僅在 development 啟用。
- 對應 `docs/explore_summary.md`：第 3 節 D4、D5、D6、D7、D10、D23；第 6 節第 5、6 項（server 端部分）；第 7 節；第 9 節 AC-000-05、AC-S-02、AC-S-07、AC-S-08；第 11 節第 4 項。

## Capabilities

### New Capabilities

- `buzz-in-submission`：學生讀取搶答題目、提交答案、取得本組提交狀態，以及只限本組的即時同步。

### Modified Capabilities

無。既有 `api-contract-and-session-lifecycle` 與 `groups-and-entry` 的 Requirement 不需改寫：`/api/events` 新增的可選參數與 `submission` 事件由本能力自己的 Requirement 規範，沒有 `studentId` 的連線行為不變。

## Impact

- **負責人**：學生端成員。
- **程式**：新增 `server/submissions.js` 與測試；修改 `server/index.js`（路由、SSE 訂閱、development 種子）；`server/capacity-check.js`（送出負載場景）。`server/groups-entry.js` 預期只需匯出或沿用既有 `lookup`，不改進場規則。
- **契約**：`docs/api-contract.md` 新增端點、錯誤代碼與檢查順序，並把「待補的公開題目格式」改為正式定義。
- **依賴**：已歸檔的 `add-guided-notes-import` 所寫入的 `session.questions`（`{ id, prompt, blanks[] }`），不改其輸出。
- **之後的 change 依賴本 change**：`add-student-answering-ui`、`add-student-results`（公布順位與勝者）、教師端監看（讀取作答）、作廢與公平順位。
- **不在範圍**：學生端畫面、結果頁與順位公布、教師端 API 與畫面、作廢（D24）、公平順位（D14、D25）、改選勝者（O3）、倒數、csv 與匯出、活動重設、資料持久化。
