# Design: add-buzz-in-submission

## Context

動機與範圍見 proposal。目前狀態：

- `server/index.js` 以記憶體物件 `session = { phase, questions, groups }` 作為唯一權威狀態；`session.questions` 由匯入寫入，格式為 `{ id, prompt, blanks: [{ index, prefix, prompt }] }`，`id` 是學習單題號（可能不連續）。儲存格位置只在匯入模組私有狀態，不在 `session.questions`。
- `groups-entry.js` 的 `lookup(studentId, phase)` 是 `GET /api/student/entry` 判斷進場是否有效的唯一來源。
- SSE（`GET /api/events`）以單一 `eventClients` 集合廣播 `phase` 與 `heartbeat`，連線沒有身分。
- 寫入端點的慣例：先檢查權限（學生端為進場有效性），再檢查階段，最後驗證內容；錯誤一律為 `{"error":{"code","message"}}`。

## Goals / Non-Goals

**Goals:**

- 新增題目讀取、提交、本人組狀態與組別限定事件，全部沿用現有記憶體權威狀態。
- 公開的 `/api/session` 與公開 SSE 事件不揭露任何作答活動。
- 每題建立單調、唯一、不重用的 server 接收順位，並在競態下正確。
- 資料模型預留作廢、公平順位、改選勝者的擴充位置，但不實作。

**Non-Goals:**

- 學生 UI、結果頁與順位公布、教師 API、答案正誤判定、作廢、倒數、公平順位、持久化。
- 修改 `groups-and-entry` 的進場規則或匯入模組的輸出。

## Decisions

### 1. 端點、檢查順序與錯誤代碼

| 端點 | 用途 |
| --- | --- |
| `GET /api/student/questions?studentId=...` | 讀取公開題目 |
| `POST /api/student/submissions` | 提交整題答案；body `{ studentId, questionId, answers }` |
| `GET /api/student/submissions?studentId=...` | 讀取本人組別的作答狀態 |
| `GET /api/events?studentId=...`（既有端點新增可選參數） | 額外訂閱本組 `submission` 事件 |

提交的檢查順序（沿用既有「權限 → 階段 → 內容」，最後才查重複）：

1. `studentId` 格式 → `400 INVALID_STUDENT_ID`（既有代碼）
2. 有效進場 → `403 STUDENT_NOT_ENTERED`
3. 階段須為「搶答中」→ `409 SUBMISSION_NOT_ALLOWED`
4. 題目存在 → `404 QUESTION_NOT_FOUND`（`questionId` 不是題目的 `id` 一律此代碼）
5. 答案內容 → `400 INVALID_ANSWER`（不是陣列、長度不等於 `blanks` 數、非字串、trim 後不是 1–200 字元）
6. 該組該題已有有效作答 → `409 ALREADY_SUBMITTED`

讀題目：先 1、2，再檢查階段，「準備中」回 `409 QUESTIONS_NOT_AVAILABLE`。讀取組狀態：只做 1、2，任何階段皆可（重新整理與已結束後仍需取回）。

新增代碼：`STUDENT_NOT_ENTERED`、`QUESTIONS_NOT_AVAILABLE`、`SUBMISSION_NOT_ALLOWED`、`QUESTION_NOT_FOUND`、`INVALID_ANSWER`、`ALREADY_SUBMITTED`，無一與既有代碼重複。

### 2. 公開題目投影

「搶答中」與「已結束」可讀取；準備中不顯示題目內容（explore 第 6 節第 3 項）。已結束仍可讀，因為結果頁需要題目內容。投影採白名單，每題只含 `id` 與 `blanks`（`index`、`prefix`、空格層 `prompt`）；不回傳題目層 `prompt`（它只是各空格 `prompt` 的串接，內容重複）、`anchorCell`、`answerCell`、來源檔或其他匯入資訊。

替代方案：直接回傳 `session.questions` 較省事，但會暴露題目層 prompt 與日後可能加入的內部欄位，故不採用。

### 3. 進場有效性：沿用同一判斷

三個學生端點都呼叫 `groups.lookup(studentId, session.phase)`，與 `GET /api/student/entry` 回傳 `valid:true` 的條件相同，不複製「組別存在、未移除」的規則。`studentId` 不是認證憑證（api-contract 已明定），此檢查只是把請求綁到所屬組別，不抵禦偽造 `studentId`；課堂內網情境下可接受。

替代方案：提交專用的 membership map 會與進場狀態不一致，不採用。

### 4. 提交資料模型與預留擴充

新增 `server/submissions.js`，純記憶體、同步 API。一筆作答：

```text
{ questionId, groupId, answers: string[],   // answers 為 trim 後的值
  submittedAt,                              // server ISO 8601 UTC
  rank,                                     // 該題的原始接收順位，從 1 起，不重用
  status: 'valid' }                         // 目前只有 valid
```

- 每題一個計數器；每組每題一筆。
- `status` 與 `rank` 是為之後預留：作廢（D24）把 `status` 改為 `voided`，公平順位（D14、D25）在「有效作答」上重新判定，改選勝者（O3）是另一層「最終勝者」。三者之後都是在這份資料上新增欄位或另建對照，不需要改既有欄位。**本 change 只寫入 `valid` 與 `rank`，不實作任何其他狀態。**
- 提供內部讀取函式 `listSubmissions()`（依題目與順位回傳）供測試與之後的教師端使用；本 change 不新增教師 HTTP 端點。

