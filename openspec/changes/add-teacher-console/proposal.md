# Proposal: add-teacher-console

## Why

目前老師沒有正式的操作畫面：開始與結束搶答只能在 PowerShell 呼叫 API，組別設定與匯入放在 `/teacher/` 臨時頁。所有老師操作都以「請求來自 server 那台電腦（loopback）」代表「是老師」，老師不能用其他裝置操作，系統也沒有密碼保護。

需求 D18 要求老師端輸入密碼，密碼由環境變數設定；主規格 `api-contract-and-session-lifecycle` 也規定「後續教師端 change SHALL 以密碼驗證取代此限制」。SpecKit 組的老師端只用密碼、不限來源，兩組行為必須一致。另外，目前沒有組別或沒有題目也能開始搶答，與 SpecKit 組的規格（AC-001-04、002 的 `QUESTIONS_REQUIRED`）不一致。

監看與結果需要作答資料，要等學生端成員的 `add-buzz-in-submission`，因此本 change 只處理登入與活動控制，讓老師這週就能完成「登入 → 設定組別 → 匯入 → 開始 → 結束」的流程。

對應 `docs/explore_summary.md`：第 2 節（教師端：活動控制、組別設定畫面）、第 3 節 D2（階段由老師操作）、D17（準備階段設定組別）、D18（老師密碼）、第 5 節 `teacher-monitoring-results` 中的「老師登入」、第 7 節（寫入端點由 server 檢查權限）、第 8 節（密碼只放 `.env`）、第 9 節 AC-000-04、AC-000-07 的老師操作部分。

## What Changes

- 新增老師登入：老師輸入密碼後取得登入狀態，重新整理頁面不需再登入，可登出。密碼來自環境變數 `TEACHER_PASSWORD`；沒有設定時拒絕所有老師登入並說明原因。密碼錯誤時不透露任何密碼資訊。同一來源短時間內嘗試太多次時暫時拒絕。
- **BREAKING**：組別設定、開始與結束搶答、Guided Notes 匯入的寫入與查詢端點，權限檢查由「只限 loopback」改為「老師已登入」。未登入回 `401`，原本的 `403 LOOPBACK_ONLY` 不再用於這些端點。老師可從同網段的任何裝置登入操作。
- 開始搶答多兩個前提：至少一個組別、至少一題；不符合時拒絕並說明原因，階段維持「準備中」。
- `/teacher/` 改為正式教師控制台：未登入顯示登入畫面；登入後顯示目前階段、組數、題數（隨 SSE 更新），提供開始與結束搶答按鈕（結束前需再確認），並包含原本的組別設定與匯入區塊。移除「請以 localhost 開啟」的提示與限制。
- server 啟動時若專案根目錄有 `.env` 就載入，不新增套件。
- 更新 `docs/api-contract.md`、`README.md`、`.env.example` 說明與 `openspec/config.yaml` 中「教師端須以 localhost 開啟」的專案慣例。

不在範圍：

- 監看各題作答狀況、結果、作廢、改選勝者（`add-teacher-monitoring`，等 `add-buzz-in-submission` 完成後進行）。
- 重設活動（D19）：需要清空作答資料，併入監看相關的 change。
- 倒數（D15）：另開 change。
- 投影看板、QR code。
- 多位老師帳號、修改密碼、HTTPS。

## Capabilities

### New Capabilities

- `teacher-auth`：老師以環境變數設定的密碼登入、維持與結束登入狀態，以及受保護的老師端點如何驗證登入；包含未設定密碼、密碼錯誤與嘗試次數限制。
- `teacher-console`：正式教師控制台頁面，包含登入畫面、活動摘要與階段同步、開始與結束搶答操作，以及組別設定與匯入區塊的整合。

### Modified Capabilities

- `api-contract-and-session-lifecycle`：「Session lifecycle moves forward only」的階段控制端點由 loopback 改為老師登入；新增開始搶答需要至少一個組別與一題的要求。
- `groups-and-entry`：「Group configuration is limited to loopback during preparation」改為限已登入老師；「Server serves the student and teacher static areas」的教師頁由臨時頁改為控制台；移除「Temporary teacher page only configures groups」，由 `teacher-console` 取代。
- `guided-notes-import`：「Import is restricted to the teacher during preparation」由 loopback 改為老師登入。此能力由 `add-guided-notes-import` 建立，該 change 須先歸檔。

## Impact

- **負責人**：教師端成員。
- **程式**：
  - 新增 `server/teacher-auth.js`（密碼比對、登入狀態、嘗試次數限制）及其測試。
  - 修改 `server/index.js`：新增登入相關路由，把 loopback 檢查換成登入檢查，加上開始搶答的前提，啟動時載入 `.env`。
  - 新增 `public/teacher/console-logic.js` 及其測試；修改 `public/teacher/index.html`、`public/teacher/app.js`、`public/teacher/import-logic.js`。
  - 修改既有測試 `server/events.test.js`、`server/groups-entry.test.js`、`server/guided-notes-api.test.js`，改為先登入再呼叫老師端點。
- **API**：新增 `POST /api/teacher/login`、`POST /api/teacher/logout`、`GET /api/teacher/auth`；老師端點的錯誤碼由 `403 LOOPBACK_ONLY` 改為 `401 TEACHER_AUTH_REQUIRED`；`POST /api/session/start` 新增 `409 NO_GROUPS`、`409 QUESTIONS_REQUIRED`。`/api/dev/phase/:phase` 仍限 loopback，學生端點不變。
- **相依套件**：無新增。`.env` 以 Node.js 內建的 `process.loadEnvFile()` 載入。
- **依賴其他 change**：
  - `add-guided-notes-import`（教師端成員）：本 change 建立在它之上，須先合併並歸檔。
  - 學生端成員的 `add-buzz-in-submission` 等後續 change：之後新增的老師端點應使用本 change 的登入檢查，不再使用 loopback。這項改動會動到學生端成員寫的路由與測試，須事先告知。
