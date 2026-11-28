# Design

## Context

**server**
- `/api/events` 的連線存在 `eventClients`，每個連線是下列三種之一：
  - 帶 `studentId` 的學生連線（開啟前已檢查有效進場）；
  - `role=teacher` 的老師連線（記下 `teacherToken`）；
  - 公開連線。
- 老師連線目前會收到 `phase` 與 `monitor`。`notifyTeachers()`（`add-fair-ranking`）每次通知時都會檢查 token。
- 進場紀錄由 `groups-entry.js` 的 `lookup(studentId, phase)` 判定是否有效，換組在準備中以 `PUT /api/student/entry` 完成，學生的事件連線不會因此重開。
- 目前沒有任何在線資訊。

**前端**
- 教師頁是 `public/teacher/` 下的靜態檔，純邏輯放在 `*-logic.js`（可 `node --test`），`app.js` 只做 DOM 與請求。
- `console-logic.js` 已有 `formatRemaining(countdownEndsAt, serverNowMs)`；`monitor-logic.js` 的監看資料有 `settled`、`winner`、`winnerSource`。
- 老師登入狀態是 cookie，同一個瀏覽器的其他分頁可共用。

動機見 proposal.md「Why」；揭曉由看板自己控制是使用者的選擇。

## Goals / Non-Goals

**Goals**
- 搶答中的看板在資料層就拿不到作答：搶答中不呼叫任何含作答的端點。
- 在線狀態與看板更新都走既有的 SSE 老師連線，不新增輪詢。

**Non-Goals**
- 揭曉進度存到 server、由控制台遙控（使用者已選定看板自己控制）。
- 控制台本身顯示在線。
- server 重啟後保留在線狀態（連線本來就會斷）。

## Decisions

### 1. 在線狀態即時計算，不另外存

- `groupPresence()`：
  - 走訪 `eventClients` 中帶 `studentId` 的連線，用 `session.groups.lookup()` 取得目前有效的組別，收集成「在線組別編號」集合；
  - 回傳 `session.groups.list()` 依編號排序，每組 `{ id, name, online }`。
- 換組、組別被刪除、重設都會反映在 `lookup()` 的結果，所以不必另外維護計數器，也不會有計數不一致的問題。
- 100 條連線 × 每次通知一次查詢，成本很低。

**替代方案**：在連線開啟與關閉時維護 `Map<groupId, count>`。

**不採用原因**：換組時學生連線不重開，計數器會對不上；即時計算一定正確。

### 2. 端點與通知

- `GET /api/teacher/presence`（`requireTeacher`）：

  ```json
  { "data": { "groups": [{ "id": 1, "name": "第 1 組", "online": true }], "serverTime": "..." } }
  ```

- `notifyPresence()`：對已登入老師的連線送 `event: presence`，`data` 只有 `serverTime`，跟 `monitor` 通知一樣每次通知時檢查 token。
- 呼叫時機：
  - 學生連線加入 `eventClients` 之後、連線關閉時；
  - `PUT /api/student/entry` 成功後（進場或換組）；
  - `PUT /api/groups`、`POST /api/groups/generate` 成功後；
  - 重設時，結束學生連線之後。
- 公開的 `GET /api/session` 與 `phase` 事件不變。

### 3. 看板頁與純邏輯（`board-logic.js`）

**檔案**
- `public/teacher/board.html` 與 `board.js`，網址 `/teacher/board.html`，沿用既有的 `/teacher` 靜態路徑。

**狀態**（`createBoardState()` / `reduceBoard()`）
- `auth`：`'checking' | 'in' | 'out'`
- `summary`：`GET /api/session` 的資料
- `presence`：`GET /api/teacher/presence` 的組別陣列
- `results`：`GET /api/teacher/monitor` 的題目陣列，只在已結束時讀取
- `revealed`：已揭曉的題數
- `presenceSeq`、`resultsSeq`：每個資源各自的請求序號，回應序號不是最新的就丟棄（AGENTS 規則）

**事件**
- `authChecked`、`authExpired`（任何 401）
- `summaryLoaded`：階段變了時：
  - 離開「已結束」：清空 `results`，`revealed` 歸 0；
  - 進入「已結束」：要求讀取結果。
