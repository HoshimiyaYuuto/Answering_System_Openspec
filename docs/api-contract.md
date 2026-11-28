# API 契約

本文件定義 server API，是學生端、教師端與 server 共用的唯一契約。所有 API 時間均由 server 產生，使用 ISO 8601 UTC 字串（匯出 csv 的送出時間另依共同契約 D13 以本地時間呈現，見 `csv-export` change）。

## 契約狀態與已知限制

- 本文件只記錄已實作的端點；尚未實作的功能在各自的 change 中新增。學生端送出與組別即時事件已於「搶答送出」章節定義。
- 活動狀態存在 server 記憶體；server 重啟後組別、進場紀錄、已匯入的題目與老師登入狀態全部清空。
- 老師身分驗證（共同契約 D18）以 `TEACHER_PASSWORD` 密碼登入實作（見「老師登入」），已取代原本的 loopback 限制；loopback 只剩開發路由 `/api/dev/phase/:phase` 使用。新增的老師端點一律使用同一個登入檢查。

## 通用格式

- API 前綴：`/api`
- JSON request body 上限：16 KiB。無效 JSON 回 `400`，超過上限回 `413`。
- 成功回應使用 `application/json`：`{"data": {...}}`。
- 錯誤回應使用 `application/json`：`{"error":{"code":"...","message":"..."}}`。錯誤訊息不得包含堆疊、秘密或內部設定。
- 未知路徑回 `404`，內部錯誤回 `500`；錯誤回應一律遵守上述 envelope。
- 內部錯誤（`500 INTERNAL_ERROR`）會在 server 終端機（stderr）留下一筆紀錄：時間、HTTP 方法、不含 query string 的路徑與錯誤堆疊，格式為 `[<ISO 時間>] <方法> <路徑> 500 INTERNAL_ERROR`，下一行起為堆疊。紀錄不含 request body、query string、cookie 與其他標頭；堆疊只出現在終端機，不出現在回應。`400`、`404`、`413` 等用戶端錯誤不記錄。

## 活動摘要

### `GET /api/session`

回傳目前 server 權威狀態：

```json
{
  "data": {
    "phase": "準備中",
    "activityId": null,
    "questionCount": 0,
    "groupCount": 0,
    "countdownEndsAt": null,
    "fairRankingEnabled": false,
    "serverTime": "2026-11-14T00:00:00.000Z"
  }
}
```

`phase` 值為 `準備中`、`搶答中`、`已結束`。
`groupCount` 為目前實際組別數。
`activityId` 在首場開始前為 `null`；每次成功開始搶答時由 server 產生新的 UUID，並在該場活動期間（含已結束階段）保持不變，重設活動後回到 `null`。學生端可用它區隔本場草稿；此識別碼不包含組別或作答資訊。重啟 server 後，新的活動會取得新的識別碼。
`countdownEndsAt` 是倒數結束的時間（ISO 8601 UTC），只在搶答中且開始時設定了倒數才有值，其他情況為 `null`。剩餘時間請以 `countdownEndsAt` 減去 `serverTime` 計算，不要用用戶端時鐘（共同契約 D15）。
`fairRankingEnabled` 為本場是否啟用公平順位（共同契約 D14），由開始搶答時的設定決定；首場開始前與重設後為 `false`，搶答中與已結束維持開始時的值。

## 老師登入

老師以環境變數 `TEACHER_PASSWORD` 設定的密碼登入。登入狀態存在 HttpOnly cookie，瀏覽器會自動附在之後的請求上，頁面 JavaScript 讀不到。以下標示「需老師登入」的端點，未登入時一律回 `401 TEACHER_AUTH_REQUIRED`，且檢查順序為登入 → 階段 → 請求內容。是否需要登入與請求來源無關：localhost 未登入也會被拒絕，區網裝置登入後也能操作；server 不採信 `X-Forwarded-For` 等轉發標頭。

需老師登入的端點：`PUT /api/groups`、`POST /api/groups/generate`、`POST /api/session/start`、`POST /api/session/end`、`POST /api/session/reset`、`GET /api/teacher/presence`，以及「Guided Notes 匯入」一節的四個端點。學生端點、`GET /api/session`、`GET /api/groups`、`GET /api/events` 不需登入。

登入狀態維持到登出、關閉瀏覽器或 server 重新啟動為止。回應內容不包含密碼或 token。

### `POST /api/teacher/login`

Request：

```json
{ "password": "<老師密碼>" }
```

成功回 `200`，並設定 cookie：

```text
Set-Cookie: teacher_session=<token>; HttpOnly; SameSite=Strict; Path=/
```

```json
{ "data": { "authenticated": true } }
```

| HTTP | Code | 情況 |
| --- | --- | --- |
| 400 | `INVALID_LOGIN_REQUEST` | 沒有 `password` 欄位，或不是字串 |
| 401 | `WRONG_PASSWORD` | 密碼錯誤 |
| 429 | `TOO_MANY_ATTEMPTS` | 同一來源 60 秒內已有 10 次密碼錯誤；限制期間即使密碼正確也拒絕 |
| 503 | `TEACHER_PASSWORD_NOT_SET` | server 沒有設定 `TEACHER_PASSWORD`（或為空字串），任何密碼都無法登入 |

### `POST /api/teacher/logout`

不需 request body。使目前的登入狀態失效並清除 cookie，未登入時呼叫也回 `200`：

```json
{ "data": { "authenticated": false } }
```

### `GET /api/teacher/auth`

不需登入。回傳目前請求是否已登入，以及 server 是否已設定老師密碼，供教師頁決定顯示哪個畫面：

```json
{ "data": { "authenticated": false, "passwordConfigured": true } }
```

### PowerShell 登入範例

