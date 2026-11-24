# Design: add-teacher-monitoring

## Context

動機見 proposal。目前狀態：

- `add-buzz-in-submission`（PR #8）：`createApplication` 有 `submissions` 選項；`submissions.listSubmissions()` 回傳 `{ questionId, groupId, answers, submittedAt, rank, status }`；`submissions.subscribe(listener)` 在每次成功送出後同步呼叫。`/api/events` 的連線改存成 `{ response, studentId? }`，送事件時以 `safeWrite()` 寫入，並在送出時才查詢學生的組別。
- `add-results-computation`（PR #9）：`computeResults({ questions, submissions, fairRankingEnabled, overrides, now })` 回傳每題 `{ questionId, settled, winner: { groupId, rank } | null, winnerSource, placings: [{ groupId, rank, place }] }`，不含答案。
- `session.questions` 每題有 `id`、`prompt`、`blanks`；`session.groups.list()` 回傳 `[{ id, name }]`。組別與題目只能在「準備中」變動，此時不會有作答。
- 老師身分以 HttpOnly cookie 的 token 判斷（`teacherAuth.isValid(token)`），登出或 server 重啟後 token 失效。
- 老師控制台：`console-logic.js`、`import-logic.js` 是純函式加測試，`app.js` 負責 fetch、SSE 與畫面；SSE `open` 時重新讀取權威快照。

## Goals / Non-Goals

**Goals:**

- 監看資料只有一個來源：server 每次查詢時用 `listSubmissions()` 與 `computeResults()` 現算，前端不自己排名。
- 學生與公開連線的事件內容與 PR #8 完全相同。

**Non-Goals:**

- 增量更新或差異推送：50 組 × 50 題最多 2,500 筆，整份重算與重傳即可。
- 作廢、改選的操作按鈕：之後的 change 在本區塊上加。
- 在線狀態：需要另外追蹤學生連線，與監看資料無關。

## Decisions

### 1. 監看資料的形狀（`GET /api/teacher/monitor`）

`requireTeacher`，任何階段可查。回應：

```json
{ "data": {
  "phase": "搶答中",
  "groupCount": 3,
  "questions": [{
    "id": 1,
    "prompt": "（1）首都為（2）人口最多的城市為",
    "settled": true,
    "winner": { "groupId": 1, "groupName": "第 1 組", "answers": ["甲", "乙"] },
    "winnerSource": "arrival",
    "submittedCount": 2,
    "entries": [
      { "groupId": 1, "groupName": "第 1 組", "rank": 1, "status": "valid", "place": 1, "answers": ["甲", "乙"], "submittedAt": "..." },
      { "groupId": 2, "groupName": "第 2 組", "rank": 2, "status": "valid", "place": 2, "answers": ["丙", "丁"], "submittedAt": "..." }
    ],
    "notSubmitted": [{ "groupId": 3, "groupName": "第 3 組" }]
  }]
} }
```

- `entries`：該題所有作答（有效與已作廢），依 `rank` 排序；`place` 取自 `computeResults()` 的 `placings`，已作廢為 `null`。
- `notSubmitted`：在該題沒有任何作答的組別，依組別 id 排序。只有作廢作答、尚未重送的組別出現在 `entries`（狀態為已作廢），不重複列在 `notSubmitted`。
- `submittedCount`：有效作答數。
- `winner`：`computeResults()` 的 `winner` 加上組名與那一筆的答案；判定中或無勝者時為 `null`。
- 組別已不存在時（目前不會發生，留給之後的重設活動），組名顯示 `組 <id>`。

組資料的函式放在 `server/teacher-monitor.js`：`buildMonitor({ phase, questions, groups, submissions, results })`，純函式，方便不經 HTTP 測試。`index.js` 只負責取資料：`results = computeResults({ questions: session.questions, submissions: all, now: Date.now() })`。

替代方案：直接把 `listSubmissions()` 和 `computeResults()` 原樣回傳，讓前端組合。不採用，因為前端要自己對應名次與答案，容易和 server 的規則分歧，也讓之後的投影看板要重寫一次。

### 2. 老師即時通知：只送「有變動」，前端重新查詢

