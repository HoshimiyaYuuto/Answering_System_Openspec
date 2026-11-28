# Tasks

## 1. 進場紀錄的重設

- [x] 1.1 在 `server/groups-entry.js` 依 design 第 4 節新增：
  - `resetIds` 與 `resetEntries()`：把所有進場的 `studentId` 記進 `resetIds`，再清空進場紀錄；
  - `lookup`：沒有進場紀錄、但在 `resetIds` 裡時，回傳 `activity_reset`；
  - `enter` 成功時，從 `resetIds` 移除該 id。

  驗證：在 `server/groups-entry.test.js` 新增測試，涵蓋：
  - 重設後，原進場學生查詢得到 `activity_reset`；
  - 從未進場的學生仍然得到 `entry_reset`；
  - 重設後重新進場，查詢得到有效進場；再查一次，不會回報 `activity_reset`；
  - 重設時組別清單不變；
  - 所屬組別已刪除的進場，重設後也回報 `activity_reset`。

  既有測試全部通過。

  手動：`node --test server/groups-entry.test.js`

## 2. server：倒數與重設

- [x] 2.1 在 `server/index.js` 依 design 第 1 節完成倒數：
  - `start` 讀取並檢查 `countdownSeconds`（放在既有三項檢查之後）；
  - 記錄 `countdownEndsAt` 並排計時器；
  - 新增 `endSession()`，`/api/session/end` 與計時器共用；
  - `sessionSummary()` 與 `publishPhase()` 加上 `countdownEndsAt`；
  - 開發用的 phase 路由在離開搶答中時清除倒數。

  驗證：新增 `server/countdown-api.test.js`。用注入 `createApplication` 的時鐘（`now`）與計時器（`scheduleTimeout`、`cancelTimeout`）控制時間；不用 `mock.timers`，以免影響測試裡的 HTTP 用戶端。涵蓋：
  - 不帶倒數時 `countdownEndsAt` 為 `null`；
  - 帶 60 秒時，摘要與 `phase` 事件的 `countdownEndsAt` 都是開始時間加 60 秒；
  - `5`、`3601`、`30.5`、`"60"` 都回 `400 COUNTDOWN_OUT_OF_RANGE`，階段維持準備中、沒有發布 `phase`；
  - 沒有組別或題目時，仍回 `NO_GROUPS`／`QUESTIONS_REQUIRED`（優先於倒數檢查）；
  - 時間到自動進入已結束、只發布一次 `phase`，之後送出回 `409 SUBMISSION_NOT_ALLOWED`；
  - 手動結束後 `countdownEndsAt` 為 `null`，時間到也不再發布 `phase`；
  - 倒數結束後手動結束，回 `409 INVALID_PHASE_TRANSITION`，階段不變。

  手動：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 以 PowerShell 登入老師後，呼叫 `POST /api/session/start`，body 為 `{"countdownSeconds":10}`。
  3. 立即 `GET /api/session`，確認有 `countdownEndsAt`。約 10 秒後再查一次，確認階段為「已結束」、`countdownEndsAt` 為 `null`。

- [x] 2.2 更新既有測試中比對 `phase` 事件完整內容的地方：
  - `server/events.test.js` 第 82 行；
  - `server/capacity-check.js` 第 70 行。

  兩處的正規表示式都改為接受 `countdownEndsAt` 欄位。

  驗證：`npm test` 全部通過。

  手動：`node server/capacity-check.js`，確認 100 個連線都在 2 秒內收到 `phase` 事件。

- [x] 2.3 在 `server/index.js` 依 design 第 3、5 節新增 `POST /api/session/reset`（`requireTeacher`）：
  - 只在已結束可用；
  - 清空作答、進場紀錄、`activityId` 與倒數；
  - 學生連線送 `reset` 事件後關閉；其他連線發布 `phase`。

  驗證：新增 `server/session-reset-api.test.js`，涵蓋：
  - 401；
  - 準備中與搶答中回 `409 INVALID_PHASE_TRANSITION`，資料不變；
  - 已結束時重設成功：階段為準備中，組數與題數不變，`activityId` 為 `null`，老師監看沒有作答，老師 cookie 仍然有效；
  - 包含已作廢作答的活動，重設後也全部清空；
  - 原學生查詢進場得到 `activity_reset`，送出與讀取題目回 `403 STUDENT_NOT_ENTERED`；
  - 學生 SSE 在 2 秒內收到 `reset` 事件（內容只有 `serverTime`），接著連線結束；
  - 老師與匿名 SSE 收到 `phase`（準備中），連線仍然開啟；
  - 重設後再開始：有新的 `activityId`，第一筆送出的 `rank` 為 1；
  - 連續重設兩次，第二次回 `409 INVALID_PHASE_TRANSITION`。

  手動（啟動方式同 2.1）：
  1. 以 PowerShell 登入老師，依序呼叫 start、end、reset。
  2. 確認 `GET /api/session` 的階段為準備中、組數與題數不變，`GET /api/teacher/auth` 仍為已登入。