`-SessionVariable` 保存登入後的 cookie，之後的請求以 `-WebSession` 帶上：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<老師密碼>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
```

## 階段控制

以下控制端點需老師登入（見「老師登入」），未登入回 `401 TEACHER_AUTH_REQUIRED`。

### `POST /api/session/start`

僅允許 `準備中` 轉為 `搶答中`。body 可以為空，或帶倒數秒數（共同契約 D15、D20）與公平順位設定（共同契約 D14）：

```json
{ "countdownSeconds": 300, "fairRankingEnabled": true }
```

`countdownSeconds` 省略或為 `null` 表示不倒數。`fairRankingEnabled` 省略表示不啟用，有帶時必須是布林值（`null` 也會被拒絕）；開始後到重設前都不能變更。依序檢查：

1. 階段不是 `準備中` → `409 INVALID_PHASE_TRANSITION`
2. 沒有任何組別 → `409 NO_GROUPS`
3. 沒有任何題目 → `409 QUESTIONS_REQUIRED`
4. `countdownSeconds` 不是 10 至 3600 的整數 → `400 COUNTDOWN_OUT_OF_RANGE`（訊息「倒數時間需介於 10 秒到 60 分鐘。」）
5. `fairRankingEnabled` 不是布林值 → `400 INVALID_FAIR_RANKING`（訊息「公平順位設定必須是是或否。」）

成功回 `200`，並回傳更新後的 `phase`、`countdownEndsAt`、`fairRankingEnabled` 與 `serverTime`。被拒絕時階段不變，也不發布階段事件。

有倒數時，server 在 `countdownEndsAt` 自動把階段改為 `已結束`，效果與老師呼叫 `POST /api/session/end` 相同：發布階段事件，之後的送出被拒絕。倒數存在 server 記憶體，server 重啟後就消失。

### `POST /api/session/end`

要求 body 為空，僅允許 `搶答中` 轉為 `已結束`。成功回 `200`，並回傳更新後的 `phase` 與 `serverTime`；進行中的倒數會停止，`countdownEndsAt` 變為 `null`。不允許的階段轉移回 `409 INVALID_PHASE_TRANSITION`，包含倒數已經先讓活動結束的情況。

### `POST /api/session/reset`

要求 body 為空，僅允許 `已結束` 轉為 `準備中`（共同契約 D19，v0.10 與 SpecKit 組談定）。其他階段回 `409 INVALID_PHASE_TRANSITION`（訊息「只能在已結束時重設活動。」），資料不變。

重設時：

- **清空**：本場所有作答（含已作廢）、所有學生進場紀錄、倒數，`activityId` 回到 `null`，公平順位設定回到不啟用（`fairRankingEnabled: false`）。
- **保留**：組別、已匯入的題目與學習單來源、老師登入狀態。
- **連線**：以學生身分連線的事件串流（`/api/events?studentId=...`）收到 `reset` 事件後由 server 關閉；其他連線收到 `phase`（`準備中`）並保持開啟。見「階段事件」。
- 重設前已進場的學生，之後查詢進場會得到 `reason: activity_reset`，需重新選組。

成功回 `200`：

```json
{ "data": { "phase": "準備中", "serverTime": "2026-11-14T00:00:00.000Z" } }
```

確認對話框由教師控制台負責，API 不需要確認欄位。

## 階段事件

### `GET /api/events`

以 Server-Sent Events 傳送階段變更。事件格式：

```text
event: phase
data: {"phase":"搶答中","countdownEndsAt":"2026-11-14T00:05:00.000Z","fairRankingEnabled":false,"serverTime":"2026-11-14T00:00:00.000Z"}

```

`countdownEndsAt`、`fairRankingEnabled` 與 `GET /api/session` 相同，沒有倒數時 `countdownEndsAt` 為 `null`。每次階段變化（含倒數歸零自動結束、重設回準備中）後兩秒內通知所有已連線 client。

老師重設活動時，學生連線先收到 `reset` 事件，接著連線被 server 關閉；事件內容只有 server 時間，不含作答或組別資訊：

```text
event: reset
data: {"serverTime":"2026-11-14T00:00:00.000Z"}

```

收到 `reset` 後，學生端應清除本地進場並回到選組頁。瀏覽器自動重連時，原 `studentId` 會得到 `403 STUDENT_NOT_ENTERED`。

連線建立後 server 先送 `retry: 3000`，指定瀏覽器自動重連間隔為 3 秒。

server 每 15 秒傳送具名心跳事件，讓前端程式能偵測連線狀態：

```text
event: heartbeat
data: {"serverTime":"2026-11-14T00:00:00.000Z"}

