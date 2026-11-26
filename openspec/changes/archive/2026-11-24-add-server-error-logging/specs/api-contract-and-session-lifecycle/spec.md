# Spec Delta

## ADDED Requirements

### Requirement: Unexpected errors are logged for the server operator
server 以 500 回應未預期錯誤時，SHALL 在 server 的錯誤輸出記錄一筆紀錄，包含發生時間、HTTP 方法、不含 query string 的路徑，以及錯誤訊息與堆疊。紀錄 SHALL NOT 包含 request body、query string、cookie 或其他標頭。可預期的用戶端錯誤（例如 JSON 格式錯誤、body 過大、各功能的 4xx 錯誤）SHALL NOT 記錄。回給用戶端的內容 SHALL 與未記錄時相同。

#### Scenario: Unexpected error is logged
- **WHEN** 處理 `GET /api/__test__/error` 時丟出錯誤
- **THEN** server 錯誤輸出出現一筆含 `GET`、`/api/__test__/error` 與錯誤堆疊的紀錄，回應仍為 `500 INTERNAL_ERROR` 且不含堆疊

#### Scenario: Log excludes request details
- **WHEN** 帶有 query string、cookie 與 JSON body 的請求觸發未預期錯誤
- **THEN** 紀錄中不出現 query string、cookie 值或 body 內容

#### Scenario: Client errors are not logged
- **WHEN** 用戶端送出格式錯誤的 JSON 或呼叫不存在的 API 路徑
- **THEN** server 回對應的 4xx 錯誤，錯誤輸出沒有新的紀錄