- `presenceRequested`／`presenceLoaded`
- `resultsRequested`／`resultsLoaded`
- `revealNext`：`revealed + 1`，上限為題數
- `revealAll`：`revealed = 題數`

**檢視**（`getBoardView(state, serverNowMs)`）
- `view`：`'checking' | 'login' | 'board'`
- `phaseText`
- `countdownText`：只有搶答中而且有 `countdownEndsAt` 時才有值
- `groups`：準備中與搶答中為 `[{ name, statusText: '在線' | '離線', online }]`，已結束為空
- `results`：已結束時為：
  - `rows`：依題號排序，前 `revealed` 題顯示結果文字，其餘為「尚未揭曉」；
  - `canRevealNext`、`canRevealAll`

**結果文字**
- 有勝者：`組名「答案」`，題組的空格以「／」串接；公平順位改判時加「（公平順位改判）」。
- 無勝者：「無人作答」；`settled === false` 時為「判定中」，只是防禦，已結束時不會出現。

**`board.js` 的流程**
- 先呼叫 `GET /api/teacher/auth`。
- 已登入就讀摘要並開 `EventSource('/api/events?role=teacher')`：
  - `phase`：記下 server 時間，重讀摘要；
  - `presence`：重讀在線；
  - `monitor`：看板不處理。
- 在線狀態只在準備中與搶答中讀取。
- 倒數用 server 時間差每秒重畫（同控制台的 `clockOffset` 作法）。
- 畫面一律用 `textContent` 與 `replaceChildren()` 取代。

### 畫面狀態機

| 畫面 | 條件 | 顯示 | 會讀取的資料 |
|---|---|---|---|
| 檢查中 | 尚未取得登入狀態 | 「讀取中…」 | `/api/teacher/auth` |
| 未登入 | 未登入或任何請求回 401 | 「請先在教師控制台登入」與連結 | 無 |
| 準備中 | 階段為準備中 | 階段、各組在線 | 摘要、在線 |
| 搶答中 | 階段為搶答中 | 階段、倒數（若有）、各組在線 | 摘要、在線（**不讀監看**） |
| 已結束 | 階段為已結束 | 「搶答結果」、揭曉按鈕、各題（未揭曉或結果） | 摘要、監看 |

| 事件 | 切換 |
|---|---|
| `phase` 事件 | 重讀摘要，依新階段切換畫面 |
| 進入已結束 | `revealed = 0`，讀取監看 |
| 已結束 → 準備中（重設） | 清空結果與揭曉進度，讀取在線 |
| `presence` 事件 | 準備中或搶答中時重讀在線 |
| 揭曉下一題／全部揭曉 | `revealed` 增加，只改畫面 |
| 任何請求 401 | 切到「未登入」，關閉事件連線 |

### 4. 控制台連結

- `index.html` 在「活動狀態」區塊加 `<a id="board-link" href="/teacher/board.html" target="_blank" rel="noopener">開啟投影看板</a>`。
- 只在 `consoleState.view === 'console'` 時顯示。

### 5. 外觀

- 看板以投影為主：
  - 字級放大（階段約 3rem、題目列約 1.6rem）；
  - 組別用格狀排列，在線與離線同時用文字和顏色區分，不只靠顏色。
- 不新增外部字型或套件。

## Risks / Trade-offs

- **[風險] 上課一開始 100 位學生同時連上，會送出很多 `presence` 通知** → 看板用請求序號，舊回應直接丟棄；請求進行中時只記「需要再讀一次」，等它回來後再讀一次，最多同時一個請求。server 每次通知只送一行，100 條老師連線以下沒有負擔。
- **[風險] 揭曉進度只存在看板頁，誤按重新整理會回到全部未揭曉** → 使用者已接受；按「全部揭曉」或逐題重按即可恢復。
- **[風險] 有人把看板分頁截圖或錄影給學生** → 搶答中看板本來就沒有作答資料，影響僅限結束後的結果，而學生結束後本來就看得到結果。
- **[取捨] 學生關閉頁面後，server 要等 TCP 連線關閉才知道** → 一般瀏覽器關閉分頁會立即關閉連線；手機切到背景可能延遲，這時看板會晚一點顯示離線，不影響搶答。