- `GET /api/events?role=teacher`：先檢查 cookie，未登入回 401 `TEACHER_AUTH_REQUIRED` 且不建立連線；成功時連線存成 `{ response, teacherToken }`。
- `submissions.subscribe()` 的處理中，對每條有 `teacherToken` 且 `teacherAuth.isValid(teacherToken)` 的連線送 `event: monitor`，`data` 只有 `{ "serverTime": "..." }`。每次送出時才檢查 token，所以老師登出後連線雖然還在，也不會再收到通知。
- 階段改變沿用既有的 `phase` 事件，老師連線也會收到。
- 學生連線（`studentId`）與公開連線的判斷完全不變。

替代方案：

| 方案 | 取捨 |
| --- | --- |
| 每次送出推送整份監看資料（不採用） | 前端不用再查詢，但 50 組同時送出時要推 50 份完整資料 |
| 推送單筆作答，前端自行合併（不採用） | 名次要重算，等於在前端複製 `computeResults()` |
| 前端每秒輪詢（不採用） | 實作最簡單，但沒有送出時也一直查詢，且延遲取決於間隔 |
| **只通知有變動，前端重新查詢（採用）** | 資料只有 server 一個來源；配合第 4 點的節流，同時大量送出時查詢次數有上限 |

### 3. 前端狀態（`public/teacher/monitor-logic.js`）

純函式，風格比照 `import-logic.js`。

- 狀態：`{ data, requestSeq, loading, dirty }`。
- 事件：
  - `requestMonitor` → `requestSeq + 1`、`loading: true`、`dirty: false`。
  - `monitorLoaded({ seq, data })`：`seq` 不是最新的就丟棄；否則存 `data`、`loading: false`。
  - `monitorFailed({ seq })`：同樣丟棄過期的；否則 `loading: false`，保留舊資料。
  - `changed`（收到 `monitor` 或 `phase` 事件）：`loading` 中只設 `dirty: true`；否則要求重新查詢。
  - 查詢結束時若 `dirty` 為 true，再查一次。
- `getMonitorView(state)` 產生畫面用的文字：
  - 標題：「已結束」為「搶答結果」，其他為「作答監看」。
  - 準備中：提示「開始搶答後會顯示各組作答」，不列題目。
  - 每題一列：搶答中為「已送出 N／M 組」與第 1 名組別與答案；已結束為勝者組別與答案、「無人作答」或「判定中」。
  - 展開內容：每筆 entry 一行（名次或「已作廢」、組名、答案以「／」連接、送出時間轉本地時間 `HH:mm:ss`），之後列出未送出的組名。

### 4. 節流

同時只有一個監看請求在進行；期間收到的通知只會累積成一次後續查詢。這樣 50 組同時送出時，老師端最多連續兩次查詢，而不是 50 次。

### 5. 畫面

- `index.html` 在「活動狀態」之後新增「作答監看」區塊；每題用 `<details>`，`<summary>` 放題號與摘要。
- 一律以 `replaceChildren()` 與 `textContent` 重建，不累加，答案內容不經 `innerHTML`。
- 重建時保留使用者已展開的題目（以題號記住展開狀態），不會因為新的送出而收合。
- SSE `open`、進入控制台、登入後都讀一次；401 沿用既有的 `handleAuthError` 回到登入畫面。

### 6. 與 `docs/api-contract.md` 的一致性

- 新增「老師監看」一節：`GET /api/teacher/monitor` 的回應範例、欄位說明、401 錯誤。
- 在 `/api/events` 一節補上 `role=teacher` 與 `monitor` 事件，註明學生與公開連線不會收到。
- 沒有新的錯誤代碼。

## Risks / Trade-offs

- [PR #8 或 #9 在 review 中改了介面] → apply 前先把本分支更新到最新的 main，對照 Context 一節；介面不同時先停下來更新本 design。
- [`/api/events` 被兩個 change 修改] → 本 change 在 PR #8 合併後才實作，直接在它的 `{ response, studentId }` 連線結構上加 `teacherToken`，不另建連線集合。
- [每次查詢都重算 2,500 筆] → `computeResults()` 50 × 50 實測約 4 ms；監看資料約數百 KB，在區網內可接受。以 task 1.2 的效能測試確認。
- [老師登入失效後 EventSource 仍連著] → 不再收到 `monitor` 通知；下一次查詢回 401 時由 `handleAuthError` 帶回登入畫面。
- [答案含 HTML] → 只用 `textContent`，以測試確認 `<b>` 之類的答案原樣顯示。

## Migration Plan

不需資料遷移。回滾時移除監看端點、`role=teacher` 處理與控制台區塊即可，學生端不受影響。