```

client 若超過 40 秒沒收到任何事件（含 `phase` 與 `heartbeat`），應視為斷線並顯示重連提示。重新連線後使用 `GET /api/session` 取得權威快照。

## 錯誤狀態

| HTTP | Code | 用途 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | JSON 格式錯誤或請求欄位無效 |
| 400 | `INVALID_LOGIN_REQUEST` | 登入請求缺少密碼或密碼不是字串 |
| 400 | `COUNTDOWN_OUT_OF_RANGE` | 開始搶答的 `countdownSeconds` 不是 10 至 3600 的整數 |
| 400 | `INVALID_FAIR_RANKING` | 開始搶答的 `fairRankingEnabled` 不是布林值 |
| 401 | `TEACHER_AUTH_REQUIRED` | 呼叫需老師登入的端點時未登入或登入已失效 |
| 401 | `WRONG_PASSWORD` | 老師密碼錯誤 |
| 403 | `LOOPBACK_ONLY` | 僅用於 `NODE_ENV=development` 的開發路由 `/api/dev/phase/:phase`，呼叫來源不是 loopback |
| 404 | `NOT_FOUND` | API 路徑不存在 |
| 409 | `INVALID_PHASE_TRANSITION` | 階段轉移不合法 |
| 409 | `NO_GROUPS` | 沒有任何組別時開始搶答 |
| 409 | `QUESTIONS_REQUIRED` | 沒有任何題目時開始搶答 |
| 429 | `TOO_MANY_ATTEMPTS` | 同一來源短時間內密碼錯誤太多次 |
| 503 | `TEACHER_PASSWORD_NOT_SET` | server 未設定老師密碼 |
| 413 | `BODY_TOO_LARGE` | JSON body 超過 16 KiB |
| 500 | `INTERNAL_ERROR` | 未預期 server 錯誤 |

## 組別與學生進場

本節新增端點均使用通用 JSON envelope。組別設定寫入端點 `PUT /api/groups` 與 `POST /api/groups/generate` 需老師登入，且僅允許在階段為 `準備中` 時執行。未登入回 `401 TEACHER_AUTH_REQUIRED`，階段不符回 `409 GROUP_CONFIG_NOT_ALLOWED`。檢查順序依序為登入、階段、請求內容驗證。教師端可由 localhost 或區網位址開啟。`GET /api/groups` 與學生進場端點不需登入。

### `GET /api/groups`

取得依 `id` 遞增排序的組別清單，不需 request body。

```json
{
  "data": {
    "groups": [
      { "id": 1, "name": "第 1 組" },
      { "id": 2, "name": "第 2 組" }
    ]
  }
}
```

尚未設定任何組別時回傳 `{"data":{"groups":[]}}`。

### `PUT /api/groups`

以完整清單取代現有組別。需老師登入，僅限 `準備中`。`groups` 必須包含 1 至 100 組；每個 `id` 是 1 至 100 的不重複正整數；每個 `name` 去除前後空白後長度為 1 至 30 字元，且名稱不重複。保留仍存在之組別 id 的學生進場關聯。

Request：

```json
{
  "groups": [
    { "id": 1, "name": "第一組" },
    { "id": 2, "name": "第二組" }
  ]
}
```

成功回 `200`，回傳套用後的清單：

```json
{
  "data": {
    "groups": [
      { "id": 1, "name": "第一組" },
      { "id": 2, "name": "第二組" }
    ]
  }
}
```

### `POST /api/groups/generate`

依組數產生並套用預設名稱「第 N 組」。需老師登入，僅限 `準備中`；`count` 必須為 1 至 100 的整數，產生的組別 id 為 1 至 `count`。

Request：

```json
{ "count": 3 }
```

成功回 `200`：

```json
{
  "data": {
    "groups": [
      { "id": 1, "name": "第 1 組" },
      { "id": 2, "name": "第 2 組" },
      { "id": 3, "name": "第 3 組" }
    ]
  }
}
```

### 學生識別碼與進場規則

`studentId` 由學生端產生並儲存在瀏覽器本地，長度為 8 至 64 字元，僅可包含英文字母、數字及連字號（`-`）；它只用於恢復同一瀏覽器的進場狀態，不是認證憑證。首次進場可在任一階段選擇現有組別；已進場的 `studentId` 只有在 `準備中` 才能更換組別。不同 `studentId` 可同時進入同一組。

### `PUT /api/student/entry`

首次進場可於任何階段呼叫；既有學生更換組別僅限 `準備中`。不需帳號或密碼。

Request：

```json
{ "studentId": "stu-abc123", "groupId": 2 }
```

`groupId` 缺少或不是整數回 `400 INVALID_GROUPS`；選同一組視為重複進場，任一階段回 `200`。

成功回 `200`，包含目前階段與所屬組別：

```json
{
  "data": {
    "valid": true,
    "studentId": "stu-abc123",
    "group": { "id": 2, "name": "第 2 組" },
    "phase": "準備中"
  }
}
```

選擇不存在的組別回 `404 GROUP_NOT_FOUND`；`studentId` 格式不符回 `400 INVALID_STUDENT_ID`；非 `準備中` 時既有學生要求換組回 `409 GROUP_CHANGE_NOT_ALLOWED`。

### `GET /api/student/entry?studentId=...`

以 query string 傳入 `studentId`，查詢並恢復進場狀態。有效進場回 `200`：

```json
{
  "data": {
    "valid": true,
    "studentId": "stu-abc123",
    "group": { "id": 2, "name": "第 2 組" },
    "phase": "搶答中"
  }
}
```

組別已刪除或進場紀錄已重設時仍回 `200`，由 `valid:false` 與 `reason` 說明失效原因；學生端應清除舊進場並返回選組畫面：

```json
{
  "data": {
    "valid": false,
    "studentId": "stu-abc123",
    "reason": "group_removed"
  }
}
```

`reason` 為下列其中一個：

- `group_removed`：所屬組別已被移除。
- `activity_reset`：老師重設活動前已進場，重設後尚未重新選組。重新選組進場後就不再回報。
- `entry_reset`：其他沒有該 `studentId` 進場紀錄的情況，包含 server 重啟後記憶體清空。從未進場過的 `studentId` 也回 `200` 加 `valid:false` 與 `reason: entry_reset`。

### 新增錯誤狀態

以下錯誤沿用既有錯誤 envelope；本表不改變前述既有錯誤代碼定義。

| HTTP | Code | 用途 |
| --- | --- | --- |
| 400 | `INVALID_GROUPS` | 組別清單、組數、id 或組名驗證失敗 |
| 400 | `INVALID_STUDENT_ID` | `studentId` 不符合 8–64 字元英數與連字號格式 |
| 404 | `GROUP_NOT_FOUND` | 學生進場時指定的組別不存在 |
| 409 | `GROUP_CHANGE_NOT_ALLOWED` | 非準備中階段要求更換既有進場組別 |
| 409 | `GROUP_CONFIG_NOT_ALLOWED` | 非準備中階段要求設定或產生組別 |

所有階段欄位及事件仍只使用既有三個值：`準備中`、`搶答中`、`已結束`。

## Guided Notes 匯入

本節端點供教師端匯入 Guided Notes（填空學習單）。匯入分兩步：先取得摘要（預覽），老師確認後題目才生效並取代 `session.questions`；`GET /api/session` 的 `questionCount` 隨之更新。

本節四個端點都需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`，與其他老師端點共用同一個登入檢查（`requireTeacher`）。寫入端點（兩個預覽與確認）的檢查順序為登入、階段、請求內容：非 `準備中` 回 `409 IMPORT_NOT_ALLOWED`。上傳端點在讀取檔案內容之前就先檢查登入。

辨識規則：在任一工作表中尋找同一列內容為「題號」「題目」「作答」的表頭列；表頭以下題號欄為正整數的列為一題；題號儲存格向下合併多列時為題組，每一列一個空格。不依賴固定儲存格位置。每個空格在原檔中的位置只保存在 server，不出現在任何 API 回應中。匯入後的位置只作為預設參考：以 Google 試算表連結匯入時，server 另保存試算表 ID 與工作表，寫回線上試算表（共同契約 D12）前須重新讀取並依同一規則重新定位，不得只依匯入當時的儲存格位置寫入。這些內部資訊同樣不出現在 API 回應中。

