# Design: add-student-results

## Context

動機與範圍見 proposal。目前狀態：

- `server/results.js` 的 `computeResults({ questions, submissions })` 回傳每題 `{ questionId, settled, winner: { groupId, rank } | null, winnerSource, placings: [{ groupId, rank, place }] }`，第一版只支援先到先得，結果不含 `answers`。傳入公平順位或老師改選會丟錯。
- `submissions.listSubmissions()` 回傳每筆作答 `{ questionId, groupId, answers, submittedAt, rank, status }`。
- 學生端點的共用檢查：`studentId` 格式（400 `INVALID_STUDENT_ID`）→ `groups.lookup` 有效進場（403 `STUDENT_NOT_ENTERED`）。
- 學生頁（`public/student/`）已有「已結束」畫面，顯示「活動已結束」並停用作答。
- 所有學生端 API 與既有的 `GET /api/session`、`/api/groups` 回應都設定不快取。

## Goals / Non-Goals

**Goals:**

- 結束後學生能看到每題成功組別與答案、自己組的名次與是否成功。
- 結果只用 `computeResults()` 推導，與老師端一致；不新增判定規則。
- 絕不在「已結束」以前、或對沒有有效進場的人提供結果；回應只含 D8 規定的內容，不洩露他組的作答或名次。

**Non-Goals:**

- 公平順位、作廢、老師改選、老師端結果畫面、匯出、倒數、持久化。

## Decisions

### 1. 端點、檢查順序與錯誤代碼

`GET /api/student/results?studentId=...`，檢查順序：

1. `studentId` 格式 → `400 INVALID_STUDENT_ID`（既有）
2. 有效進場 → `403 STUDENT_NOT_ENTERED`（既有，沿用同一個共用檢查函式）
3. 階段須為「已結束」→ `409 RESULTS_NOT_AVAILABLE`（新增）

階段檢查放在進場檢查之後，與其他學生端點一致；準備中與搶答中一律不計算也不回傳任何結果。

### 2. 回應內容（白名單）

```json
{
  "data": {
    "questions": [
      {
        "questionId": 1,
        "blanks": [{ "index": 0, "prefix": "", "prompt": "第 1 題" }],
        "winner": { "groupName": "第 2 組", "answers": ["H2O"] },
        "own": { "place": 2, "isWinner": false, "answers": ["水"] }
      }
    ]
  }
}
```

- `winner`：該題沒有有效作答時為 `null`。只回組別名稱與答案，不回 `groupId` 與 `rank`。
- `own`：該學生所屬組別在該題有有效作答時才有；沒有作答為 `null`。`place` 取自 `computeResults` 的 `placings`，`isWinner` 為 `place === 1` 且與 `winner` 是同一筆。
- 不回傳任何其他組的名次、答案或組別識別碼，也不回傳 `settled`、`winnerSource`、`placings`。
- 題目依 `questionId` 由小到大。`blanks` 與公開題目端點的白名單相同，不含題目層 `prompt` 與儲存格位置。

替代方案：回傳完整 `placings` 讓前端自行篩選，較省事，但會把他組名次送到每個學生的瀏覽器（雖然畫面不顯示），違反「只給學生他該看的資料」的原則，不採用。

### 3. 資料組裝

新增 `server/student-results.js` 的純函式 `buildStudentResults({ questions, submissions, groups, groupId })`：

1. `computeResults({ questions, submissions })`，不傳公平順位與老師改選。
2. 對每題，以 `questionId + winner.rank` 到作答紀錄找出勝者那一筆取 `answers`；以 `groups` 的對照取 `groupName`；找不到組別名稱時用「（已移除的組別）」，不暴露識別碼。
3. 自己組的名次從 `placings` 找 `groupId === groupId` 的那一筆；自己組的答案取該筆作答的 `answers`。

端點在每次請求時呼叫，不快取：結果只在「已結束」讀取，而活動重設（D19）之後資料會清掉，即時推導最不容易過期。100 組 × 50 題時每次推導的成本為資料量的線性，task 3.1 以 100 位學生同時讀取驗證。

### 4. 學生頁畫面與狀態

「已結束」畫面新增結果區塊，子狀態：`loading`（讀取中）、`loaded`（顯示結果）、`error`（讀取失敗，顯示訊息與重試按鈕）。

- 摘要：「本組成功 K 題／共 N 題」，K 是 `own.isWinner` 的題數。
- 每題一列：題號、成功組別與答案（題組以「（1）答案」「（2）答案」依空格排列，單題直接顯示答案）、本組名次與是否成功；沒有人作答顯示「無人作答」；本組沒有作答顯示「本組未作答」。
- 一律使用 `textContent` 寫入答案、組名與提示，不使用 `innerHTML`。
- 進入「已結束」（階段事件或重新整理後恢復）時讀取結果；已經載入過就不重複讀取，重試按鈕才會重新讀取。
- 讀取回 403 時回到選組畫面並說明進場狀態已失效（與既有行為一致）；回 409（階段並非已結束，例如重設後）時重新確認階段並移除結果區塊；網路錯誤顯示「無法載入結果，請稍後再試」。

