# Proposal: fix-student-entry-phase-race

## Why

學生按組別進場的同時老師開始搶答時，學生頁可能停在「等待活動（準備中）」，直到下一次階段變化或重新整理才恢復（2026-11-27 瀏覽器實測發現）。原因是進場後 SSE 連線開啟時，`synchronizeFromServer()` 同時送出 `GET /api/session` 與 `GET /api/student/entry`；若老師在這兩個請求送出後才開始，`phase` 事件會先讓畫面進入作答區，但稍後抵達的舊回應仍帶著「準備中」，把階段改回準備中並切回等待畫面。這違反專案規則「同一資料來源可能被同時請求多次時，必須丟棄過期的回應」。

## What Changes

- 學生端記錄收到 `phase` 事件的次數（階段版本）。每個會帶回階段的請求（`PUT/GET /api/student/entry`、`GET /api/session` 摘要）在送出時記下版本；回應抵達時若版本已變，代表回應中的階段比已收到的事件舊，不以它覆蓋目前階段，`GET /api/session` 摘要的 `activityId` 也一併不套用。
- 進場資料本身（組別、有效與否）仍照常套用，只略過過期的階段。
- 不修改 server 或 API。
- 對應 `docs/explore_summary.md` 第 0 節工作規則（丟棄過期回應）與第 6 節學生端階段同步。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `groups-and-entry`：`Student page synchronizes phase and connection health` 增加「較舊的回應不得覆蓋較新的 phase 事件」情境。

## Impact

- **負責人**：學生端成員（目前由使用者代為維護）。
- 程式：`public/student/logic.js`、`public/student/logic.test.js`、`public/student/app.js`。
- API 契約：無變更，`docs/api-contract.md` 不需更新。
- 與 `add-student-countdown-and-reset` 無依賴；兩者都改 `public/student/app.js`，合併時需處理可能的衝突。
