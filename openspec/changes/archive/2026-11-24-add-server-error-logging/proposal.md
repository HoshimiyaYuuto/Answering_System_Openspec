# Proposal: add-server-error-logging

## Why

server 遇到未預期錯誤時，全域錯誤處理器只回 `500 INTERNAL_ERROR` 給用戶端，終端機沒有任何紀錄，開發與課堂操作時只能用猜的找錯。學生端成員在 `add-buzz-in-submission` 的 PR #8 已遇到這個問題；接下來的老師監看與 Google 寫回牽涉更多模組，更需要看得到錯誤。

## What Changes

- 未預期錯誤回 500 之前，server 在終端機記錄一筆錯誤：時間、HTTP 方法、路徑（不含 query string）與錯誤的 stack trace。
- 紀錄 SHALL NOT 包含 request body、query string、cookie 或其他標頭，避免老師密碼、登入 token、學生答案出現在 log。
- 回給用戶端的 500 回應維持不變，仍不含堆疊或內部訊息。
- 400 `INVALID_JSON`、413 `BODY_TOO_LARGE` 等可預期的錯誤不記錄。
- `createApplication()` 新增可注入的 `logger` 選項，預設為 `console`，讓測試能檢查紀錄內容且不弄亂測試輸出。
- 在 `docs/api-contract.md` 的錯誤說明補一句：500 會在 server 終端機留下紀錄，不會出現在回應中。

對應 `docs/explore_summary.md`：第 7 節（所有 API 錯誤含統一 code 與訊息、內部錯誤也要回應）、第 0 節（不得在 log 寫入密碼與機敏資料）。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `api-contract-and-session-lifecycle`：新增一條 Requirement「未預期錯誤會記錄給 server 操作者」。既有的「API responses use a consistent JSON envelope」不變。

## Impact

- **負責人**：教師端成員（學生端成員於 PR #8 建議由教師端開）。
- **程式**：修改 `server/index.js` 的全域錯誤處理器與 `createApplication()` 選項；在 `server/events.test.js` 補測試。
- **文件**：`docs/api-contract.md`。
- **相依**：無新套件。不依賴其他未合併的 change。
- **之後的 change**：`add-guided-notes-export` 的 Google 錯誤已在該 change 內轉成我們自己的錯誤代碼並清除 Google 原文，不會以未預期錯誤的形式進到這裡；若之後有模組丟出含機敏資料的錯誤，該模組需自行處理，不能依賴本 change 過濾。