### `POST /api/teacher/guided-notes/preview/file`

上傳 xlsx 原始位元組並取得摘要。

- `Content-Type`：`application/octet-stream` 或 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `X-File-Name`：檔名（以 `encodeURIComponent` 編碼，可省略）
- body 上限 5 MiB，超過回 `413 IMPORT_FILE_TOO_LARGE`；此上限只適用本端點，其他端點仍為 16 KiB JSON。

成功回 `200`：

```json
{
  "data": {
    "previewId": "5f0c2a7e-6c1b-4b7e-9a39-1f2d3c4b5a69",
    "source": { "type": "file", "name": "02-official-group.xlsx" },
    "sheetName": "學習單",
    "headerRow": 4,
    "questionCount": 4,
    "blankCount": 6,
    "questions": [
      { "id": 1, "type": "group", "blankCount": 2, "prefixes": ["（1）", "（2）"] },
      { "id": 3, "type": "single", "blankCount": 1, "prefixes": [""] }
    ],
    "warnings": [],
    "warningDetails": [],
    "replacesExisting": false
  }
}
```

- `id` 為學習單上的題號，不重新編號（可能不連續）。送出、結果與匯出一律以此 `id` 作為題號。
- `type` 為 `single`（單題）或 `group`（題組）。
- `warnings` 為提醒文字陣列（繁體中文），例如作答格已有非前綴內容。
- `warningDetails` 與 `warnings` 一一對應、順序相同，供介面依語言組句（`add-teacher-language-switch`）。每筆為 `{ "code", "questionId", "blankIndex", "cell" }`；目前唯一的代碼是 `ANSWER_CELL_NOT_EMPTY`（作答格已有內容，匯出時會被取代），例如 `{ "code": "ANSWER_CELL_NOT_EMPTY", "questionId": 2, "blankIndex": 1, "cell": "C7" }`。用戶端遇到不認得的 `code` 時應改顯示 `warnings` 對應的文字。
- `replacesExisting` 為 `true` 時，表示目前已有題目，確認後會被取代。
- server 只保留最新一份預覽；取得新預覽後，舊的 `previewId` 失效。取消匯入只需丟棄預覽，不需呼叫 API。

### `POST /api/teacher/guided-notes/preview/link`

以 Google 試算表連結匯入。試算表須開放「知道連結者可檢視」，不需要帳號或金鑰。

Request：

```json
{ "url": "https://docs.google.com/spreadsheets/d/<試算表ID>/edit?usp=sharing" }
```

只接受 `https://docs.google.com/spreadsheets/d/<id>` 形式的連結；server 自行組成該試算表的 xlsx 匯出網址下載，不連線到其他主機。下載逾時 10 秒、上限 5 MiB。成功回應格式與上傳相同，`source.type` 為 `link`。

### `POST /api/teacher/guided-notes/confirm`

套用最新的預覽。

Request：

```json
{ "previewId": "5f0c2a7e-6c1b-4b7e-9a39-1f2d3c4b5a69" }
```

成功回 `200`，`current` 為套用後的匯入摘要（欄位同預覽，不含 `previewId` 與 `replacesExisting`，另含 `importedAt`）：

```json
{
  "data": {
    "current": {
      "source": { "type": "file", "name": "02-official-group.xlsx" },
      "sheetName": "學習單",
      "headerRow": 4,
      "questionCount": 4,
      "blankCount": 6,
      "questions": [{ "id": 1, "type": "group", "blankCount": 2, "prefixes": ["（1）", "（2）"] }],
      "warnings": [],
      "warningDetails": [],
      "importedAt": "2026-11-17T09:00:00.000Z"
    }
  }
}
```

`previewId` 不是最新的預覽時回 `409 IMPORT_PREVIEW_EXPIRED`，題目不變。

### `GET /api/teacher/guided-notes`

取得目前已套用的匯入摘要，需老師登入。尚未匯入時：

```json
{ "data": { "current": null } }
```

### 匯入錯誤狀態

以下錯誤沿用既有錯誤 envelope；任何匯入失敗都不改變目前的題目。

| HTTP | Code | 用途 |
| --- | --- | --- |
| 400 | `IMPORT_INVALID_FILE` | 沒有內容、不是 xlsx，或檔案損壞無法讀取 |
| 413 | `IMPORT_FILE_TOO_LARGE` | 上傳或下載的檔案超過 5 MiB |
| 400 | `IMPORT_NO_HEADER` | 所有工作表都找不到「題號／題目／作答」表頭列 |
| 400 | `IMPORT_NO_QUESTIONS` | 有表頭但下方沒有任何數字題號 |
| 400 | `IMPORT_DUPLICATE_NUMBER` | 題號重複，訊息含題號與兩個列號 |
| 400 | `IMPORT_INVALID_LINK` | 不是 Google 試算表連結 |
| 502 | `IMPORT_LINK_UNREACHABLE` | 下載失敗、逾時，或下載內容不是 xlsx（通常是未開放檢視） |
| 409 | `IMPORT_NOT_ALLOWED` | 非 `準備中` 時要求匯入或確認 |
| 409 | `IMPORT_PREVIEW_EXPIRED` | `previewId` 不是最新的預覽 |

### PowerShell 範例

