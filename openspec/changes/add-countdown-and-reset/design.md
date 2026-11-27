# Design

## Context

- `server/index.js` 用一個記憶體中的 `session` 物件保存狀態：`{ phase, activityId, questions, groups }`。
  - `POST /api/session/start` 依序檢查階段、組別、題目，產生新的 `activityId`，然後發布 `phase`。
  - `POST /api/session/end` 只檢查階段。
  - 兩者目前都不讀 request body。
- 階段事件 `phase` 的內容是 `{ phase, serverTime }`。`GET /api/session` 回傳 `{ phase, activityId, questionCount, groupCount, serverTime }`。
- 作答存在 `server/submissions.js`，已經有 `clear()`：清空紀錄與順位，保留訂閱者。
- 進場紀錄存在 `server/groups-entry.js` 的 `entries`（`studentId → { groupId, removed }`）。查不到時回 `entry_reset`。
- SSE 連線存在 `eventClients`。學生連線帶 `studentId`；老師連線帶 `teacherToken`；選組頁的匿名連線兩者都沒有。
  - 學生以無效進場連 `/api/events` 時，server 回 `403 STUDENT_NOT_ENTERED`。學生頁的 EventSource 因此關閉，接著用 `GET /api/student/entry` 確認進場，失效時回選組頁。
- 學生草稿以 `activityId` 隔離（`student-results` 的要求），所以重設後換了新的 `activityId`，舊草稿就不會出現。
- 教師控制台的階段操作是 `console-logic.js` 的純 reducer 加上 `app.js` 的 DOM 接線。「結束搶答」已經有「再確認一次」的版面與狀態，可以照樣做重設。
- SpecKit 的同一功能（001 FR-022～FR-026）：
  - 開啟時帶 `countdownSeconds`，超出範圍回 `COUNTDOWN_OUT_OF_RANGE`；
  - 狀態含 `countdownEndsAt` 與 `serverNow`；
  - 重設只在已結束可用，重設前要確認。
  
  本設計的可觀察行為與他們一致，欄位名稱 `countdownEndsAt` 也相同。

## Goals / Non-Goals

**Goals**
- 倒數由 server 計時並自動結束；各端依 server 時間顯示，誤差在 1 秒內。
- 重設回到準備中：清空作答與進場，保留組別、題目與老師登入；已連線學生被送回選組。
- 倒數歸零與手動結束同時發生、兩個分頁重複重設，都只發生一次，畫面沒有錯誤。

**Non-Goals**
- 學生頁的倒數顯示、`reset` 事件處理、`activity_reset` 的說明文字：由 `add-student-countdown-and-reset` 負責。
- 投影看板：由 `add-projector-board` 負責。
- 倒數暫停或延長、server 重啟後保留狀態。

## Decisions

### 1. 倒數由 server 計時，對外只公布結束時間

- `start` 讀取 `request.body?.countdownSeconds`：
  - `undefined` 或 `null` 表示不倒數；
  - 其他值必須是 `Number.isInteger` 且介於 10～3600，否則回 `400 COUNTDOWN_OUT_OF_RANGE`，訊息為「倒數時間需介於 10 秒到 60 分鐘。」。
  - 這項檢查放在既有三項檢查之後，所以「階段不對」與「缺組別或題目」的錯誤優先。
- 開始成功時：
  - `session.countdownEndsAt = new Date(Date.now() + seconds * 1000).toISOString()`；
  - 用 `setTimeout` 排一個計時器，並呼叫 `unref()`，避免卡住測試或關閉中的 process；
  - 計時器 callback 記住開始時的 `activityId`。
- 新增內部函式 `endSession()`：
  - `phase !== '搶答中'` 時回傳 `false`；
  - 否則清除計時器，`countdownEndsAt = null`，`phase = '已結束'`，然後 `publishPhase()`。
  - `/api/session/end` 與計時器都呼叫它。計時器先比對 `activityId`，不同就不動作。
  - Node 是單執行緒，兩者一定有先後。後到的手動結束得到 `409 INVALID_PHASE_TRANSITION`，控制台既有的 `endFailed` 已把「已結束」視為成功，所以畫面不會出現錯誤。
- `sessionSummary()` 與 `publishPhase()` 加上 `countdownEndsAt`，沒有倒數時為 `null`。
- 開發用的 `/api/dev/phase/:phase` 讓階段離開搶答中時，也清除計時器與 `countdownEndsAt`。

