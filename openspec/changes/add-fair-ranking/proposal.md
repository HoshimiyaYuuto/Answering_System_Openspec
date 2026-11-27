# Proposal

## Why

共同契約 D14 公平順位與 D25 作廢重判已兩組同意（Confirmed，v0.5），SpecKit 組已實作（005），本組還沒有：

- `computeResults()` 只要收到 `fairRankingEnabled: true` 就丟出 `FAIR_RANKING_NOT_SUPPORTED`；
- 老師沒有地方可以選擇啟用。

這個功能是額外需求 E3。單純比快，會讓少數手快的組別拿走大部分題目，其他組別就失去參與的動機。

需要的介面早已預留，所以本 change 主要是補上判定規則與開關：
- 判定結果的 `settled`、`winnerSource`；
- 監看的「判定中」；
- CSV 第 8 欄的 `是（改判）`。

對應 `docs/explore_summary.md`：
- 第 2 節 D13（CSV 第 8 欄）、D14、D24、D25；
- 第 5 節模組表 `fair-ranking`；
- 判定規則細節見 `docs/submission-record.md` 第 2 節。

## What Changes

**判定規則（`server/results.js`）**
- `fairRankingEnabled: true` 時依 D14 判定：
  - 某題第一個有效作答送達後 3 秒內（含邊界）送達者為同一批；
  - 同批中「已判定題目的搶答成功題數」最少的組別優先，相同再比送達順序；
  - 批次外的作答依送達順序排在批內之後；
  - 題目依各自第一個有效作答的送達時間依序判定。
- **判定中**：批次的 3 秒還沒過完時，該題為判定中，沒有勝者，也不計入後面題目的成功題數。活動已結束時，所有題目都以當下的作答立即判定。
- **作廢重判（D25）**：結果每次都從作答紀錄重新推導，所以作廢搶答成功組後，該題以剩餘有效作答重判，後面已判定的題目也依新的成功題數連鎖重算。
- 不啟用時，行為與現在完全相同。移除 `FAIR_RANKING_NOT_SUPPORTED`；老師改選仍然拒絕。

**設定與 server**
- 開始搶答可帶 `fairRankingEnabled`，預設不啟用。設定只在開始時決定，搶答中與已結束都無法變更。重設活動後回到不啟用。
- 活動摘要與 `phase` 事件帶 `fairRankingEnabled`。
- 監看、結果、CSV、xlsx 下載、Google 試算表寫回、學生結果都改用同一組設定與判定時刻呼叫 `computeResults()`。
- 批次的 3 秒結束時，server 通知老師連線「監看資料已改變」，讓「判定中」在 2 秒內變成最終名次。
- 學生結果 API 增加「本場是否啟用公平順位」與「該題勝者是否因公平順位改判」兩個欄位，不含任何順位或組別識別碼。

**教師控制台**
- 「開始搶答」上方新增「啟用公平順位」勾選框，附一句規則說明，只在準備中可操作。
- 活動狀態顯示本場是否使用公平順位。
- 搶答結果中，因公平順位改判的題目標示「公平順位改判」。

**不在範圍**
- 學生頁顯示「本場使用公平順位」與「本題因公平順位改判」：拆成學生端 change `add-student-fair-ranking-notice`（SpecKit AC-005-11、AC-005-12）。
- 投影看板：屬於 `add-projector-board`。
- 調整 3 秒長度：D14 固定為 3 秒。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `question-results`：
  - 新增公平順位的判定、判定中、結束時立即判定、作廢連鎖重算；
  - 修改「Results are deterministic」（啟用時與判定時刻有關）；
  - 修改「Unsupported settings are rejected」（只剩老師改選）。
- `api-contract-and-session-lifecycle`：新增「開始搶答可選擇公平順位，摘要與階段事件帶出設定」。
- `teacher-console`：新增「開始前選擇公平順位，並顯示本場設定」。
- `teacher-monitoring`：
  - 新增「批次結束時通知老師」；
  - 修改「Console shows results after the session ends」，加上改判標示。
- `results-csv-export`：新增「CSV 依本場設定輸出公平順位欄」。既有的第 8 欄規則不變，這裡補上它和本場設定的對應。
- `student-results`：新增「結果回應包含是否啟用公平順位與改判標記」。

## Impact

- **程式**：
  - `server/results.js`；
  - `server/index.js`：設定、所有 `computeResults()` 呼叫點、批次結束通知；
  - `server/student-results.js`；
  - `public/teacher/console-logic.js`、`public/teacher/monitor-logic.js`、`public/teacher/app.js`、`public/teacher/index.html`。
- **API**（更新 `docs/api-contract.md`）：
  - `POST /api/session/start` 可帶 `fairRankingEnabled`，型別錯誤回 `400 INVALID_FAIR_RANKING`；
  - `GET /api/session` 與 SSE `phase` 加上 `fairRankingEnabled`；
  - `GET /api/student/results` 加上 `fairRankingEnabled` 與每題的 `winner.byFairRanking`。
- **文件**：
  - `docs/submission-record.md`：第 2 節改為「已實作」，補上「已結束時一律視為已判定」；
  - `docs/explore_summary.md`：模組表 `fair-ranking` 改為實作中。
- **依賴**：
  - 本分支從 `feat/student-countdown-and-reset` 開出，因為重設要清除設定，而且同樣修改 `server/index.js` 的開始搶答與摘要。
  - 前面四個 PR 合併進 `main` 後，本 PR 才能合併。
  - 學生端 change `add-student-fair-ranking-notice` 依賴本 change。
- **負責人**：explore_summary 原本把 `fair-ranking` 分給學生端成員。學生端成員目前無法開發，所以 server 與教師端由教師端成員一人負責。