先依「老師登入」的範例取得 `$teacher`，再執行：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/preview/file -ContentType 'application/octet-stream' -Headers @{ 'X-File-Name' = '01-official-single.xlsx' } -InFile fixtures/guided-notes/01-official-single.xlsx -WebSession $teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/confirm -ContentType 'application/json' -Body '{"previewId":"<上一步回傳的 previewId>"}' -WebSession $teacher
Invoke-RestMethod http://localhost:3000/api/teacher/guided-notes -WebSession $teacher
```

## 搶答送出

本節學生端點以 `studentId` 關聯有效進場紀錄。`studentId` 不是認證憑證。成功回應使用 `{"data": ...}`，錯誤沿用通用 `{"error":{"code","message"}}` envelope。

### `GET /api/student/questions?studentId=...`

先驗證 `studentId` 格式，再確認有效進場，最後檢查階段。準備中回 `409 QUESTIONS_NOT_AVAILABLE`；搶答中與已結束可讀取題目。

```json
{
  "data": {
    "questions": [
      { "id": 1, "blanks": [{ "index": 0, "prefix": "", "prompt": "水的化學式是" }] },
      { "id": 10, "blanks": [
        { "index": 0, "prefix": "（1）", "prompt": "首都為" },
        { "index": 1, "prefix": "（2）", "prompt": "人口最多的城市為" }
      ] }
    ]
  }
}
```

每題公開格式正式定義為只有 `id` 與 `blanks`；每個 blank 只有 `index`、`prefix`、`prompt`。不包含題目層 `prompt`、儲存格位置、原始檔內容、試算表 ID 或其他匯入資訊。

### `POST /api/student/submissions`

提交整題答案。依序檢查：

1. `studentId` 格式，錯誤回 `400 INVALID_STUDENT_ID`。
2. 有效進場，錯誤回 `403 STUDENT_NOT_ENTERED`。
3. 階段為「搶答中」，否則回 `409 SUBMISSION_NOT_ALLOWED`。
4. 題目存在，否則回 `404 QUESTION_NOT_FOUND`。
5. `answers` 為陣列、長度等於該題空格數，且每項為字串；trim 後長度須為 1–200 字元，否則回 `400 INVALID_ANSWER`。
6. 該組該題尚無有效作答，否則回 `409 ALREADY_SUBMITTED`。

Request：

```json
{ "studentId": "stu-abc123", "questionId": 1, "answers": ["H2O"] }
```

成功回 `200`。回應不含順位：

```json
{ "data": { "questionId": 1, "submittedAt": "2026-11-14T00:00:00.000Z" } }
```

每組每題最多一筆有效作答。順位在搶答中只存在 server 內，不經任何學生端 API 公開；活動結束後，學生只能透過「學生結果」章節取得自己組的名次。

### `GET /api/student/submissions?studentId=...`

先驗證 `studentId` 格式，再確認有效進場；任何階段均可查詢，只回該學生所屬組別的作答，不含順位或他組資訊。

```json
{
  "data": {
    "submissions": [
      { "questionId": 1, "answers": ["H2O"], "submittedAt": "2026-11-14T00:00:00.000Z" }
    ],
    "voided": [
      { "questionId": 2, "voidedAt": "2026-11-14T00:01:00.000Z" }
    ]
  }
}
```

- `submissions`：該組目前的有效作答，依題號排序。
- `voided`：該組作答已被老師作廢、且尚未重送的題目，依題號排序（見「作答作廢」）；同題作廢多次時為最後一次的作廢時間。重送成功後該題改列在 `submissions`。沒有時為空陣列。

### `GET /api/events` 的組別作答事件

可選擇帶 `studentId` query 參數。無參數時行為不變，只收到既有 `phase` 與 `heartbeat` 事件。帶參數時先依 `studentId` 格式與有效進場檢查；無效格式回 `400 INVALID_STUDENT_ID`，沒有有效進場回 `403 STUDENT_NOT_ENTERED`，並以標準錯誤 envelope 拒絕且不建立 SSE 連線。這種失敗回應不會讓 `EventSource` 自動重連。

成功連線除既有事件外，只會收到該組的 `submission` 與 `void` 事件：

```text
event: submission
data: {"questionId":1,"answers":["H2O"],"submittedAt":"2026-11-14T00:00:00.000Z"}

event: void
data: {"questionId":1,"voidedAt":"2026-11-14T00:01:00.000Z"}

```

`void` 表示該組該題的作答已被老師作廢，該組可重新送出（見「作答作廢」）。兩種事件內容都不含順位。送出事件時依 `studentId` 目前有效進場狀態查詢組別。未帶 `studentId` 的連線、公開階段事件及 `GET /api/session` 均不含作答、提交數量或可推出他組狀況的資訊。

### 搶答送出錯誤狀態

以下錯誤沿用通用錯誤 envelope；既有通用「錯誤狀態」表不變。

| HTTP | Code | 用途 |
| --- | --- | --- |
| 403 | `STUDENT_NOT_ENTERED` | 學生沒有有效進場紀錄 |
| 409 | `QUESTIONS_NOT_AVAILABLE` | 準備中讀取題目 |
| 409 | `SUBMISSION_NOT_ALLOWED` | 非搶答中階段提交答案 |
| 404 | `QUESTION_NOT_FOUND` | 提交的題目不存在 |
| 400 | `INVALID_ANSWER` | 答案陣列、空格數或答案內容不符規則 |
| 409 | `ALREADY_SUBMITTED` | 該組該題目前已有有效作答（被老師作廢後可重送） |

### PowerShell 範例

先登入老師，再以同一個 `-WebSession` 開始搶答；development 種子已有組別與題目：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<老師密碼>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","groupId":1}'
Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=stu-aaaa1111"
Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":1,"answers":["H2O"]}'
Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=stu-aaaa1111"
```

## Guided Notes 匯出

活動「已結束」後，把每題成功答案寫回 Guided Notes。成功答案為 `computeResults()` 判定的勝者那一筆作答（見 [作答紀錄與判定結果](submission-record.md)），以 `questionId` + `winner.rank` 查回答案；無勝者的題目不寫入。三個端點都需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`；匯出不改變作答、題目或階段。

每格寫入內容：前綴與答案格分離時（例如 G5 為「（1）」、H5 空白）只寫答案到 H5；前綴位於合併填答區時（答案位置等於前綴格）寫「前綴＋答案」；沒有前綴時只寫答案。答案一律以純文字寫入，「=1+1」不會被當成公式。

### `GET /api/teacher/guided-notes/export`

下載以原匯入檔為底、答案寫在匯入時保存的答案位置的 xlsx。上傳與連結兩種來源都可用，也是寫回失敗時的備援。

- 成功：`200`，`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，`Content-Disposition: attachment; filename="guided-notes-answers.xlsx"; filename*=UTF-8''<原檔名去掉 .xlsx>（搶答結果）.xlsx`。
- 錯誤一律為 JSON envelope，所以前端以 `fetch` 取得後再觸發下載。
- 下載的 xlsx 由 exceljs 重新產生，條件式格式、圖片等少數格式可能遺失。

