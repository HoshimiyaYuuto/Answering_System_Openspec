# Proposal

## Why

`add-fair-ranking` 已讓 server 依 D14 判定，學生結果 API 也多了 `fairRankingEnabled` 與 `winner.byFairRanking`。但學生頁還沒讀這兩個欄位。結果是：

- 學生不知道本場用公平順位；
- 本組明明最先送出，結果頁卻寫「本組第 2 名」，沒有任何說明，看起來像系統出錯。

D14 要求「結果與匯出標示是否啟用」。教師端的結果與 CSV 已經標示，學生頁是最後一個缺口。

對應 `docs/explore_summary.md`：
- 第 2 節 D14（結果標示是否啟用）；
- 第 5 節模組表 `student-results`、`fair-ranking`；
- 第 6 節第 9 項（結果頁）。

## What Changes

**結果頁說明**（只在已結束的結果區塊）
- 本場啟用公平順位時，在摘要下方顯示「本場使用公平順位」。未啟用時不顯示，畫面與現在相同。
- 某題勝者因公平順位改判時，該題列的成功組別後加註「（本題因公平順位改判）」。
- 說明一律以純文字顯示。
- 回應缺少這兩個欄位時（例如舊版 server），視為未啟用、未改判，不顯示說明。

**不在範圍**
- server 與 API：已由 `add-fair-ranking` 提供，本 change 不修改。
- 搶答中的畫面：學生看不到名次與他組資訊，所以不顯示「判定中」或公平順位說明。
- 教師控制台：已由 `add-fair-ranking` 完成。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `student-results`：新增「學生頁說明公平順位」的 requirement，規定本場標示、改判題目的加註，以及缺少欄位時的處理。

## Impact

- **程式**：`public/student/logic.js`（`buildResultsRows`）、`public/student/app.js`（`renderStudentResults`）、`public/student/index.html`（新增一個說明段落）。只動學生端。
- **測試**：`public/student/logic.test.js`。
- **依賴**：`add-fair-ranking` 提供的 `GET /api/student/results` 欄位。本分支從 `feat/fair-ranking` 開出，需在它合併後再合併。
- **API 與文件**：不變。契約中學生結果欄位已由 `add-fair-ranking` 寫入。
