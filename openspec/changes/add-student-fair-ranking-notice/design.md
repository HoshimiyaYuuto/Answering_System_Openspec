# Design

## Context

- `GET /api/student/results`（`add-fair-ranking`）已回傳：
  - 最上層 `fairRankingEnabled`（布林）；
  - 每題 `winner.byFairRanking`（布林；`winner` 為 `null` 時沒有）。
  - 名次 `own.place` 與 `isWinner` 已是公平順位判定後的結果。
- 學生頁結果的流程：`app.js` 的 `renderStudentResults()` 呼叫 `logic.js` 的純函式 `buildResultsRows()`，再用 `textContent` 填入 `#results-summary` 與 `#results-list`。`clearResultsView()` 在離開已結束時清空這些元素。
- 動機見 proposal.md「Why」。

## Goals / Non-Goals

**Goals**
- 說明文字由純函式產生，可以用 `node --test` 驗證，不需要瀏覽器。
- 未啟用時，`buildResultsRows` 既有輸出欄位的值不變（既有測試不需修改）。

**Non-Goals**
- 不說明「為什麼改判」（例如他組成功題數），因為那會洩漏他組資訊。

## Decisions

### 1. 在 `buildResultsRows` 加欄位，不另寫函式

`buildResultsRows(results)` 的輸出新增：
- `fairRankingNotice`：`results.fairRankingEnabled === true` 時為「本場使用公平順位」，否則為空字串。
- 每列 `winnerText`：`winner.byFairRanking === true` 時在既有文字後加「（本題因公平順位改判）」。

只有值為 `true` 才算，`undefined`、`null` 或其他值都視為否，這樣就涵蓋了「欄位缺少」的情境。

**替代方案**：每列另外加一個 `fairRankingNote` 欄位，由 `app.js` 拼接。

**不採用原因**：`app.js` 目前只把 `winnerText` 原樣放進畫面，直接在 `winnerText` 加註，畫面程式只需要處理摘要下方那一段，改動最小。

### 2. 摘要下方的說明元素

- `index.html` 在 `#results-summary` 後新增 `<p id="results-fair-ranking" class="hint" hidden></p>`。
- `loadStudentResults()` 原本只把 `questions` 傳給 `renderStudentResults()`，要一併傳入 `fairRankingEnabled`（apply 時發現）。
- `renderStudentResults()`：`textContent = view.fairRankingNotice`，空字串時 `hidden = true`。
- `clearResultsView()`：清空文字並隱藏，和其他結果元素一致。

### 畫面狀態機（結果區塊的新增部分）

| 畫面 | 條件 | 「本場使用公平順位」 | 題目列加註 |
|---|---|---|---|
| 準備中／搶答中 | 結果區塊隱藏 | 隱藏 | 無 |
| 結果載入中／載入失敗 | 尚未成功取得結果 | 隱藏 | 無 |
| 已結束，未啟用 | `fairRankingEnabled` 不為 `true` | 隱藏 | 無 |
| 已結束，啟用 | `fairRankingEnabled === true` | 顯示 | 僅 `byFairRanking === true` 的題目 |

| 事件 | 切換 |
|---|---|
| 結果載入成功 | 依上表顯示，內容整段取代 |
| 離開已結束（重設、換組、進場失效） | `clearResultsView()` 一併清空並隱藏 |

## Risks / Trade-offs

- **[風險] 本組最先送出卻是第 2 名，學生仍可能疑惑** → 該題列已加註改判，摘要下方也說明本場使用公平順位。規則細節由老師在課堂說明，學生頁不顯示他組成功題數。
- **[風險] 分支依賴 `feat/fair-ranking`** → 舊版 server 沒有這兩個欄位時，學生頁視為未啟用，所以先合併學生端也不會出錯；但說明要等 server 合併後才會出現。
