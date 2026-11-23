# Design: add-student-answering-ui

## Context

動機與範圍見 proposal。目前狀態：

- `public/student/` 是原生 HTML／CSS／JavaScript（沒有建置步驟）。`logic.js` 放可測試的純函式，`logic.test.js` 以 `node --test` 執行；`app.js` 負責 DOM、`fetch` 與 `EventSource`。
- 學生以 `localStorage.studentId` 識別；進場使用 `PUT /api/student/entry`，重新整理以 `GET /api/student/entry` 恢復。
- 目前 `EventSource` 在頁面載入時以 `/api/events` 建立，不帶身分；`phase` 事件更新階段、`heartbeat` 更新連線狀態，超過 40 秒沒有事件顯示「重新連線中…」。
- 已有的伺服器端點（`add-buzz-in-submission`）：`GET /api/student/questions`、`POST /api/student/submissions`、`GET /api/student/submissions`，以及 `GET /api/events?studentId=` 的 `submission` 事件。順位只存在 server，不會出現在任何回應或事件中。

## Goals / Non-Goals

**Goals:**

- 搶答中可以讀題、作答、送出、鎖定，並在多裝置與重新整理之間保持一致。
- 學生畫面不顯示任何他組資訊或順位。
- 把可判斷的邏輯放進 `logic.js` 與 `drafts.js` 並以自動測試覆蓋，DOM 只做接線，因為驗證環境無法自動化操作瀏覽器。

**Non-Goals:**

- 結果頁、倒數顯示、教師端、server 變更、跨裝置草稿。

## Decisions

### 1. 畫面狀態機

畫面由「進場狀態」與「活動階段」決定：

| 狀態 | 進入條件 | 顯示 |
| --- | --- | --- |
| `select-group` | 沒有進場紀錄或進場失效（`valid:false`，或任何端點回 `403 STUDENT_NOT_ENTERED`） | 既有選組畫面，並說明原因 |
| `waiting` | 進場有效且階段為「準備中」 | 既有等待畫面（組別、更換組別） |
| `answering` | 進場有效且階段為「搶答中」 | 題號格（`list`）或單題作答頁（`question`） |
| `ended` | 進場有效且階段為「已結束」 | 「活動已結束」，所有輸入與送出停用 |

`answering` 內分兩個子畫面：`list`（題號格）與 `question`（單題）。單題的狀態為 `unanswered`、`draft`（有本機草稿）、`submitting`（送出請求進行中）、`submitted`（本組已送出，鎖定）。`submitted` 是終點，只有活動重設（本 change 之外）才會改變。

轉換：

- 階段事件或重新同步得到「搶答中」：載入題目與本組作答，進入 `answering/list`。
- 得到「已結束」：任何子畫面都進入 `ended`；進行中的輸入保留在草稿，不送出。
- 收到本組 `submission` 事件，或自己的送出成功，或送出被回 `ALREADY_SUBMITTED`：該題成為 `submitted`；若正在作答該題，輸入框鎖定並顯示已送出的答案。
- 進場失效：回到 `select-group`，不清除草稿。

### 2. 資料來源與同步

- 進入 `answering` 時並行讀取 `GET /api/student/questions` 與 `GET /api/student/submissions`；本組作答以伺服器回應為準。
- 同組其他裝置的送出：靠 `submission` 事件（事件內容為 `{ questionId, answers, submittedAt }`）更新；事件可能重複或遺漏，所以更新必須是冪等的，並在每次重新連線成功（`open`）與重新整理後再讀一次 `GET /api/student/submissions` 對齊。
- 學生端不做輪詢。

### 3. 即時連線改為帶 studentId

進場成功（含重新整理恢復）後，關閉舊的連線並建立 `new EventSource('/api/events?studentId=...')`；換組或進場失效時關閉。`EventSource` 對 `4xx` 不會自動重連（`readyState` 變為 `CLOSED`），因此在 `error` 事件中若 `readyState === EventSource.CLOSED`，改呼叫 `GET /api/student/entry` 判斷：有效則重建連線，無效則回到 `select-group`。網路中斷（`readyState` 為 `CONNECTING`）交給瀏覽器自動重連，並沿用既有的 40 秒「重新連線中…」判斷與重連後的 `synchronizeFromServer`。