替代方案與取捨：
- **由前端倒數，時間到時呼叫 end**：不採用。老師關掉分頁就不會結束，也違反「倒數以 server 為準」（D15、FR-018）。
- **事件只送「剩餘秒數」**：不採用。重連或事件延遲時，各端算出的時間會不同；送結束時間再加上 server 時間，任何時候讀到都能算出一致的剩餘時間。

### 2. 前端以 server 時間計算剩餘時間

- 每次收到 `serverTime`（摘要或 `phase` 事件）時，記下 `clockOffset = Date.parse(serverTime) - Date.now()`。
- 剩餘秒數 = `max(0, ceil((Date.parse(countdownEndsAt) - (Date.now() + clockOffset)) / 1000))`。
- 顯示格式為 `剩餘 m:ss`，每秒重算一次。
- 新增純函式 `formatRemaining(countdownEndsAt, serverNowMs)` 放在 `console-logic.js`。學生端 change 可以照抄同一個算法。
- 誤差只有一次請求的單程延遲，區網內遠小於 1 秒。

### 3. 重設端點

`POST /api/session/reset`（`requireTeacher`），不需要 body：

1. `phase !== '已結束'` 時回 `409 INVALID_PHASE_TRANSITION`，訊息為「只能在已結束時重設活動。」。
2. 清除資料：
   - `submissions.clear()`，已作廢的作答一起清掉；
   - `session.groups.resetEntries()`；
   - `session.activityId = null`、`countdownEndsAt = null`，並清除計時器。
3. `phase = '準備中'`。
4. 通知連線（見第 5 節）。
5. 回 `200 { data: { phase: '準備中', serverTime } }`。

保留的資料：`session.groups` 的組別清單、`session.questions`、`guidedNotes` 的目前學習單與來源、老師的登入 token、寫回設定。

替代方案與取捨：
- **像 SpecKit 要求 body 帶 `confirm: true`**：不採用。確認是畫面上的行為，兩組在畫面上都要求確認；API 只有登入的老師能呼叫，多一個欄位不會改變可觀察行為。
- **重設時保留學生進場**：不採用。這與 SpecKit 談定的語意（v0.10）不同。

### 4. `groups-entry` 記住被重設的學生

- 新增 `resetIds`（`Set`）與 `resetEntries()`：把 `entries` 的所有 `studentId` 加進 `resetIds`，然後清空 `entries`。
- `lookup`：沒有 entry 時，`resetIds` 有這個 id 就回 `activity_reset`，否則回 `entry_reset`。
- `enter` 成功時從 `resetIds` 移除該 id。
- `resetIds` 只會增加到「曾經進場的學生數」，一個班級是幾百筆以內，server 重啟就清空，不需要額外清理。

替代方案：
- **用全域的「重設次數」讓舊進場自己失效**：不採用。那樣需要學生端把重設次數存起來帶回來，要改 API 欄位，而且只換來節省一點記憶體。

### 5. 重設時的連線通知

依序處理 `eventClients`：

- **學生連線**（有 `studentId`）：先寫入 `event: reset`、`data: {"serverTime":"…"}`，再 `response.end()`，並從 `eventClients` 移除。
- **其他連線**（老師、選組頁的匿名連線）：照常發布 `phase` 事件。

學生端 change 完成前，舊的學生頁收到 `reset` 會忽略，但串流被關閉後 EventSource 會重連，得到 `403`，再查進場得到 `activity_reset`，一樣會回選組頁。差別只在顯示的是通用的失效訊息，也比較慢，大約要 3 秒重連間隔。

### 6. 教師控制台

**`console-logic.js` 的狀態新增**
- `confirmingReset`；
- `action` 新增 `'resetting'`。

**事件**
- `requestReset`、`cancelReset`、`confirmReset`、`resetDone`；
- `resetFailed`：錯誤碼為 `INVALID_PHASE_TRANSITION` 且最新階段為「準備中」時視為成功，不顯示錯誤，和 `endFailed` 一樣。
- `withPhase` 在階段不是「已結束」時，清掉 `confirmingReset`。

**`getConsoleControls` 新增**
- `canReset`：閒置、已結束、沒有在確認中；
- `showResetConfirm`；
- `canConfirmReset`；
- `canEditCountdown`：等同 `canStart`。

**倒數輸入**
- 新增純函式 `parseCountdown({ enabled, minutes, seconds })`：
  - 未勾選時回 `{ ok: true, countdownSeconds: null }`；
  - 勾選時分、秒必須是非負整數，換算後介於 10～3600，否則回 `{ ok: false, message: '倒數時間需介於 10 秒到 60 分鐘。' }`。
- 前端先擋一次，省一次請求；server 仍然檢查。

