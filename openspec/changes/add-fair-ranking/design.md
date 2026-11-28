# Design

## Context

**`server/results.js` 的 `computeResults`**
- 目前只做先到先得與過濾作廢。
- `fairRankingEnabled === true` 時丟出 `FAIR_RANKING_NOT_SUPPORTED`；註解寫明 `now` 參數保留給公平順位，第一版不讀取。
- 輸出格式在 `docs/submission-record.md` 第 2 節已定好：`settled`、`winner`、`winnerSource`（`'arrival'` 或 `'fair'`）、`placings`。演算法也已寫在同一節的第 3 點。

**呼叫 `computeResults` 的地方**
- `server/index.js`：xlsx 下載與寫回（`currentWinners`）、監看、CSV；
- `server/student-results.js`：學生結果。

全部都沒有傳 `fairRankingEnabled`；監看、CSV、寫回傳了 `now: Date.now()`，學生結果沒有傳。

**下游已經能處理新欄位**
- `results-csv.js`：已依 `fairRankingEnabled` 與 `winnerSource` 輸出第 8 欄，只差 server 沒有把設定傳進去。
- `teacher-monitor.js`：已輸出 `settled` 與 `winnerSource`。
- `monitor-logic.js`：已把 `settled === false` 顯示為「判定中」，但還沒有顯示改判。

**`add-countdown-and-reset` 已提供**
- `POST /api/session/start` 讀 body；
- `sessionSummary()` 與 `publishPhase()` 集中產生摘要；
- `endSession()`、重設端點、可注入的 `now` / `scheduleTimeout` / `cancelTimeout`。

**老師通知**：送出與作廢時都對老師連線送 `event: monitor`，兩處各寫一份迴圈。

**SpecKit 005**：判定是衍生計算、不另外保存；作廢後連鎖重算；活動結束時未判定的題目立即判定；3 秒含邊界。本設計的可觀察行為與其一致。

## Goals / Non-Goals

**Goals**
- 依 D14、D25 判定，所有呼叫端看到同一份結果。
- 「判定中」在 3 秒批次結束後 2 秒內變成最終名次，即使沒有新的送出。
- 不啟用時，行為與現在完全相同（既有測試不需修改）。

**Non-Goals**
- 學生頁的公平順位提示：由 `add-student-fair-ranking-notice` 負責。
- 投影看板、3 秒長度可調整、老師改選。

## Decisions

### 1. `computeResults` 的公平順位演算法

簽章不變：`computeResults({ questions, submissions, fairRankingEnabled = false, overrides = {}, now = Infinity })`。

- `now` 省略時視為 `Infinity`，也就是所有批次都已結束。
  - 既有呼叫與測試都沒有傳 `now`，或在不啟用時傳 `Date.now()`，結果都不受影響。
  - 已結束時 server 傳 `Infinity`（見第 2 節）。
- 未啟用時，沿用現有程式路徑。

啟用時：

1. **分題**：依題目分出有效作答。
   - 每題的 `first` = 原始接收順位（`rank`）最小的有效作答；
   - `t0 = Date.parse(first.submittedAt)`。
   - 以 `rank` 決定 `first` 而不是時間，因為 `rank` 才是送達順序的權威，而且兩者一致。
2. **排序**：有有效作答的題目依 `(t0, questionId)` 排序，作為判定順序。
3. **逐題判定**：維護 `wins: Map<groupId, number>`，依判定順序處理每一題。
   - `now < t0 + 3000`：判定中。`placings` 依 `rank` 排序，`winner` 與 `winnerSource` 為 `null`，`settled: false`，不更新 `wins`。
   - 否則：
     - 同批 = `Date.parse(submittedAt) <= t0 + 3000` 的作答；
     - 同批依 `(wins.get(groupId) ?? 0, rank)` 排序，批次外依 `rank` 排序，兩者串接後編號 `place`；
     - `winner` 為第 1 名，`winnerSource` 為 `winner.rank === first.rank ? 'arrival' : 'fair'`；
     - 勝者組別的 `wins` 加 1。
4. **輸出**：沒有有效作答的題目照舊為 `settled: true`、`winner: null`。最後依題號排序輸出。

**正確性**
- 判定中的題目一定排在判定順序的後段：只要某題未結束，所有 `t0` 更晚的題目也未結束，所以「不計入後面題目的成功題數」自然成立。
- 作廢只會讓作答從「有效」中消失，下一次推導就用剩餘的作答重新算出 `first`、`t0` 與 `wins`，D25 的連鎖重算不需要額外程式。

**替代方案**：把每題的判定結果存起來，作廢時再找出受影響的題目重算。

**不採用原因**：
- 違反 `submission-record.md`「判定結果不儲存，每次推導」的約定；
- 增量更新容易出錯；
- 一場最多 50 題、100 組，每次全部重算只要幾毫秒（capacity-check 的 5000 筆作答約 1 秒內完成送出）。

### 2. 設定與判定時刻（`server/index.js`）

- `session.fairRankingEnabled` 預設 `false`。
- **開始搶答**：在倒數檢查之後檢查 `fairRankingEnabled`。
  - `undefined` 視為 `false`；
  - 不是布林值時回 `400 INVALID_FAIR_RANKING`，訊息「公平順位設定必須是是或否。」；
  - 通過後，在開始成功時寫入 `session.fairRankingEnabled`。
- **重設**：設回 `false`。開發用的 phase 路由不改這個設定。
- `sessionSummary()`、`publishPhase()`、開始成功的回應都加上 `fairRankingEnabled`。
- 新增 `judgeResults(all)`：

  ```js
  computeResults({
    questions: session.questions,
    submissions: all,
    fairRankingEnabled: session.fairRankingEnabled,
    now: session.phase === '已結束' ? Infinity : currentTime(),
  })
  ```

  監看、CSV、`currentWinners`、學生結果都改為呼叫它，CSV 另外把 `fairRankingEnabled` 傳給 `buildResultsCsv`。
