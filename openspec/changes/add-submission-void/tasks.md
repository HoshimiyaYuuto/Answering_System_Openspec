# Tasks

## 1. 作答紀錄的作廢操作

- [x] 1.1 在 `server/submissions.js` 新增作廢與重送所需的功能：
  - 新建的作答都帶 `voidedAt: null`。
  - 新增同步的 `voidSubmission({ questionId, rank })`，依 design 第 3 節回傳 `ok` 或 `SUBMISSION_NOT_FOUND`／`ALREADY_VOIDED`。作廢時把紀錄改為 `voided`、寫入 `voidedAt`，並從查重表移除，讓同組可以重送；`rank` 計數器不變。
  - 新增 `subscribeVoid(listener)`。
  - 新增 `listVoidedPendingByGroup(groupId)`。
  - `clear()` 一併清空上述狀態。

  驗證：在 `server/submissions.test.js` 新增測試，涵蓋：
  - 作廢後狀態與 `voidedAt` 正確；
  - 重送的 `rank` 為目前最大值加 1，其他組不變；
  - 作廢後他組再送仍回 `ALREADY_SUBMITTED`；
  - 重複作廢回 `ALREADY_VOIDED`，不存在的順位回 `SUBMISSION_NOT_FOUND`；
  - 作廢監聽者被呼叫一次，監聽者丟錯不影響作廢結果；
  - `listVoidedPendingByGroup` 在重送後不再列出該題；
  - 既有測試全部通過。

  手動：`node --test server/submissions.test.js`

## 2. 作廢端點與通知

- [x] 2.1 在 `server/index.js` 新增 `POST /api/teacher/submissions/void`（`requireTeacher`），依 design 第 2 節的順序檢查並回傳；透過 `subscribeVoid` 送出兩種通知：
  - 給被作廢組別的學生連線：`void` 事件 `{ questionId, voidedAt }`；
  - 給已登入老師的連線：`monitor` 通知。

  驗證：新增 `server/submission-void-api.test.js`，涵蓋：
  - 401；
  - 400 `INVALID_VOID_REQUEST`；
  - 準備中與已結束的 409 `VOID_NOT_ALLOWED`；
  - 404 `QUESTION_NOT_FOUND`／`SUBMISSION_NOT_FOUND`；
  - 409 `ALREADY_VOIDED`；
  - 成功回應的欄位正確；
  - 被拒絕時作答紀錄不變；
  - 作廢後監看顯示已作廢、勝者改為下一筆、`submittedCount` 減 1；
  - 作廢後該組重送成功；
  - CSV 不含被作廢的作答；
  - SSE：被作廢組連線 2 秒內收到 `void` 事件且不含 `rank`，老師連線收到 `monitor`，他組連線與公開連線沒有收到任何事件。

  手動：`node --test server/submission-void-api.test.js`

- [x] 2.2 在 `server/index.js` 讓 `GET /api/student/submissions` 回應新增 `voided`（來自 `listVoidedPendingByGroup`），`submissions` 欄位維持不變。

  驗證：在 `server/submission-void-api.test.js` 新增測試，涵蓋：
  - 未作廢時 `voided` 為空陣列；
  - 作廢後列出該題，且 `submissions` 不含該題；
  - 重送後 `voided` 不含該題；
  - 回應不含 `rank` 與他組資料。

  執行 `npm test`，確認既有測試全部通過，包含 `buzz-in-api.test.js` 中對回應形狀的檢查；必要時只放寬為允許新增的 `voided` 欄位。

  手動：`$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 後，以 PowerShell 登入老師、送出一筆作答、呼叫作廢，再查詢 `GET /api/student/submissions?studentId=...`，確認出現 `voided`。

## 3. 老師控制台的作廢操作

- [x] 3.1 在 `public/teacher/monitor-logic.js` 的詳細列加上 `voidAction`：
  - 只有在搶答中且作答有效時才加，內容為 `{ questionId, rank, groupName }`；
  - 準備中、已結束與已作廢的列都沒有。

  驗證：在 `public/teacher/monitor-logic.test.js` 新增測試，涵蓋搶答中有效、搶答中已作廢、已結束三種情況。

  手動：`node --test public/teacher/monitor-logic.test.js`

- [x] 3.2 在 `public/teacher/app.js` 依 `voidAction` 渲染「作廢」按鈕，並以事件委派處理：
  - 先 `confirm`，取消則不送出；
  - 確認後送出 POST，請求期間停用按鈕；
  - 失敗時在監看提示區顯示錯誤，401 走 `handleAuthError`；
  - 成功後等 `monitor` 通知重新讀取。

  需要時在 `public/teacher/index.html` 補按鈕樣式。

  驗證：`npm test` 全部通過。

  手動（`$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start`）：
  1. 老師在 `http://localhost:3000/teacher/` 登入，產生 3 組並開始搶答。
  2. 第 1 組用 `http://localhost:3000/student/`、第 2 組用 `http://127.0.0.1:3000/student/`、第 3 組用區網 IP `http://<本機區網 IP>:3000/student/` 進場，依序送出第 1 題。
  3. 老師展開第 1 題，按第 1 組的「作廢」後先按取消，確認畫面沒有變化。
  4. 再按一次並確認，確認 2 秒內第 1 組顯示「已作廢」、第 1 名變為第 2 組、已送出組數變為 2／3。
  5. 第 1 組重新整理後重送第 1 題，確認老師畫面顯示第 1 組為第 3 名。
  6. 第 3 組畫面在整個過程中沒有任何變化。
  7. 結束搶答後，確認畫面上沒有任何「作廢」按鈕。

## 4. 文件

- [x] 4.1 更新 `docs/api-contract.md`：
  - 新增「作答作廢」章節，包含端點、檢查順序、錯誤表與 PowerShell 範例；
  - 補上 `GET /api/student/submissions` 的 `voided`、`GET /api/events` 的 `void` 事件、`ALREADY_SUBMITTED` 的新說明；
  - 補充作廢也會觸發老師的 `monitor` 通知。

  驗證：逐一對照第 2 節的測試，確認端點、欄位與錯誤代碼都與文件一致。執行 `openspec validate add-submission-void --strict`。

- [x] 4.2 更新文件中的負責人與進度：
  - `docs/explore_summary.md` 模組表的 `void-submission` 列：負責人改為教師端成員（server 與操作畫面），學生頁提示由 `add-student-void-notice` 處理，進度改為本 change；
  - `docs/submission-record.md` 第 1 節的「作廢由之後的 change 加入」改為指向本 change。

  驗證：用 `git diff docs/` 確認只改了這兩處。
