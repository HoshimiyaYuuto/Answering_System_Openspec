# Design

## Context

- 作答紀錄存在 `server/submissions.js` 的記憶體陣列，每筆有 `questionId`、`groupId`、`answers`、`submittedAt`、`rank`、`status`。
  - 查重用 `validByQuestionAndGroup`（題號＋組別 → 有效作答）。
  - 順位用每題的計數器 `nextRankByQuestion`，給出後不重用。
  - 目前 `status` 只會是 `'valid'`。
- `docs/submission-record.md` 第 1 節已約定：
  - 作廢只把 `status` 改為 `'voided'`，並寫入 `voidedAt`。
  - 不刪除紀錄、不遞補順位。
  - 重送的 `rank` 排在該題目前最大值之後。
- 已會排除非有效作答的地方：`computeResults()`、`buildMonitor()`、`buildStudentResults()`、CSV、xlsx 匯出與寫回。監看的 `entries` 已列出 `voided`，前端也已能顯示「已作廢」。
- 即時通知：
  - `submissions.subscribe()` 在每次送出後呼叫監聽者。
  - `server/index.js` 依 `studentId` 目前所屬組別，把 `submission` 事件送給同組連線，並送 `monitor` 通知給已登入老師的連線。
- 共同契約 D24：只能在搶答中作廢；作廢事件只送老師與該組；其他組順位不變。SpecKit 已實作（Socket.IO），本組只需對齊可觀察行為。

## Goals / Non-Goals

**Goals**
- 老師在搶答中作廢一筆有效作答，該組可重送。
- 作廢後老師畫面與該組在 2 秒內收到通知，其他人收不到任何線索。
- 學生重新整理後，仍能從本組作答狀態得知哪些題目被作廢、可以重送。
- 不改變判定結果、匯出與學生結果的程式。

**Non-Goals**
- 學生頁的作廢提示與重送畫面：由學生端 change `add-student-void-notice` 負責。
- 公平順位下的作廢重判（D25）：由 `add-fair-ranking` 負責。因為 `computeResults()` 每次都從作答紀錄重新推導，到時不需改動本 change 的資料。
- 復原作廢：D24 沒有定義，不做。

## Decisions

### 1. 以「題號＋順位」指定要作廢的作答

`POST /api/teacher/submissions/void`，body 為 `{ "questionId": 1, "rank": 1 }`。

- **替代方案**：改用「題號＋組別」指定。
- **不採用原因**：老師連按兩次時，第一次作廢後該組可能已經重送，第二次請求就會作廢掉新的那筆。順位每筆唯一且不重用，第二次請求會回 `409 ALREADY_VOIDED`，不會誤作廢。
- 順位只出現在老師監看資料中，不會因此洩露給學生。

### 2. 檢查順序與錯誤代碼

檢查順序比照學生端「格式 → 進場 → 階段 → 內容」，依序為：

1. 未登入 → `401 TEACHER_AUTH_REQUIRED`（沿用 `requireTeacher`）
2. `questionId` 或 `rank` 不是正整數 → `400 INVALID_VOID_REQUEST`
3. 階段不是「搶答中」→ `409 VOID_NOT_ALLOWED`
4. 題號不存在 → `404 QUESTION_NOT_FOUND`（沿用學生送出的代碼）
5. 該題沒有這個順位 → `404 SUBMISSION_NOT_FOUND`
6. 該筆已作廢 → `409 ALREADY_VOIDED`

成功回 `200`：

```json
{ "data": { "questionId": 1, "groupId": 2, "rank": 1, "voidedAt": "2026-11-25T00:00:00.000Z" } }
```

被拒絕時不改紀錄、不發事件。

- **替代方案**：用 `DELETE /api/teacher/submissions/:questionId/:rank`。
- **不採用原因**：作廢不是刪除，紀錄會保留；用 POST 動作端點語意比較清楚，也和 `/api/session/start` 的風格一致。

### 3. `submissions.js` 新增同步的 `voidSubmission()`

```js
voidSubmission({ questionId, rank }) // → { ok: true, submission } | { ok: false, code }
```

- 在同一個同步區段完成以下步驟，中間沒有 `await`：
  1. 找到該筆作答。
  2. 檢查狀態。
  3. 改為 `status: 'voided'`，並寫入 `voidedAt: now().toISOString()`。
  4. 從 `validByQuestionAndGroup` 移除該組該題。
- Node 單執行緒，所以作廢和同組重送不會交錯：重送若先到，回 `ALREADY_SUBMITTED`；作廢若先到，重送成功並拿到下一個 `rank`。`nextRankByQuestion` 不動，所以被作廢的號碼不會重用。
- 有效作答在建立時都寫入 `voidedAt: null`，和 `submission-record.md` 一致。`voidedAt` 只出現在 server 內部與老師資料，學生 `submission` 事件與回應仍只取既有欄位。
- 通知用另一組監聽者 `subscribeVoid(listener)`，不改變既有 `subscribe()` 的呼叫時機與參數。
  - **替代方案**：讓 `subscribe()` 的監聽者收到 `{ type, submission }`。
  - **不採用原因**：會改動既有呼叫端與測試，範圍變大。
- `listByGroup(groupId)` 維持只回有效作答。另外新增 `listVoidedPendingByGroup(groupId)`，回傳該組「有作廢紀錄、但目前沒有有效作答」的題目：`{ questionId, voidedAt }`。同題被作廢多次時，取最後一次的作廢時間，依題號排序。

