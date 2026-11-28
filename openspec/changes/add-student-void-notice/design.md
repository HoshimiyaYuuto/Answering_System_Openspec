# Design

## Context

- `add-submission-void` 已提供兩種資料，都不含順位，時間都是 server 產生的 ISO 8601 UTC 字串：
  - 只送給該組的 SSE `void` 事件 `{ questionId, voidedAt }`；
  - `GET /api/student/submissions` 的 `voided: [{ questionId, voidedAt }]`，列出已被作廢且尚未重送的題目。
- 學生頁 `public/student/app.js` 目前的狀態：
  - 本組作答存在 `loadedSubmissions`。有作答就鎖題、顯示「已送出」。
  - 快照在三個地方用 `mergeSubmissions(current, snapshot)` 合併：`refreshSubmissions`、進入作答時的 `loadAnswering`、重新同步。合併時本機已有的作答優先，以免較晚發出、但較早抵達的快照蓋掉剛送出的答案。
  - 所以單靠快照少了某題，並不能解鎖。被作廢的題目一定要靠 `voided` 明確說明。
- 純函式放在 `public/student/logic.js`，用 `logic.test.js` 測試；`app.js` 只負責 DOM 與請求。

## Goals / Non-Goals

**Goals**
- 收到 `void` 事件或讀到 `voided` 時，解鎖該題並顯示「已作廢，可重新送出」。
- 不論本裝置還是同組其他裝置重送，重送成功後都恢復成「已送出」。
- 事件與快照到達的先後順序，不會讓題目錯誤地鎖住或解鎖。

**Non-Goals**
- 不把被作廢的答案填回輸入框。事件不帶答案；作廢通常表示答案有問題，讓學生重新填寫。
- 不改 server、API 或學生結果頁。

## Decisions

### 1. 以時間戳決定「作答」和「作廢」誰比較新

前端在 `loadedSubmissions` 之外新增 `loadedVoided`（`[{ questionId, voidedAt }]`）。同一題兩者都有時，依時間決定結果：

- 作答的 `submittedAt` **晚於** `voidedAt`：這是重送，保留作答，移除作廢。
- 否則：作答已被作廢，移除作答，保留作廢。

同一個 server 產生的 ISO UTC 字串（固定 `.sssZ` 格式），可以直接用字串比較先後。

- **替代方案**：快照一律以 server 為準，整個取代本機狀態。
- **不採用原因**：會讓「剛送出，但較早發出的快照才到」時，題目暫時被解鎖。現有的合併規則就是為了避免這種情形。

用時間戳比較，事件和快照依任何順序到達，結果都一樣：
- 作廢事件後，才到一份較早的快照：快照裡的舊作答時間早於 `voidedAt`，會被丟掉。
- 重送後，才到一份較早的快照：快照裡的 `voided` 時間早於重送時間，會被丟掉。

### 2. 新增純函式（`logic.js`）

| 函式 | 作用 |
|---|---|
| `mergeSubmissions(current, snapshot)` | 同題兩份作答時，改成保留 `submittedAt` 較新的一份；時間相同時保留 `current`。沒有作廢時，同一題只會有一份作答，所以行為和原本相同。修改的原因：本裝置漏收作廢事件、同組他人已重送時，快照裡的重送答案要能取代本機的舊答案。 |
| `mergeVoided(current, snapshot)` | 依題號合併，保留較晚的 `voidedAt`。 |
| `reconcileVoided(submissions, voided)` | 依第 1 點的規則，回傳 `{ submissions, voided }`。 |
| `applyVoid(state, { questionId, voidedAt })` | 等於 `reconcileVoided(state.submissions, mergeVoided(state.voided, [update]))`。 |
| `getQuestionStatus(hasSubmission, hasDraft, isVoided = false)` | 優先順序為已送出 → 已作廢 → 草稿 → 未作答，新增回傳值 `'voided'`。原本兩個參數的呼叫結果不變。 |

所有函式都不修改傳入的陣列。

### 3. `app.js` 的接線

