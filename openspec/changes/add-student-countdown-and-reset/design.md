# Design

## Context

`add-countdown-and-reset` 提供的資料（已寫入 `docs/api-contract.md`）：

- `GET /api/session` 與 SSE `phase` 都帶 `countdownEndsAt`（ISO 8601 UTC 或 `null`）與 `serverTime`。
- 重設時，學生連線先收到 `event: reset`、`data: {"serverTime":"…"}`，接著被 server 關閉。之後用原 `studentId` 連 `/api/events`，會得到 `403 STUDENT_NOT_ENTERED`；查 `GET /api/student/entry` 會得到 `valid:false, reason:'activity_reset'`。
- SSE `heartbeat` 每 15 秒帶一次 `serverTime`。

學生頁 `public/student/app.js` 的現況：

- **讀 `/api/session` 的地方有三處**：
  - `loadAnsweringData`：進入作答區；
  - `synchronizeFromServer`：連線恢復；
  - 送出被拒後的 `refresh-session`。
  
  `phase` 事件由 `handlePhase` 處理，目前只讀 `phase`。
- **進場失效**：`getEntryNextStep` 依 `ENTRY_REASON_MESSAGES` 給說明，查不到的原因用通用的「進場狀態無效，請重新選擇組別。」。`restoreEntry` 與 `confirmEntryAfterClosedEventSource` 都走這條路。
- **串流被 server 關閉時**：EventSource 會 3 秒後重連，得到 403 而變成 CLOSED，再由 `confirmEntryAfterClosedEventSource` 查進場、回選組頁。這就是目前重設後約 5 秒才離開的原因。
- **回選組頁**：`showSelection(message)` 清掉本組作答、作廢與結果畫面，並以匿名身分重新連 `/api/events`。`localStorage` 只存 `studentId`，不存組別，所以不需要另外清除進場資料。
- **草稿**：以 `activityId` 隔離。重設後 `activityId` 為 `null`，新一場有新的 id，舊草稿不會被讀到。
- **教師控制台的倒數算法**：`console-logic.js` 的 `formatRemaining`，由 `add-countdown-and-reset` 新增。學生頁不 import 教師目錄的檔案，兩邊各自維護。

## Goals / Non-Goals

**Goals**
- 學生看到的剩餘時間與老師相差不超過 1 秒，不受手機時鐘影響。
- 重設後 2 秒內回選組頁，並顯示正確說明；離線的學生回來時也看到同一句說明。

**Non-Goals**
- 不改 server、API 或教師控制台。
- 不主動刪除 `localStorage` 裡上一場的草稿。它們以舊 `activityId` 為 key，不會被顯示；清理是另一件事，數量也很少。
- 等待畫面與結果頁不顯示倒數。

## Decisions

### 1. 剩餘時間的純函式放在 `logic.js`

新增 `formatRemaining(countdownEndsAt, serverNowMs)`，算法與教師控制台相同：

- 剩餘秒數 = `max(0, ceil((endsAt - serverNow) / 1000))`；
- 顯示為 `m:ss`；
- 輸入無效時回傳空字串。

**替代方案**：學生頁直接 import `/teacher/console-logic.js`。

**不採用原因**：學生頁與教師頁是兩個獨立的靜態區域，交叉引用會讓兩位成員的檔案互相依賴。函式只有幾行，重複的成本比耦合低。

### 2. 時鐘差與顯示

- 新增 `clockOffset` 與 `countdownEndsAt` 兩個模組變數，以及 `recordServerTime(data)`：
  - 有有效的 `serverTime` 時，更新 `clockOffset = Date.parse(serverTime) - Date.now()`；
  - 有 `countdownEndsAt` 欄位時，更新倒數結束時間。
- 呼叫 `recordServerTime` 的地方：
  - 三處讀 `/api/session` 的回應；
  - `handlePhase`；
  - `handleHeartbeat`：只更新時鐘差，因為 heartbeat 不帶 `countdownEndsAt`。
- `index.html` 在作答區標題下新增 `<p id="countdown" class="countdown" aria-live="off" hidden>`。
  - 設為 `aria-live="off"`，避免螢幕閱讀器每秒唸一次。