### 4. 通知

`server/index.js` 透過 `subscribeVoid` 做兩件事：
- 對每條帶 `studentId` 的連線，依其目前的進場狀態查詢組別。組別是被作廢組時，送出：

  ```text
  event: void
  data: {"questionId":1,"voidedAt":"..."}
  ```

  這和既有 `submission` 事件的對象判斷相同。
- 對已登入老師的連線送既有的 `monitor` 通知。老師端已會在收到時重新讀取監看資料，所以前端不需新增事件處理。

不新增公開事件，`GET /api/session` 不變。

### 5. 本組作答狀態新增 `voided`

`GET /api/student/submissions` 回應：

```json
{ "data": { "submissions": [ ... ], "voided": [ { "questionId": 1, "voidedAt": "..." } ] } }
```

- `submissions` 的內容與形狀不變，所以舊的學生頁不會壞。舊學生頁重新整理後，被作廢的題目不在 `submissions` 中，會顯示為可作答，因此已經可以重送。
- **替代方案**：把已作廢的作答放進 `submissions`，並加上 `status`。
- **不採用原因**：會改變既有欄位的語意，舊學生頁會把已作廢的題目當成已送出而鎖住。

### 6. 老師控制台

- `monitor-logic.js` 的 `detailsOf()` 只在 `data.phase === '搶答中'` 且 `entry.status === 'valid'` 時，為該行加上 `voidAction: { questionId, rank, groupName }`。這是純函式，可以測試。
- `app.js` 渲染詳細列時，有 `voidAction` 就加一顆「作廢」按鈕。按下後呼叫 `window.confirm('確定作廢「<組名>」第 <題號> 題的作答？該組可重新送出。')`：
  - 確認後才送出 POST，請求期間按鈕停用。
  - 成功時不需自行改畫面，等 `monitor` 通知後重新讀取即可。
  - 失敗時在監看提示區顯示錯誤訊息；遇到 401 時沿用 `handleAuthError` 回登入畫面。
- 按鈕用事件委派掛在 `#monitor-list` 上，因為監看畫面每次都會以 `replaceChildren` 重繪。
- **替代方案**：自訂確認對話框。
- **不採用原因**：原生 `confirm` 已能滿足「需再次確認」的需求，工作量最小。

### 畫面狀態機（老師控制台的作答監看區）

| 畫面 | 由什麼決定 | 作廢按鈕 |
|---|---|---|
| 讀取中 | `monitorState.data` 為 null | 無 |
| 準備中提示 | `data.phase === '準備中'` | 無 |
| 搶答中監看 | `data.phase === '搶答中'` | 每筆 `status: 'valid'` 的作答旁顯示 |
| 搶答結果 | `data.phase === '已結束'` | 無 |

| 事件 | 結果 |
|---|---|
| 按下「作廢」 | 跳出原生確認 |
| 確認 | 按鈕停用並送出請求 |
| 取消 | 回到原畫面 |
| 請求成功 | 收到 `monitor` 通知 → 重新讀取 → 該作答顯示「已作廢」，按鈕消失 |
| 請求失敗 | 提示區顯示錯誤，按鈕恢復 |
| 回 401 | 回登入畫面 |
| 階段事件變為「已結束」 | 重新讀取 → 進入搶答結果畫面，按鈕全部消失 |

### 與 `docs/api-contract.md` 的一致性

需要同步更新：
- 新增「作答作廢」章節，內容包含端點、檢查順序、錯誤表與 PowerShell 範例。
- 「搶答送出」章節：
  - `GET /api/student/submissions` 的 `voided` 欄位。
  - `GET /api/events` 的 `void` 事件。
  - `ALREADY_SUBMITTED` 的說明改為「目前已有有效作答」。
- 「老師監看」章節：補上作廢也會觸發 `monitor` 通知。

錯誤 envelope、時間格式（ISO 8601 UTC），以及 `requireTeacher` 的 401 行為都沿用既有契約。

## Risks / Trade-offs

- **在學生端 change 完成前**，被作廢組別的頁面不會立即解鎖，要重新整理才能重送。
  - 緩解：server 已提供 `void` 事件與 `voided` 欄位，學生端 change 只需處理畫面。Demo 前必須完成學生端 change。
- **CSV「順位」欄的語意**：本組輸出判定結果的 `place`，作廢後名次會往前遞補；SpecKit 說明「順位」是「該題送達順位」。作廢上線後兩組的 CSV 在有作廢的題目上可能不同。本 change 不改 CSV，見 Open Questions。
- **事件對象依「目前進場狀態」判斷**：學生在作廢前換組，`void` 事件會送到他現在的組。這和既有 `submission` 事件的行為一致，而且搶答中不能換組（`GROUP_CHANGE_NOT_ALLOWED`），實際不會發生。

## Migration Plan

- 只新增端點與欄位，不需資料遷移；server 重啟本來就會清空記憶體。
- 回復方式：移除新端點與事件。既有欄位都沒有改變，舊前端不受影響。

## Open Questions

- **CSV「順位」**：有作廢時，SpecKit 輸出的是原始送達順位（`rank`），還是作廢後重新編號的名次？在 `add-fair-ranking` 前需要和 SpecKit 確認。若要改，由 CSV 另開 change 處理，不在本 change 範圍。