### `POST /api/teacher/guided-notes/writeback`

只適用於以 Google 試算表連結匯入。以服務帳號呼叫 Sheets API `values.batchUpdate`（`valueInputOption: RAW`）寫入原線上試算表，只改答案儲存格的值。依序檢查，任一步失敗就不寫入：

1. 老師登入，否則 `401 TEACHER_AUTH_REQUIRED`
2. 階段為「已結束」，否則 `409 EXPORT_NOT_ALLOWED`
3. 已匯入學習單，否則 `409 NO_GUIDED_NOTES`
4. 以連結匯入，否則 `409 GUIDED_NOTES_NOT_LINK`
5. server 已設定服務帳號，否則 `503 SHEET_NOT_CONFIGURED`
6. 沒有其他寫回正在進行，否則 `409 WRITEBACK_IN_PROGRESS`
7. 沒有任何成功答案時直接回 `{ "writtenCells": 0, "remapped": false }`，不連 Google
8. 以公開連結重新讀取線上試算表，用匯入時同一套表頭與題號規則重新定位（O6）；讀不到回 `502 SHEET_CHECK_FAILED`，題號集合、空格數不同或表頭無法辨識回 `409 SHEET_MODIFIED`
9. 寫入新位置，前綴沿用匯入時的值

成功：

```json
{ "data": { "writtenCells": 6, "remapped": true } }
```

`remapped` 為 `true` 表示線上試算表的版面在匯入後有變動（例如插入一列），答案已依題號重新對位。第二次寫回不會清除本次無人作答、上一次留下的答案。

### `GET /api/teacher/guided-notes/writeback`

查詢寫回設定，任何階段可呼叫：

```json
{ "data": { "configured": true, "serviceAccountEmail": "writer@project.iam.gserviceaccount.com", "target": "link" } }
```

`target` 為 `link`（以連結匯入，可寫回）、`file`（上傳，只能下載）或 `null`（尚未匯入）。服務帳號信箱不是機密，老師需要把試算表共用給它；未設定時 `configured` 為 `false`、`serviceAccountEmail` 為 `null`。回應不含試算表 ID。

### 匯出錯誤狀態

所有寫回錯誤的訊息都會提示可改用「下載 xlsx」。回應與 log 不含金鑰、存取權杖、答案、試算表內容或 Google 原始錯誤內容；log 只記錄寫入格數與錯誤代碼。

| HTTP | Code | 用途 |
| --- | --- | --- |
| 409 | `EXPORT_NOT_ALLOWED` | 活動尚未結束 |
| 409 | `NO_GUIDED_NOTES` | 尚未匯入學習單 |
| 409 | `GUIDED_NOTES_NOT_LINK` | 上傳的 xlsx 沒有線上試算表可寫回 |
| 503 | `SHEET_NOT_CONFIGURED` | server 未設定服務帳號 |
| 409 | `WRITEBACK_IN_PROGRESS` | 前一次寫回尚未完成 |
| 502 | `SHEET_CHECK_FAILED` | 寫回前無法重新讀取線上試算表（例如已取消「知道連結者可檢視」） |
| 409 | `SHEET_MODIFIED` | 線上試算表的題號或空格數與匯入時不同，訊息指出第一個差異 |
| 503 | `SHEET_AUTH_FAILED` | 服務帳號認證失敗 |
| 503 | `SHEET_API_DISABLED` | 服務帳號所屬專案未啟用 Sheets API |
| 422 | `SHEET_NOT_EDITABLE` | 服務帳號沒有編輯權限，訊息包含應共用的服務帳號信箱 |
| 422 | `SHEET_NOT_FOUND` | 找不到試算表 |
| 422 | `SHEET_NOT_NATIVE` | 雲端上的檔案仍是 xlsx，需先「儲存為 Google 試算表」 |
| 422 | `SHEET_TAB_NOT_FOUND` | 找不到要寫入的工作表 |
| 502 | `SHEET_UNAVAILABLE` | Google 限流、5xx、網路錯誤或逾時 |

與 SpecKit 組 006 的差異（使用者看到的行為一致）：端點放在 `/api/teacher/guided-notes/` 下、狀態類錯誤用 409、沒有 `force` 參數（題號對不上一律拒絕寫入）。

### PowerShell 範例

先登入並取得 `$teacher`（見「老師登入」），活動結束後：

```powershell
Invoke-RestMethod http://localhost:3000/api/teacher/guided-notes/writeback -WebSession $teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/writeback -WebSession $teacher
Invoke-WebRequest http://localhost:3000/api/teacher/guided-notes/export -WebSession $teacher -OutFile answers.xlsx
```

## 老師監看

### `GET /api/teacher/monitor`

