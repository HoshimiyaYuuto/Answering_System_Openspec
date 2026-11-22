# Tasks: add-server-error-logging

本 change 範圍小、沒有架構取捨，不另寫 design。做法：`createApplication()` 新增 `logger` 選項（預設 `console`），全域錯誤處理器在回 500 前呼叫 `logger.error()`，內容為 ISO 時間、`request.method`、`request.path`（不含 query string）與 `error.stack`（沒有 stack 時用 `String(error)`）。測試注入假的 `logger` 收集呼叫內容。

## 1. 記錄未預期錯誤

- [x] 1.1 修改 `server/index.js`：新增 `logger` 選項並在全域錯誤處理器回 500 前記錄；`exposeTestErrorRoute` 的測試路由改為接受任何方法（`app.all`），讓測試能送 body；在 `server/events.test.js` 補測試；驗證：`npm test` 涵蓋三件事：
  - `GET /api/__test__/error` 時假 logger 收到一筆含 `GET`、`/api/__test__/error` 與 `test-only-secret-marker` 堆疊的紀錄，回應仍與既有測試相同（`500 INTERNAL_ERROR`、不含堆疊）。
  - `POST /api/__test__/error?studentId=stu-secret-query` 帶 cookie `teacher_session=cookie-secret` 與 body `{"password":"body-secret"}` 時，紀錄不含 `stu-secret-query`、`cookie-secret`、`body-secret`。
  - 格式錯誤的 JSON（400）、過大的 body（413）、不存在的路徑（404）與 `401 TEACHER_AUTH_REQUIRED` 都沒有呼叫 logger。
- [x] 1.2 更新 `docs/api-contract.md` 的錯誤說明：500 會在 server 終端機留下紀錄（時間、方法、路徑、堆疊），不出現在回應中，紀錄不含 body、query string 與 cookie；驗證：對照 1.1 的實作，文件描述的紀錄欄位與實際輸出一致；手動：`npm start` 後以 PowerShell 送出格式錯誤的 JSON，終端機沒有新紀錄。

## 2. 整合檢查

- [x] 2.1 驗證：`npm test` 全部通過且測試輸出中沒有 500 紀錄（測試都注入假 logger），`npm run check:capacity` 通過，`openspec validate add-server-error-logging --strict` 通過

## Workflow follow-up

- 開 PR 請學生端成員 review，合併後執行 archive。
