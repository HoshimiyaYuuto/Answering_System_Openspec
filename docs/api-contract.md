# API 契約

本文件定義 server API，是學生端、教師端與 server 共用的唯一契約。所有 API 時間均由 server 產生，使用 ISO 8601 UTC 字串（匯出 csv 的送出時間另依共同契約 D13 以本地時間呈現，見 `csv-export` change）。

## 契約狀態與已知限制

- 本文件只記錄已實作的端點；尚未實作的功能（送出、結果、作廢、老師密碼、匯出等）在各自的 change 中新增。
- 活動狀態存在 server 記憶體；server 重啟後組別、進場紀錄與已匯入的題目全部清空。
- 老師身分驗證（共同契約 D18）尚未實作，目前以 loopback 限制暫代；改為密碼後，下列各節所有「loopback 限制」將以同一個老師驗證機制取代。遠端講課在此之前無法使用。

## 通用格式

- API 前綴：`/api`
- JSON request body 上限：16 KiB。無效 JSON 回 `400`，超過上限回 `413`。
- 成功回應使用 `application/json`：`{"data": {...}}`。
- 錯誤回應使用 `application/json`：`{"error":{"code":"...","message":"..."}}`。錯誤訊息不得包含堆疊、秘密或內部設定。
- 未知路徑回 `404`，內部錯誤回 `500`；錯誤回應一律遵守上述 envelope。

## 活動摘要

### `GET /api/session`

回傳目前 server 權威狀態：

```json
{
  "data": {
    "phase": "準備中",
    "questionCount": 0,
    "groupCount": 0,
    "serverTime": "2026-11-14T00:00:00.000Z"
  }
}
```

`phase` 值為 `準備中`、`搶答中`、`已結束`。
`groupCount` 為目前實際組別數。

## 階段控制

以下控制端點目前僅接受 loopback 來源（IPv4 `127.0.0.1`、IPv6 `::1`，含 IPv4-mapped loopback）。不得以 `X-Forwarded-For` 等用戶端可提供的轉發標頭判定來源。非 loopback 回 `403`。後續以老師密碼驗證取代此限制（見「契約狀態與已知限制」）；在此之前教師端須以 localhost 開啟，以本機區網 IP 開啟時來源不是 loopback，會被拒絕。

### `POST /api/session/start`

要求 body 為空，僅允許 `準備中` 轉為 `搶答中`。成功回 `200`，並回傳更新後的 `phase` 與 `serverTime`。不允許的階段轉移回 `409`。

### `POST /api/session/end`

要求 body 為空，僅允許 `搶答中` 轉為 `已結束`。成功回 `200`，並回傳更新後的 `phase` 與 `serverTime`。不允許的階段轉移回 `409`。

本契約目前不定義活動重設（共同契約 D19，已結束後可重設回準備中、組別保留、作答清空）；加入時須以 MODIFIED 更新階段生命週期要求。

## 階段事件

### `GET /api/events`

以 Server-Sent Events 傳送階段變更。事件格式：

```text
event: phase
data: {"phase":"搶答中","serverTime":"2026-11-14T00:00:00.000Z"}

```

每次階段變化後兩秒內通知所有已連線 client。

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
| 403 | `LOOPBACK_ONLY` | 控制端點呼叫來源不是 loopback |
| 404 | `NOT_FOUND` | API 路徑不存在 |
| 409 | `INVALID_PHASE_TRANSITION` | 階段轉移不合法 |
| 413 | `BODY_TOO_LARGE` | JSON body 超過 16 KiB |
| 500 | `INTERNAL_ERROR` | 未預期 server 錯誤 |

## 組別與學生進場

本節新增端點均使用通用 JSON envelope。組別設定寫入端點 `PUT /api/groups` 與 `POST /api/groups/generate` 僅允許在階段為 `準備中` 且請求來源為 loopback 時執行；來源依實際 socket 位址判定，不採信 forwarded headers。非 loopback 回 `403 LOOPBACK_ONLY`，階段不符回 `409 GROUP_CONFIG_NOT_ALLOWED`。檢查順序依序為 loopback、階段、請求內容驗證。教師端須以 `http://localhost` 開啟；使用本機區網 IP 開啟會被拒絕。`GET /api/groups` 與學生進場端點不受此 loopback 寫入限制。

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

以完整清單取代現有組別。僅限 `準備中` 且 loopback。`groups` 必須包含 1 至 100 組；每個 `id` 是 1 至 100 的不重複正整數；每個 `name` 去除前後空白後長度為 1 至 30 字元，且名稱不重複。保留仍存在之組別 id 的學生進場關聯。

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

依組數產生並套用預設名稱「第 N 組」。僅限 `準備中` 且 loopback；`count` 必須為 1 至 100 的整數，產生的組別 id 為 1 至 `count`。

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

`reason` 為 `group_removed`（所屬組別已被移除）或 `entry_reset`（沒有該 `studentId` 的進場紀錄，包含 server 重啟後記憶體清空的情況）。從未進場過的 `studentId` 也回 `200` 加 `valid:false` 與 `reason: entry_reset`。

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

寫入端點（兩個預覽與確認）的檢查順序為 loopback、階段、請求內容：非 loopback 回 `403 LOOPBACK_ONLY`，非 `準備中` 回 `409 IMPORT_NOT_ALLOWED`。老師密碼功能完成前，教師端須以 `http://localhost` 開啟，且其 loopback 與階段檢查須與其他老師端寫入端點共用同一個 guard，以便之後一次換成密碼驗證。

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
    "replacesExisting": false
  }
}
```

- `id` 為學習單上的題號，不重新編號（可能不連續）。送出、結果與匯出一律以此 `id` 作為題號。
- `type` 為 `single`（單題）或 `group`（題組）。
- `warnings` 為提醒文字陣列，例如作答格已有非前綴內容。
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
      "importedAt": "2026-11-17T09:00:00.000Z"
    }
  }
}
```

`previewId` 不是最新的預覽時回 `409 IMPORT_PREVIEW_EXPIRED`，題目不變。

### `GET /api/teacher/guided-notes`

取得目前已套用的匯入摘要，僅接受 loopback。尚未匯入時：

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

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/preview/file -ContentType 'application/octet-stream' -Headers @{ 'X-File-Name' = '01-official-single.xlsx' } -InFile fixtures/guided-notes/01-official-single.xlsx
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/confirm -ContentType 'application/json' -Body '{"previewId":"<上一步回傳的 previewId>"}'
Invoke-RestMethod http://localhost:3000/api/teacher/guided-notes
```

## 待補的公開題目格式

`session.questions` 已由匯入寫入，但目前沒有端點讓學生端讀取題目。`add-buzz-in-submission` 須新增學生端讀取題目的端點並在此定義回應格式；格式不得包含儲存格位置、原始檔內容或試算表 ID。匯入模組目前提出的公開形狀為 `{ id, prompt, blanks: [{ index, prefix, prompt }] }`，由該 change 確認後才成為契約。