需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`。任何階段都可查詢，查詢不改變任何狀態。名次、勝者與 `settled` 一律取自 server 的 `computeResults()`（見 [作答紀錄與判定結果](submission-record.md)），前端不自行排名。

```json
{
  "data": {
    "phase": "搶答中",
    "groupCount": 3,
    "questions": [
      {
        "id": 1,
        "prompt": "水的化學式是",
        "settled": true,
        "winner": { "groupId": 1, "groupName": "第 1 組", "answers": ["H2O"] },
        "winnerSource": "arrival",
        "submittedCount": 2,
        "entries": [
          { "groupId": 1, "groupName": "第 1 組", "rank": 1, "status": "valid", "place": 1, "answers": ["H2O"], "submittedAt": "2026-11-14T00:00:00.000Z" },
          { "groupId": 2, "groupName": "第 2 組", "rank": 2, "status": "valid", "place": 2, "answers": ["水"], "submittedAt": "2026-11-14T00:00:01.000Z" }
        ],
        "notSubmitted": [{ "groupId": 3, "groupName": "第 3 組" }]
      }
    ]
  }
}
```

| 欄位 | 說明 |
| --- | --- |
| `questions` | 依題號排序，每題都會出現（包含無人作答） |
| `prompt` | 題目層敘述（只給老師；學生端題目不含此欄） |
| `settled` | `false` 表示判定中：啟用公平順位且該題第一個有效作答送達後 3 秒的批次尚未結束；此時 `winner` 為 `null`。活動已結束時一律為 `true` |
| `winner` | 勝者組別與該筆答案；無有效作答或判定中為 `null` |
| `winnerSource` | `arrival`／`fair`；`winner` 為 `null` 時為 `null` |
| `submittedCount` | 該題有效作答數 |
| `entries` | 該題所有作答（有效與已作廢），依 `rank` 排序；`status` 為 `valid` 或 `voided`，已作廢的 `place` 為 `null` |
| `notSubmitted` | 該題沒有任何作答的組別，依組別 id 排序 |

組別已不存在時組名顯示為 `組 <id>`。

```powershell
Invoke-RestMethod http://localhost:3000/api/teacher/monitor -WebSession $teacher | ConvertTo-Json -Depth 6
```

### `GET /api/events?role=teacher` 的監看通知

老師控制台以 `role=teacher` 連線，瀏覽器會自動帶上老師登入 cookie。未登入回 `401 TEACHER_AUTH_REQUIRED`，不建立 SSE 連線；其他 `role` 值視為一般公開連線。

成功連線除既有的 `phase` 與 `heartbeat` 外，任何一組成功送出後都會收到：

```text
event: monitor
data: {"serverTime":"2026-11-14T00:00:00.000Z"}

```

事件只表示「監看資料已改變」，不含作答內容，老師端收到後重新呼叫 `GET /api/teacher/monitor`。老師作廢作答成功後也會送出同一個通知（見「作答作廢」）。啟用公平順位且在搶答中時，某題的 3 秒批次結束後 2 秒內也會送出同一個通知，即使期間沒有新的送出，讓「判定中」的題目更新為最終名次；未啟用時不會有這種通知。每次通知時才檢查登入狀態，老師登出後同一條連線不再收到 `monitor`。學生連線（`studentId`）與未帶參數的公開連線都不會收到 `monitor`。

## 各組在線狀態

供投影看板顯示各組是否在線（共同契約 D16）。某組至少有一位**有效進場**學生的事件連線（`/api/events?studentId=...`）開著時，該組為在線。在線狀態每次即時由目前的連線推算，不另外儲存；換組、組別被刪除、重設活動都會立即反映。

### `GET /api/teacher/presence`

需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`。成功回 `200`，組別依編號排序：

```json
{
  "data": {
    "groups": [
      { "id": 1, "name": "第 1 組", "online": true },
      { "id": 2, "name": "第 2 組", "online": false }
    ],
    "serverTime": "2026-11-14T00:00:00.000Z"
  }
}
```

### `GET /api/events?role=teacher` 的在線通知

以下情況發生後，已登入老師的連線會收到：

```text
event: presence
data: {"serverTime":"2026-11-14T00:00:00.000Z"}

```

- 學生事件連線開啟或關閉；
- `PUT /api/student/entry` 成功（進場或換組）；
- `PUT /api/groups`、`POST /api/groups/generate` 成功；
- `POST /api/session/reset` 成功。

事件只表示「在線狀態已改變」，不含組別或作答資料，收到後重新呼叫 `GET /api/teacher/presence`。和 `monitor` 一樣每次通知時檢查登入狀態。學生連線與公開連線都不會收到 `presence`，`GET /api/session` 與 `phase` 事件也不含任何在線資訊。

## 作答作廢

共同契約 D24。作答紀錄的狀態規則見 [作答紀錄與判定結果](submission-record.md) 第 1 節。

### `POST /api/teacher/submissions/void`

需老師登入。作廢指定題目中指定接收順位的作答：

```json
{ "questionId": 1, "rank": 1 }
```

`rank` 取自 `GET /api/teacher/monitor` 的 `entries[].rank`。以順位而不是組別指定，是為了避免老師連按兩次時誤作廢該組剛重送的作答。

依序檢查：

1. 未登入 → `401 TEACHER_AUTH_REQUIRED`
2. `questionId` 或 `rank` 不是正整數 → `400 INVALID_VOID_REQUEST`
3. 階段不是 `搶答中` → `409 VOID_NOT_ALLOWED`
4. 題目不存在 → `404 QUESTION_NOT_FOUND`
5. 該題沒有這個順位的作答 → `404 SUBMISSION_NOT_FOUND`
6. 該筆作答已作廢 → `409 ALREADY_VOIDED`

成功回 `200`：

```json
{ "data": { "questionId": 1, "groupId": 2, "rank": 1, "voidedAt": "2026-11-14T00:01:00.000Z" } }
```

成功後：

- 該筆作答的 `status` 改為 `voided` 並記錄 `voidedAt`，紀錄保留，答案、送出時間與順位不變；監看中顯示為已作廢、沒有名次。
- 已作廢的作答不計入搶答成功、`submittedCount`、判定結果、學生結果、結果 csv、xlsx 匯出與寫回。
- 被作廢的組別可再次送出該題；重送是新的一筆，`rank` 為該題目前最大順位加 1，其他組的順位不變，作廢的號碼不重用。
- 2 秒內通知已登入老師的連線（`monitor`）與被作廢組別的學生連線（`void`）。其他組、公開連線與 `GET /api/session` 不會收到任何與作廢有關的資訊。

被拒絕時不改變任何作答紀錄，也不發出事件。

### 作答作廢錯誤狀態

| HTTP | Code | 用途 |
| --- | --- | --- |
| 400 | `INVALID_VOID_REQUEST` | `questionId` 或 `rank` 不是正整數 |
| 409 | `VOID_NOT_ALLOWED` | 非搶答中階段作廢 |
| 404 | `QUESTION_NOT_FOUND` | 題目不存在 |
| 404 | `SUBMISSION_NOT_FOUND` | 該題沒有指定順位的作答 |
| 409 | `ALREADY_VOIDED` | 該筆作答已作廢 |