- [x] 2.4 更新文件，依 design 第 7 節：
  - `docs/api-contract.md`：start 的 body 與錯誤、`countdownEndsAt`、reset 端點、`reset` 事件、`activity_reset`；並把第 118 行改為指向新段落。
  - `docs/explore_summary.md`：
    - 模組表 `countdown` 的狀態改為實作中；
    - D19 註明已與 SpecKit 談定（v0.10）：重設時已連線學生也回選組頁、組別保留、老師不用重新登入。

  驗證：`openspec validate --all --strict` 通過；人工比對契約與 2.1～2.3 的測試，欄位名稱、狀態碼、錯誤碼一致。

  手動：無（文件 task）。

## 3. 教師控制台

- [x] 3.1 在 `public/teacher/console-logic.js` 依 design 第 2、6 節新增：
  - 重設的狀態與事件（`requestReset`、`cancelReset`、`confirmReset`、`resetDone`、`resetFailed`）；
  - `getConsoleControls` 的 `canReset`、`showResetConfirm`、`canConfirmReset`、`canEditCountdown`；
  - `describeAction` 的「重設活動中…」；
  - 純函式 `parseCountdown` 與 `formatRemaining`。

  驗證：在 `public/teacher/console-logic.test.js` 新增測試，涵蓋：
  - 只有已結束時可以重設；確認與取消的狀態切換；
  - 重複重設得到 `INVALID_PHASE_TRANSITION` 且階段為準備中時，不顯示錯誤；
  - 階段離開已結束時，關閉重設確認；
  - `parseCountdown`：未勾選得到 `null`；1 分 30 秒得到 90；0 分 5 秒、61 分、負數、小數都得到範圍錯誤訊息；
  - `formatRemaining`：依傳入的 server 時間計算，無條件進位到秒、不小於 0，格式為 `m:ss`。

  既有測試全部通過。

  手動：`node --test public/teacher/console-logic.test.js`

- [x] 3.2 在 `public/teacher/app.js` 與 `public/teacher/index.html` 依 design 第 6 節完成：
  - 倒數勾選與分、秒輸入；
  - 開始時帶 `countdownSeconds`；
  - 依 `clockOffset` 每秒顯示剩餘時間；
  - 「重設活動」按鈕與確認區。

  驗證：`npm test` 全部通過。

  手動（啟動方式同 2.1）：
  1. 老師在 `http://localhost:3000/teacher/` 登入。
  2. 三個學生分別從不同來源進場：
     - 第 1 組：`http://localhost:3000/student/`
     - 第 2 組：`http://127.0.0.1:3000/student/`
     - 第 3 組：區網 IP `http://<本機區網 IP>:3000/student/`
  3. 老師勾選「設定倒數」、輸入 0 分 5 秒並按開始：確認顯示範圍錯誤，階段維持準備中。
  4. 改成 0 分 20 秒並開始：
     - 確認控制台顯示「剩餘 0:20」並每秒遞減；
     - 開第二個老師分頁，確認兩個分頁的剩餘時間相差不超過 1 秒。
  5. 第 1 組、第 2 組各送出一題。不操作，等倒數歸零：
     - 確認控制台在 2 秒內顯示「已結束」，剩餘時間消失；
     - 三個學生畫面都顯示活動已結束。
  6. 老師按「重設活動」後按取消：確認仍是「已結束」，結果仍在。
  7. 再按「重設活動」並確認：
     - 控制台顯示「準備中」，組數與題數不變，監看是空的，組別設定與匯入可以操作，老師沒有被登出；
     - 三個學生頁都回到選組頁（學生端 change 完成前，訊息為通用的失效說明）。
  8. 學生重新選組後，老師不設倒數再開始一次：確認控制台沒有剩餘時間，學生看到的題號格都是「未作答」。