### 5. 競態與原子性

Node 單執行緒下，只要「查重 → 驗證當下狀態 → 寫入 → 取得並遞增順位」在同一個同步區塊內完成就是原子的。`submissions.js` 的提交函式為同步函式，route handler 在呼叫它與回應之間不得插入任何 `await`。順位依「handler 實際執行的順序」決定，也就是 body 解析完成後進入同步區塊的順序，與 server 收到請求的順序一致。

替代方案：先 `await` 寫入儲存層再配置順位會產生競態；本 change 不引入儲存層。

### 6. 提交與組狀態的回應隔離

- `POST` 成功只回 `{ questionId, submittedAt }`，**不含順位**，也不含任何他組資訊（D7：搶答中學生看不到某題是否已被搶走；自己的順位會洩漏這點）。
- `GET /api/student/submissions` 只回本組已提交題目的 `{ questionId, answers, submittedAt }`，**同樣不含順位**。順位在已結束後才可公布，屬於 `add-student-results`。

### 7. 組別限定 SSE

選擇：`GET /api/events` 可選 `studentId` 參數。

- 無參數：行為完全不變，只收 `phase` 與 `heartbeat`。
- 有參數：先以第 3 點的判斷驗證，失敗回標準錯誤（`400 INVALID_STUDENT_ID`／`403 STUDENT_NOT_ENTERED`），不建立連線。成功後連線除了 `phase`、`heartbeat`，還會收到該組的 `submission` 事件，內容為 `{ questionId, answers, submittedAt }`（不含順位）。
- 連線保存 `studentId`，**每次送事件時才查詢該學生目前的組別**，不在連線時固定組別。這樣即使學生在準備中換組，事件也不會送錯組；而搶答中不可換組、組別也不可變動。
- 連線關閉時移除，沿用現有 heartbeat 與 close 清理。

比較過的替代方案：

| 方案 | 取捨 |
| --- | --- |
| 公開事件夾帶作答版本號或提交總數（不採用） | 實作簡單，但可從版本變化推斷他組進度，違反 D7 |
| 維持廣播，只送無內容的「有變動」訊號，學生再自行讀取（不採用） | 仍會讓他組知道有人送出，違反 D7 |
| 輪詢 `GET /api/student/submissions`（不採用） | 無洩漏，但同組裝置要在 2 秒內同步需高頻輪詢，100 組時負載大 |
| **帶 `studentId` 的 SSE 只送本組（採用）** | 無洩漏；事件量只與本組有關；代價是 `studentId` 出現在 URL，它不是憑證，可接受 |

教師端監看連線之後另立 change 加入，本 change 不實作；`submissions.js` 的狀態變更會經由內部訂閱函式發出，之後教師端可直接接上。

### 8. 開發種子

僅在 `NODE_ENV === 'development'`（既有分支）建立 50 題：`id` 1–50，每題含題目層 `prompt` 與 `blanks`；`id` 為 10、20、30、40、50 的題目是 2 空格題組（`prefix` 為「（1）」「（2）」），其餘為單題，方便手動測試題組送出。其他環境不啟用。

### 9. 與 docs/api-contract.md 的一致性，以及不需畫面狀態機的原因

沿用 `/api/student/*` 前綴、`{"data"}`／`{"error"}` envelope、三個階段字串、server 產生的 ISO 8601 UTC 時間。實作時須把端點、範例、錯誤表、檢查順序、SSE 參數與隱私規則寫進契約，並把「待補的公開題目格式」改為正式定義（task 1.1）。本 change 只有 server，沒有前端畫面，因此不需要畫面狀態機；畫面狀態機屬於 `add-student-answering-ui`。

## Risks / Trade-offs

- [`studentId` 非認證，可被偽造] → 沿用既有決定，只做進場關聯檢查；若日後要防偽造需另立認證設計。
- [單一程序記憶體狀態] → 重啟後提交資料消失，與其他記憶體狀態一致；持久化留待後續。
- [組別與題目變動使提交資料過期] → 匯入、設定組別與換組都只能在「準備中」，此時不可能有提交；日後加入活動重設（D19）時必須清空提交資料，已在 explore 第 3 節記錄。
- [題組答案超過 16 KiB body 上限] → 題組空格很少（通常 2–3 格），極端情況會回既有的 `413 BODY_TOO_LARGE`，不另外放寬。
- [100 組同時提交] → 每次提交只做常數時間的 map 操作；以負載測試確認（task 4.1）。
- [SSE 連線數增加] → 每個學生一條連線已是現況（100 條基準已量測），帶參數只多一次組別查詢。

## Migration Plan

不需資料遷移。回滾時移除新增端點、`/api/events` 的 `studentId` 處理與 `submissions.js` 即可。

## Open Questions

- 學生端在 `/api/events?studentId=...` 收到 `403`（例如 server 重啟後進場紀錄消失）時，`EventSource` 不會自動重連，需由學生端改呼叫 `GET /api/student/entry` 恢復進場。這屬於 `add-student-answering-ui` 的畫面狀態機，本 change 只需在契約註明此行為。
- 結果頁何時、如何公布順位與勝者，由 `add-student-results` 決定；本 change 的 `rank` 只在 server 內保存。