純函式放在 `logic.js`：`formatAnswers(blanks, answers)`（組出顯示文字）、`buildResultsRows(results)`（組出每列要顯示的文字與是否本組成功）、`getResultsLoadNextStep(status)`（把 403、409、網路錯誤對應到動作），以便以 `node --test` 驗證，DOM 只做接線。

### 4.1 搶答資料快照與事件同步

- 搶答期間，`loadAnsweringData()`、`synchronizeFromServer()`、`refreshSubmissions()` 讀回的本組作答快照與目前記憶體中的作答取聯集，不得直接以快照覆蓋。合併以 `questionId` 去重；快照只補入記憶體中尚無的作答，已由本機 POST 或 SSE 事件收到的作答保留。相同題目的事件與 POST 回應仍以既有冪等套用邏輯處理。
- 每次請求作答快照時記錄當時的 `studentId` 與 `groupId`；回應套用前確認仍是同一個有效進場，若識別碼、組別或有效進場已改變，丟棄該過期回應，不讓舊組資料回填。
- 聯集只適用於相同的有效進場組別及搶答資料生命週期。組別改變或進場狀態失效時清除舊組作答，避免把舊組資料帶入新組畫面。搶答期間本組有效作答只增加、不因較舊快照而減少。
- server 不會在 SSE 連線建立時傳送初始作答狀態。因此 studentId EventSource 第一次成功觸發 `open` 時也呼叫 `synchronizeFromServer()`；後續重連成功時同樣同步階段與本組作答，補回事件空檔期間的狀態。
- EventSource 因 CLOSED 而觸發進場確認時，`STUDENT_NOT_ENTERED` 仍立即回到選組畫面；暫時網路錯誤則保留目前畫面與進場狀態，延遲 3 秒後重試確認。每條目前有效的連線最多保留一個待執行重試計時器；連線被取代、進場確認成功或已判定進場失效時取消計時器。重試期間不建立重複連線，也不刪除草稿。

### 4.2 草稿依活動隔離

- server 每次成功開始搶答時產生新的 UUID `activityId`，並在該場活動期間保持不變。`GET /api/session` 回傳目前的 `activityId`；首次開始前為 `null`。development 階段路由直接切入「搶答中」時，也依相同規則建立識別碼。
- 學生端在載入搶答資料及同步 session 時讀取 `activityId`，草稿儲存 key 使用 `activityId`、`studentId` 與 `questionId` 組成。沒有有效 `activityId` 時不讀取或寫入草稿。
- 同一場活動重新整理後仍使用同一 key，因此草稿可恢復；下一場開始會取得不同 `activityId`，不會載入上一場草稿。舊格式草稿不會被新場次讀取。
- `activityId` 是不透明場次識別，不帶組別或作答狀態；公開摘要不增加任何作答資訊。

### 5. 隱私與一致性

- 結果與老師端使用同一個 `computeResults()`；若老師端與學生端顯示不同名次，就是這個函式之外有人另寫了規則，視為缺陷。
- 學生端結果只含 D8 規定的內容。測試以「回應 JSON 序列化後不含他組 `groupId`、任何 `rank` 欄位與他組答案」斷言，而不只檢查欄位名稱。
- 這個 change 不處理公平順位與老師改選；`computeResults` 遇到那兩個選項會丟錯，端點不會傳入，所以不會默默算錯。日後支援時必須同步修改本端點與其測試。

### 6. 與 docs/api-contract.md 的一致性

新增一個「學生結果」章節與 `409 RESULTS_NOT_AVAILABLE`，沿用 `{"data"}`／`{"error"}` envelope 與既有的 `INVALID_STUDENT_ID`、`STUDENT_NOT_ENTERED`；既有章節逐字不動。

## Risks / Trade-offs

- [100 位學生在結束後同時讀取] → 每次請求是純函式推導加一次作答紀錄查詢；在 `capacity-check.js` 驗證 100 位學生同時讀取 5,000 筆作答的耗時（門檻於 task 3.1 以首次量測為準後記錄）。
- [畫面顯示他組組名與答案] → 這是 D8 明定的內容（成功組別與其答案），並且只在已結束後提供。
- [公平順位或改選日後加入時，端點可能默默漏處理] → `computeResults` 會丟錯，且本 design 與測試都註明需同步修改。
- [記憶體狀態，server 重啟後結果消失] → 與其他功能一致；學生頁收到 403 時回到選組畫面。

## Migration Plan

不需遷移。回滾時移除端點、`student-results.js` 與學生頁的結果區塊即可。

## Open Questions

- 結果是否要在老師結束後自動顯示，還是讓學生按「查看結果」：先採自動顯示。
- 題目很多時結果列表是否需要摺疊：先用可捲動列表，之後依實際使用回饋調整。
