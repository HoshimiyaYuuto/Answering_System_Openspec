# Design: fix-student-entry-phase-race

## 問題時序

1. 學生按組別 → `PUT /api/student/entry`，回應 phase 為「準備中」。
2. 改用 `/api/events?studentId=` 的新連線 open → `synchronizeFromServer()` 同時送出 `GET /api/session` 與 `GET /api/student/entry`，server 回應「準備中」。
3. 老師開始搶答，`phase` 事件（搶答中）先到，畫面進入作答區並載入題目。
4. 步驟 2 的回應才抵達：`showEntryResult()` 把 `phase` 改回「準備中」並切回等待畫面；session 摘要也帶著舊階段與 `activityId: null`。

## 決策：以 phase 事件版本丟棄過期的階段

- `app.js` 新增 `phaseVersion`，每收到一個有效的 `phase` 事件加一。
- 會帶回階段的請求送出前記下 `requestPhaseVersion`：`enterGroup()`（PUT）、`restoreEntry()`（GET entry）、`confirmEntryAfterClosedEventSource()`（GET entry）、`synchronizeFromServer()`（GET session）。
- 回應抵達時以 `logic.js` 的 `resolveResponsePhase()` 決定階段：版本未變才採用回應的階段，否則保留目前階段。`synchronizeFromServer()` 另以 `isPhaseSnapshotCurrent()` 判斷是否套用 session 摘要的 `activityId`，避免舊摘要把搶答中的 `activityId` 清成 null。
- 進場資料（組別、`valid`）與作答狀態快照照常套用，因為它們不會被 phase 事件取代。

理由：同一個 SSE 連線上的 `phase` 事件依 server 發生順序送達，是學生端最新的階段來源；在請求送出後才收到的事件，必然不早於該請求回應所反映的狀態（若 server 處理請求時已是新階段，回應與事件一致，略過回應也不會遺失資訊）。

## 替代方案

- **以 server 時間比較**：`phase` 事件帶 `serverTime`，但 `GET /api/student/entry` 與 PUT 回應沒有時間，需要改 API，不符合「不改 server 或 API」。
- **重設 `synchronizationRequestId`**：只能丟棄整個同步結果，`restoreEntry()` 在 `Promise.all` 內部已先呼叫 `showEntryResult()`，無法阻止覆蓋；而且進場與 PUT 的回應不經過該序號。
- **收到 phase 事件後再補一次同步**：仍會短暫閃回等待畫面，且多一輪請求。

## 與 API 契約的一致性

不新增、不修改端點與回應格式；僅改變學生端如何取捨並行回應，符合 `docs/api-contract.md` 中 phase 事件與 session 摘要的既有定義。

## 畫面狀態機

畫面：選組（select-group）、等待（waiting）、作答（answering）、已結束（ended），由 `getAnsweringScreen(currentEntry.valid, phase)` 決定。

| 事件 | 結果 |
| --- | --- |
| 進場／恢復進場回應（valid） | 套用組別；階段只在請求期間沒有新 phase 事件時才採用回應值，再依階段切換畫面 |
| 進場回應 invalid | 回選組畫面（不變） |
| `phase` 事件 | `phaseVersion` 加一，套用事件階段並切換畫面（不變） |
| SSE open 後的同步 | 進場與作答快照照常套用；session 摘要的階段與 `activityId` 只在版本未變時採用 |

本 change 只改變「回應的階段是否被採用」，不新增畫面或事件。
