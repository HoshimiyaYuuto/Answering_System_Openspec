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