- 新增 `loadedVoided`，在清空 `loadedSubmissions` 的兩處一併清空：換組、活動變更。
- 新增 `projectVoided(value)`：
  - 欄位不存在時視為 `[]`，相容舊的 server；
  - 是陣列時，逐筆檢查 `questionId` 與 `voidedAt`；
  - 格式錯誤時，和 `projectSubmissions` 一樣丟出「伺服器回應格式錯誤」。
- 三個快照合併點改為呼叫 `applyGroupSnapshot(snapshotData)`。它依序做 `mergeSubmissions`、`mergeVoided`、`reconcileVoided`，然後寫回兩個變數。
- 新增 `handleVoid(event)`，掛在 `source.addEventListener('void', ...)`：
  - 驗證格式，格式錯誤時忽略，等下次同步。
  - 套用 `applyVoid`，再重繪題號格。
  - 正在看該題時，重繪作答頁。
- 收到 `submission` 事件，或本裝置送出成功後：在 `applySubmission` 之後再跑 `reconcileVoided`，作廢提示就會消失。
- 重新同步後，原本只在「該題有作答」時才重繪作答頁。改為：該題的鎖定狀態或作廢狀態有變化時就重繪。這樣同步時發現被作廢，也能立即解鎖。
- `renderQuestionGrid` 把作廢狀態傳給 `getQuestionStatus`，`statusByKey` 新增 `voided: '已作廢，可重新送出'`。
- `submitCurrentQuestion` 開頭的「已送出就不送」檢查不變。已作廢的題目在 `loadedSubmissions` 裡已經沒有作答，所以可以送出。

### 4. 作答頁的提示

- `renderQuestionPage` 在題目未鎖定且已作廢時，預設訊息為「此題的作答已被老師作廢，請重新填寫後送出。」。
- 這段訊息放在既有的 `role="status"`、`aria-live="polite"` 訊息區，螢幕閱讀器也會唸出來。
- 有 `options.message` 時，以 `options.message` 為準。
- 輸入框從草稿恢復。作廢前送出時已清掉草稿，所以通常是空白。

### 畫面狀態機（學生頁作答區）

每一題的狀態由兩項資料決定：本組有沒有這題的作答（`loadedSubmissions`），以及這題有沒有被作廢（`loadedVoided`）。

| 題目狀態 | 條件 | 題號格文字 | 作答頁 |
|---|---|---|---|
| 未作答 | 沒有作答、沒有作廢、沒有草稿 | 未作答 | 可作答 |
| 草稿 | 沒有作答、沒有作廢、有草稿 | 草稿 | 可作答，恢復草稿 |
| 已送出 | 有作答 | 已送出 | 鎖定，顯示答案 |
| 已作廢 | 沒有作答、有作廢 | 已作廢，可重新送出 | 可作答，顯示作廢提示 |

| 事件 | 狀態變化 |
|---|---|
| 收到 `void` 事件 | 已送出 → 已作廢 |
| 快照的 `voided` 列出該題，且作廢時間晚於本機作答 | 已送出 → 已作廢 |
| 本裝置重送成功 | 已作廢 → 已送出 |
| 收到同組他人的 `submission` 事件 | 已作廢 → 已送出 |
| 階段變為「已結束」 | 顯示既有的「活動已結束」，停用輸入 |

既有的「準備中」等待畫面與選組畫面不變。

## Risks / Trade-offs

- **同一毫秒內作廢又重送**時，依第 1 點的規則會判定為已作廢，要等下一次同步才會恢復。實際上人工操作不可能在 1 毫秒內完成，可以接受。
- **`mergeSubmissions` 改成保留較新的作答**，是行為上的微調。原本的測試（本機作答優先）在時間相同或本機較新時仍然成立；需要新增一個「快照比本機新」的測試案例。
- **被作廢的答案不會填回**。學生如果只想改一個字，需要整題重打。這是刻意的取捨：事件不帶答案，也不想讓學生以為原答案仍然有效。

## Migration Plan

純前端修改，重新整理頁面就生效。server 若是舊版、沒有 `voided` 欄位，前端視為空陣列，行為和現在相同。

## Open Questions

（無）