- `renderCountdown()`：
  - 在作答區可見、`phase === '搶答中'`、且 `countdownEndsAt` 不是 `null` 時，以 `textContent` 顯示 `剩餘時間 m:ss`，並確保有一個 1 秒的 `setInterval`；
  - 其他情況隱藏並清除 interval；
  - 呼叫時機：`showPhaseScreen`、`recordServerTime` 之後，以及 interval 本身。
- 時鐘差在每次收到 `serverTime` 時都重算，所以手機時鐘錯誤或中途被調整都不影響。誤差只有單程網路延遲。

### 3. 處理 `reset` 事件

- 在 `ensureEventSource` 掛上 `source.addEventListener('reset', handleReset)`。
- `handleReset`：
  - 只在 `currentEntry?.valid` 時動作；
  - 先清除倒數狀態，再呼叫 `showSelection(RESET_MESSAGE)`；
  - 不呼叫 `saveCurrentDraft()`，因為那份草稿屬於上一場。
- `showSelection` 會以匿名身分重建 EventSource，並關閉舊的連線。舊連線之後觸發的 `error` 會被既有的 `source !== eventSource` 判斷略過，所以不會再查一次進場。

### 4. `activity_reset` 的說明

- `ENTRY_REASON_MESSAGES` 新增 `activity_reset: '活動已重設，請重新選擇組別'`，並 export `RESET_MESSAGE`，讓 `handleReset` 使用同一句。
- 文字沿用既有 `entry_reset` 與 `group_removed` 的寫法：句尾不加句號。
- 以下路徑都經過 `getEntryNextStep`，所以會自動顯示這句說明：
  - `restoreEntry`：重新整理；
  - `confirmEntryAfterClosedEventSource`：漏收事件後串流被關閉。
- 作答或送出時遇到 `STUDENT_NOT_ENTERED`，仍顯示既有的「進場狀態已失效」，不額外查原因。這條路徑只在重設事件與串流關閉都沒到時才會發生，維持現狀可以讓改動最小。

### 畫面狀態機（學生頁）

每個畫面由兩項資料決定：`currentEntry.valid` 與 `phase`。倒數顯示另外看 `countdownEndsAt`。

| 畫面 | 條件 | 本 change 新增的內容 |
|---|---|---|
| 選組 | 沒有有效進場 | 依原因顯示說明，新增「活動已重設，請重新選擇組別」 |
| 等待 | 有效進場，準備中 | 無 |
| 作答區（題號格或作答頁） | 有效進場，搶答中 | 有倒數時顯示「剩餘時間 m:ss」 |
| 已結束（結果） | 有效進場，已結束 | 無；倒數隱藏 |

| 事件 | 切換 |
|---|---|
| 收到 `phase`（搶答中，帶 `countdownEndsAt`） | 等待 → 作答區，顯示倒數 |
| 每秒 | 作答區的剩餘時間更新；歸零時停在 0:00 |
| 收到 `phase`（已結束） | 作答區 → 已結束，倒數隱藏 |
| 收到 `reset` | 作答區、等待或已結束 → 選組，顯示重設說明 |
| 重新整理或重連時查到 `activity_reset` | 任何畫面 → 選組，顯示重設說明 |
| 收到 `heartbeat` | 畫面不變，只更新時鐘差 |

## Risks / Trade-offs

- **`reset` 事件沒送到**（例如網路剛好斷掉）時，要靠重連後查進場，大約 3～5 秒才離開，但說明一樣正確。
- **同一句重設說明有兩個來源**（事件與查詢原因）。兩者都用 `RESET_MESSAGE` 常數，所以不會不一致。
- **倒數歸零到收到「已結束」之間**，畫面會停在 0:00，通常不到 1 秒。這段時間按送出會被 server 以「目前階段不允許提交」拒絕，接著走既有的 `refresh-session` 流程，顯示活動已結束。

## Migration Plan

純前端修改，重新整理頁面就生效。server 若是舊版、沒有 `countdownEndsAt` 或 `reset`，頁面就不顯示倒數，重設行為也維持現狀。

## Open Questions

（無）