**`app.js`**
- 開始時把 `countdownSeconds` 放進 JSON body。
- 摘要與 `phase` 事件都更新 `countdownEndsAt` 與 `clockOffset`。
- 有倒數且搶答中時，用 `setInterval(1000)` 重繪剩餘時間；離開搶答中時停止。
- 重設成功、或收到階段變為準備中時，既有的 `phaseChanged` 會帶動匯入解鎖與匯出狀態重設，`monitorChanged()` 會重讀監看。

**`index.html`**
- 在「開始搶答」上方新增：
  - `#countdown-enabled` 勾選框；
  - `#countdown-minutes`（0～60）、`#countdown-seconds`（0～59）；
  - `#countdown-remaining`（`aria-live="off"`，避免螢幕閱讀器每秒唸一次）。
- 新增 `#reset` 按鈕與 `#reset-confirm` 確認區，說明文字為「重設後會清空本場作答與學生進場，組別與題目保留。確定要重設嗎？」。

### 畫面狀態機（控制台「活動狀態」區塊）

畫面由以下資料決定：`summary.phase`、`summary.countdownEndsAt`、`action`、`confirmingEnd`、`confirmingReset`。

| 畫面 | 條件 | 可用操作 | 顯示 |
|---|---|---|---|
| 準備中 | 階段為準備中，閒置 | 倒數設定、開始搶答 | 階段、組數與題數 |
| 開始中 | `action = starting` | 無 | 「開始搶答中…」 |
| 搶答中 | 階段為搶答中，閒置 | 結束搶答 | 有倒數時顯示「剩餘 m:ss」 |
| 結束確認 | `confirmingEnd` | 確認結束、取消 | 結束說明 |
| 結束中 | `action = ending` | 無 | 「結束搶答中…」 |
| 已結束 | 階段為已結束，閒置 | 重設活動、匯出 | 結果 |
| 重設確認 | `confirmingReset` | 確認重設、取消 | 重設說明 |
| 重設中 | `action = resetting` | 無 | 「重設活動中…」 |

| 事件 | 切換 |
|---|---|
| 按開始，成功 | 準備中 → 開始中 → 搶答中 |
| 按開始，失敗（含倒數範圍錯誤） | 開始中 → 準備中，顯示原因 |
| 倒數歸零（server 發布 `phase`） | 搶答中或結束確認 → 已結束 |
| 按結束 → 確認 | 搶答中 → 結束確認 → 結束中 → 已結束 |
| 按重設 | 已結束 → 重設確認 |
| 取消重設 | 重設確認 → 已結束 |
| 確認重設，成功或重複重設 | 重設中 → 準備中 |
| 其他分頁重設（收到 `phase`） | 已結束或重設確認 → 準備中 |
| 登入失效（401） | 任何畫面 → 登入頁（既有行為） |

### 7. 與 `docs/api-contract.md` 的一致性

本 change 要更新契約的以下段落：

- `POST /api/session/start`：request body 可選 `{ countdownSeconds }`；新增錯誤 `400 COUNTDOWN_OUT_OF_RANGE`。
- `GET /api/session` 與 SSE `phase`：加上 `countdownEndsAt`（ISO 8601 UTC 或 `null`）。
- 新增 `POST /api/session/reset` 的成功與錯誤回應。
- 新增 SSE `reset` 事件：只送給學生連線，送完即關閉。
- `GET /api/student/entry` 的 `reason` 新增 `activity_reset`。
- 第 118 行「本契約目前不定義活動重設」改為指向新段落。

既有欄位與錯誤碼都不改名，舊的用戶端忽略新欄位即可。

## Risks / Trade-offs

- **server 重啟會失去倒數**：與所有狀態一樣存在記憶體。重啟後階段回準備中，老師要重新開始。這和 SpecKit 的 FR-021 不同，本組在 explore 時已接受記憶體狀態的限制。
- **`setTimeout` 的精度**：誤差在毫秒等級；剩餘時間無條件進位到秒，所以畫面會顯示 0:01 直到真正結束。
- **舊草稿仍留在學生瀏覽器的 localStorage**：因為以 `activityId` 隔離，不會被顯示或回填。要不要主動清掉，由學生端 change 決定。
- **兩組 API 形式不同**：SpecKit 用 Socket.IO 事件，本組用 HTTP 加 SSE。兩組只要求可觀察行為一致，這是既有的差異。
- **學生端 change 還沒合併時**，已連線學生回選組頁約需 3 秒，訊息是通用的失效說明。學生端 change 完成後改為 2 秒內並顯示重設說明。