替代方案：保留無參數連線並改用輪詢取得同組作答，沒有身分問題但同步延遲與請求量較高，且 server 已提供組別限定事件，不採用。

### 4. 草稿

- 鍵：`draft:<studentId>:<questionId>`，值為字串陣列（依空格順序）。
- 輸入時寫入（可用簡單的節流），送出成功或該題被標為已送出時刪除。
- 載入時若陣列長度與該題空格數不同（例如老師重新匯入過），丟棄該草稿。
- `localStorage` 不可用或失敗時靜默降級為只在記憶體保存，不顯示錯誤。
- 草稿只屬於這台裝置，不跨裝置、不送到 server。

### 5. 送出流程與錯誤對應

前端先驗證：每格 `trim()` 後 1–200 字元，題組須所有空格都有內容；不通過就在輸入框旁顯示訊息且不呼叫 API（server 仍會再驗證）。

送出時進入 `submitting`，停用輸入與按鈕，設定 10 秒逾時。結果對應：

| 結果 | 動作 |
| --- | --- |
| 200 | 該題標為已送出，顯示送出的答案，清除草稿 |
| 409 `ALREADY_SUBMITTED` | 重新讀 `GET /api/student/submissions`，顯示本組已送出的答案，說明「本組已由其他裝置送出」 |
| 409 `SUBMISSION_NOT_ALLOWED` | 重新讀 `GET /api/session`；階段為已結束則進入 `ended` |
| 403 `STUDENT_NOT_ENTERED` | 回到 `select-group` 並說明原因 |
| 400 `INVALID_ANSWER`、404 `QUESTION_NOT_FOUND` | 顯示錯誤訊息，保留輸入；`QUESTION_NOT_FOUND` 另外重新載入題目 |
| 逾時或網路錯誤 | 顯示「伺服器沒有回應」，保留輸入並允許重試；重試若得到 `ALREADY_SUBMITTED` 視為已送出（請求可能其實已成功） |

### 6. 隱私

畫面與記憶體中的狀態只包含本組的資料。不顯示順位、他組、題目是否被搶走。`submission` 事件與 `GET /api/student/submissions` 本來就不含這些資訊，前端不得另外推算。題號格的狀態只有未作答、草稿、已送出三種，且以文字標示，不只靠顏色區分。

### 7. 程式結構

為了讓 Codex 每個 task 只改一到兩個檔案，並讓大部分行為可以用 `node --test` 驗證：

- `public/student/logic.js`：純函式（題目狀態推導、答案驗證、送出錯誤對應、階段到畫面的對應、事件錯誤對應），不碰 DOM。
- `public/student/drafts.js`：草稿存取，接受注入的 `storage` 物件以便測試。
- `public/student/app.js`：DOM、`fetch`、`EventSource` 接線，只呼叫上述函式。
- `public/student/index.html`：新增 `answering`、`ended` 區塊與樣式。

### 8. 與 docs/api-contract.md 的一致性

不新增或修改任何端點與錯誤代碼，只使用契約「搶答送出」章節已定義的行為；因此本 change 不修改 `docs/api-contract.md`。

## Risks / Trade-offs

- [同一瀏覽器的多個分頁共用同一個 `studentId` 與草稿] → 視為同一位學生，可接受；跨裝置驗證請用不同裝置或另一個瀏覽器設定檔。
- [`submission` 事件可能遺漏] → 重新連線與重新整理後都重新讀取本組作答，並讓更新冪等。
- [送出請求逾時但其實已成功] → 重試得到 `ALREADY_SUBMITTED` 時視為已送出，並以伺服器的內容為準。
- [自動測試無法操作 DOM] → 判斷邏輯集中在 `logic.js` 並以測試覆蓋，DOM 部分以手動驗證步驟補足，缺口列入驗證紀錄的未測項目。
- [題目在搶答中不會改變，但草稿可能對應舊題目] → 載入草稿時檢查空格數，不符就丟棄。

## Migration Plan

不需遷移；只動靜態前端檔案。回滾即還原這幾個檔案。

## Open Questions

- 已結束後是否要唯讀顯示本組各題答案：本 change 先不做，等 `add-student-results` 一併決定。
- 題目很多時題號格是否需要分頁或捲動：先用可捲動的格狀排版，之後依實際使用回饋調整。