### PowerShell 範例

```powershell
Invoke-RestMethod http://localhost:3000/api/teacher/monitor -WebSession $teacher | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/submissions/void -ContentType 'application/json' -Body '{"questionId":1,"rank":1}' -WebSession $teacher
Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=stu-aaaa1111"
```

## 結果 csv 匯出

### `GET /api/teacher/results/csv`

活動「已結束」後下載整場的作答紀錄 csv（D13）。需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`；階段不是「已結束」回 `409 EXPORT_NOT_ALLOWED`（「活動結束後才能匯出。」）。與學習單是上傳或以連結匯入無關，也不需要設定 Google 服務帳號。下載不改變作答、順位、題目或階段。

成功：`200`，`Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="results.csv"; filename*=UTF-8''<原檔名去掉 .xlsx>（搶答結果）.csv`。前端以 `fetch` 取得，失敗時讀 JSON envelope 的錯誤訊息。

內容（格式約定見 [作答紀錄與判定結果](submission-record.md) 第 3 節）：

- 第一列為表頭 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位`。
- 每筆**有效**作答 × 每個空格一列，依題號、順位、空格序排序。已作廢的作答與沒有任何有效作答的題目不產生資料列；整場沒有作答時只有表頭。

| 欄位 | 內容 |
| --- | --- |
| 題號 | 學習單上的題號 |
| 空格序 | 該空格在題內的序號，從 1 起 |
| 組別 | 組別名稱（不輸出 id）；找不到的組別為 `組 <id>` |
| 答案 | 該空格的答案 |
| 順位 | 判定結果的名次（`place`），與 `GET /api/teacher/monitor` 的 `place` 相同 |
| 是否搶答成功 | 該題勝者那一筆為 `是`，其餘 `否` |
| 送出時間 | server 收到的時間，以 server 電腦時區的本地時間 `YYYY-MM-DD HH:mm:ss` 輸出，不帶 `Z` 或時區後綴 |
| 公平順位 | 未啟用公平順位時為 `否`；啟用時為 `是`，勝者因公平順位改判時為 `是（改判）` |

檔案格式：

- UTF-8 含 BOM，每列（含最後一列）以 CRLF 結尾。
- 欄位值以 `=`、`+`、`-`、`@` 開頭時前面加單引號 `'`，避免被試算表當成公式（例如 `=1+1` 輸出 `'=1+1`）。
- 欄位含逗號、雙引號、CR 或 LF 時依 RFC 4180 以雙引號包住，內部雙引號改為兩個；其他欄位不加引號。

範例（第 1 題 2 個空格，第 2 組先送出）：

```text
題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位
1,1,第 2 組,丙,1,是,2026-11-24 09:02:03,否
1,2,第 2 組,'=1+1,1,是,2026-11-24 09:02:03,否
1,1,第 1 組,甲,2,否,2026-11-24 09:02:05,否
1,2,第 1 組,"乙,丁",2,否,2026-11-24 09:02:05,否
```

與 SpecKit 組 004 的差異：端點路徑不同；欄位、編碼與公式防護一致。

```powershell
Invoke-WebRequest http://localhost:3000/api/teacher/results/csv -WebSession $teacher -OutFile results.csv
```

## 待補的作答紀錄格式

server 內部的作答紀錄與每題判定結果（含作廢與公平順位）的格式約定見 [作答紀錄與判定結果](submission-record.md)。結果、監看、作廢與匯出的 API 依該格式設計，實作時在此新增各端點；學生端送出已於「搶答送出」章節定義，搶答中順位只存在 server 內，不經學生端 API 公開；學生端結果（結束後的名次）已於「學生結果」章節定義。

## 學生結果

`GET /api/student/results?studentId=...` 僅供有效進場的學生讀取，且只在活動「已結束」後提供結果。依序檢查：

1. `studentId` 格式；不符回 `400 INVALID_STUDENT_ID`。
2. 有效進場；無效回 `403 STUDENT_NOT_ENTERED`。
3. 階段為「已結束」；否則回 `409 RESULTS_NOT_AVAILABLE`，且不計算、不回傳結果。

成功回 `200`，內容只包含每題的題號、公開題目格式的空格、勝者資訊及本組資訊：

```json
{
  "data": {
    "fairRankingEnabled": false,
    "questions": [
      {
        "questionId": 1,
        "blanks": [{ "index": 0, "prefix": "", "prompt": "第 1 題" }],
        "winner": { "groupName": "第 2 組", "answers": ["H2O"], "byFairRanking": false },
        "own": { "place": 2, "isWinner": false, "answers": ["水"] }
      }
    ]
  }
}
```

`fairRankingEnabled` 為本場是否啟用公平順位。`winner` 為該題勝者的組別名稱與答案（未啟用公平順位時為最先有效提交者），`winner.byFairRanking` 表示勝者是否因公平順位改判；無有效作答時 `winner` 為 `null`。`own` 為學生所屬組別的名次、是否成功與答案；本組沒有有效作答時為 `null`。本組是勝者時，`own.isWinner` 為 `true`。結果不含任何組別識別碼、任何 `rank` 欄位、他組（勝者除外）的名次或答案，也不含 `placings`、`settled`、`winnerSource`、題目層 `prompt` 或儲存格位置。`own.place` 是活動結束後才公開的顯示名次（先到先得時依接收順序，啟用公平順位時依公平順位判定後的名次），內部的 `rank` 欄位不公開。準備中與搶答中不得讀取結果。

### 學生結果錯誤狀態

以下錯誤沿用通用錯誤 envelope；既有通用「錯誤狀態」表不變。

| HTTP | Code | 用途 |
| --- | --- | --- |
| 409 | `RESULTS_NOT_AVAILABLE` | 活動尚未結束時讀取學生結果 |

### PowerShell 範例

以下依序登入老師、開始活動、讓學生進場並提交答案、結束活動，最後讀取學生結果：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<老師密碼>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","groupId":1}'
Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":1,"answers":["H2O"]}'
Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher
Invoke-RestMethod "http://localhost:3000/api/student/results?studentId=stu-aaaa1111" | ConvertTo-Json -Depth 6
```