- `buildStudentResults` 不再自己呼叫 `computeResults`，改為接受呼叫端傳入的 `results` 與 `fairRankingEnabled`。這和 `buildMonitor`、`buildResultsCsv` 的做法一致。

**替代方案**：用獨立端點 `PUT /api/session/settings` 在準備中設定。

**不採用原因**：設定只在開始時有意義。放進開始的 body，就自然做到「搶答中與已結束不能變更」，不需要另外處理階段檢查與同步。SpecKit 的 Socket.IO 事件名稱不同，但可觀察行為相同：準備中選擇、預設不啟用、開始後不能改。

### 3. 批次結束通知

- 把兩處老師通知迴圈抽成 `notifyTeachers()`。
- 新增 `scheduleBatchNotice()`：
  - 未啟用或不在搶答中時，清除計時器並結束；
  - 否則計算所有題目中「`t0 + 3000` 大於現在」的最小值，取消舊計時器，以 `scheduleTimeout` 排在那個時間點後 50 毫秒；
  - 時間到時先 `notifyTeachers()`，再呼叫一次 `scheduleBatchNotice()` 排下一題。
- **呼叫時機**：每次送出成功、每次作廢之後（作廢可能讓某題的 `t0` 往後移）。
- `endSession()` 與重設時清除計時器。
- 每次最多只有一個計時器，題目再多也不會累積。

### 4. 學生結果欄位

- 回應最上層加 `fairRankingEnabled`。
- `winner` 加 `byFairRanking: result.winnerSource === 'fair'`。
- 不輸出 `winnerSource` 字串、`rank` 或組別 id，既有「不洩漏」的測試仍然成立。

### 5. 教師控制台

**`console-logic.js`**
- `getConsoleControls` 新增 `canEditFairRanking`（等同 `canEditCountdown`）。
- 新增純函式 `describeFairRanking(summary)`：
  - 準備中或摘要尚未載入時回傳空字串；
  - 其他階段回傳「啟用」或「不啟用」。

**`monitor-logic.js`**
- `summaryOf` 在已結束且 `winnerSource === 'fair'` 時，於答案後加「（公平順位改判）」。
- 展開的明細改為依名次列出有效作答，已作廢的依送達順序排在最後。server 的 `entries` 仍依 `rank` 排列，排序只在畫面這層做。原本依送達順序列出，在先到先得時就等於名次；公平順位改判後兩者可能不同，照送達順序會出現「第 2 名」排在「第 1 名」上面（demo 時發現）。

**`index.html`**
- 在倒數設定下方新增 `#fair-ranking` 勾選框與規則說明；
- 活動狀態新增 `#fair-ranking-label`、`#fair-ranking-state`。

**`app.js`**
- 開始時把 `fairRankingEnabled: fairRanking.checked` 放進 body；
- 依 `canEditFairRanking` 停用勾選框；
- `renderConsole` 顯示 `describeFairRanking`，空字串時隱藏該列。

### 畫面狀態機（控制台「活動狀態」區塊的新增部分）

| 畫面 | 條件 | 公平順位勾選框 | 「公平順位」列 |
|---|---|---|---|
| 準備中 | 階段為準備中，閒置 | 可操作 | 隱藏 |
| 開始中 | `action = starting` | 停用 | 隱藏 |
| 搶答中 | 階段為搶答中 | 停用 | 顯示「啟用」或「不啟用」 |
| 已結束 | 階段為已結束 | 停用 | 顯示「啟用」或「不啟用」 |

| 事件 | 切換 |
|---|---|
| 勾選後按開始，成功 | 準備中 → 搶答中，顯示「啟用」 |
| 開始失敗 | 回到準備中，勾選狀態保留 |
| 重設 | 已結束 → 準備中，「公平順位」列隱藏；勾選框維持老師上次的選擇，但 server 已回到不啟用，下次開始依勾選框送出 |

「搶答結果」區塊：已結束時，勝者因公平順位改判的題目加註「（公平順位改判）」。搶答中的監看沿用既有的「判定中」顯示，不另外標示。

### 6. 與 `docs/api-contract.md` 的一致性

需要更新契約的地方：

- `POST /api/session/start` 的 body 可帶 `fairRankingEnabled`；新增錯誤 `400 INVALID_FAIR_RANKING`；檢查順序在倒數之後。
- `GET /api/session`、SSE `phase`、開始成功的回應加上 `fairRankingEnabled`。
- 「老師監看」一節：補充啟用時 3 秒批次結束也會送 `monitor` 通知。
- 「學生結果」一節：加上 `fairRankingEnabled` 與 `winner.byFairRanking`。
- 重設一節：清空的資料加上公平順位設定。

既有欄位不改名；不啟用時所有回應的既有欄位與現在相同。

## Risks / Trade-offs

- **送達時間的精度**：`submittedAt` 是毫秒精度的 ISO 字串，3 秒邊界以毫秒比較。同一毫秒內的送出由 `rank` 決定先後，與 SpecKit 一致。
- **判定中時的名次**：在監看上暫時依送達順序顯示，3 秒後可能改變。這是 SpecKit AC-005-08 要求的行為，監看會標示「判定中」。
- **server 重啟會清空設定**：與所有狀態一樣存在記憶體，重啟後要重新開始。
- **學生頁暫時看不到公平順位的說明**：要等學生端 change 完成。在那之前，學生結果頁仍顯示正確的勝者與自己的名次，只是不會說明「改判」。
