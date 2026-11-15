# API 契約

本文件定義第一階段 server API。所有時間均由 server 產生，使用 ISO 8601 UTC 字串。

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

以下控制端點在本 change 僅接受 loopback 來源（IPv4 `127.0.0.1`、IPv6 `::1`，含 IPv4-mapped loopback）。不得以 `X-Forwarded-For` 等用戶端可提供的轉發標頭判定來源。非 loopback 回 `403`。後續教師端 change 以密碼驗證取代此限制，教師端須以 localhost 開啟；以本機區網 IP 開啟時來源不是 loopback，會被拒絕。

### `POST /api/session/start`

要求 body 為空，僅允許 `準備中` 轉為 `搶答中`。成功回 `200`，並回傳更新後的 `phase` 與 `serverTime`。不允許的階段轉移回 `409`。

### `POST /api/session/end`

要求 body 為空，僅允許 `搶答中` 轉為 `已結束`。成功回 `200`，並回傳更新後的 `phase` 與 `serverTime`。不允許的階段轉移回 `409`。

本契約不定義活動重設；未來加入重設時須以 MODIFIED 更新階段生命週期要求。

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
