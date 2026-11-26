# Proposal

## Why

共同契約有兩項本組還沒做：

- **D15 倒數**：老師開啟搶答時可選擇設定時間，時間到自動結束。
- **D19 重設**：已結束後重設回準備中，組別保留，作答清空。

SpecKit 組兩項都已實作。目前本組一場活動結束後只能重啟 server 才能再來一場，而重啟會連老師登入、組別與題目一起清掉。

D19 的細節已與 SpecKit 組談定（契約 v0.10，對方 PR #44）：

- 重設時作廢學生的進場狀態，已連線的學生也回選組頁，顯示「活動已重設，請重新選擇組別」；
- 組別保留，老師不用重新登入。

Demo 要示範多場活動，所以這兩項要在 Demo 前補上。

對應 `docs/explore_summary.md`：
- 第 2 節 D2（倒數結束視同老師結束）、D15、D19、D20（倒數 10–3600 秒）；
- 第 3 節模組表 `countdown`；
- 第 4 節第 7 點「階段同步」（倒數以 server 剩餘時間為準）。

## What Changes

**倒數（server 與教師控制台）**
- 開始搶答可帶倒數秒數。不帶就是不倒數；帶了就必須是 10 至 3600 的整數，否則拒絕，階段維持準備中。
- server 記錄倒數結束時間，時間到自動進入「已結束」，效果與老師按「結束搶答」相同。同時發生時只結束一次。
- 活動摘要與階段事件加上倒數結束時間，讓各端依 server 時間顯示一致的剩餘時間。
- 控制台「開始搶答」旁可勾選「設定倒數」並輸入分、秒；搶答中顯示剩餘時間。

**重設（server 與教師控制台）**
- 新增老師專用的重設端點，只在「已結束」可用。重設後：
  - 階段回「準備中」；
  - 清空作答（含已作廢）、所有學生進場紀錄、倒數與本場活動識別；
  - 保留組別、題目與學習單來源，也保留老師登入。
- 已連線的學生收到重設事件，連線隨後關閉。之後查詢舊進場時回傳新原因 `activity_reset`，與 server 重啟的 `entry_reset` 區分。
- 控制台在「已結束」顯示「重設活動」，按下後要再確認一次；取消時不變。

**不在範圍**
- 學生頁顯示倒數、處理重設事件與 `activity_reset` 的訊息：拆成學生端 change `add-student-countdown-and-reset`。
  - 本 change 合併後、學生端 change 完成前，已連線學生仍會被送回選組頁，只是顯示的是通用的失效訊息。
- 投影看板的倒數顯示：屬於 `add-projector-board`。
- server 重啟後保留倒數：本組狀態都在記憶體，重啟本來就會清空所有狀態。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `api-contract-and-session-lifecycle`：
  - 單向階段要求加入「已結束 → 準備中」的重設例外；
  - 活動摘要加入倒數結束時間；
  - 新增倒數自動結束、重設活動兩項要求。
- `groups-and-entry`：進場失效原因新增 `activity_reset`，重設後舊進場回傳此原因。
- `teacher-console`：
  - 開始搶答可設定倒數；
  - 新增顯示剩餘時間、重設需要確認兩項要求。

## Impact

- **程式**：
  - `server/index.js`：開始帶倒數、計時自動結束、重設端點、摘要與階段事件欄位、重設事件；
  - `server/groups-entry.js`：清除進場並記錄被重設的學生；
  - `public/teacher/console-logic.js`、`public/teacher/app.js`、`public/teacher/index.html`：倒數設定、剩餘時間、重設確認。
- **API**（更新 `docs/api-contract.md`）：
  - `POST /api/session/start` 可帶 `countdownSeconds`；新錯誤 `400 COUNTDOWN_OUT_OF_RANGE`；
  - `GET /api/session` 與 SSE `phase` 加上 `countdownEndsAt`；
  - 新增 `POST /api/session/reset`；
  - 新增 SSE `reset` 事件；
  - 進場原因新增 `activity_reset`。
- **依賴**：
  - 本分支從 `feat/student-void-notice` 開出，因為重設要清空作廢資料，而且同樣修改 `server/index.js`。作廢的兩個 PR 合併進 `main` 後，本 PR 才能合併。
  - 學生端 change `add-student-countdown-and-reset` 依賴本 change。
- **負責人**：本 change 包含 server 核心與教師端。學生端成員目前無法開發，由教師端成員一人負責。
