# Tasks

## 1. 純函式

- [x] 1.1 在 `public/student/logic.js` 依 design 第 1、4 節新增：
  - `ENTRY_REASON_MESSAGES.activity_reset` 與 export 的 `RESET_MESSAGE`（「活動已重設，請重新選擇組別」）；
  - `formatRemaining(countdownEndsAt, serverNowMs)`。

  驗證：在 `public/student/logic.test.js` 新增測試，涵蓋：
  - `getEntryNextStep` 與 `getStoredEntryNextStep` 對 `activity_reset` 回傳重設說明，而且 `shouldExplain` 為 `true`；
  - `group_removed`、`entry_reset` 的說明不變；
  - `formatRemaining` 依傳入的 server 時間計算：
    - 無條件進位到秒、不小於 0，格式為 `m:ss`，60 分鐘顯示 `60:00`；
    - 輸入無效時回傳空字串；
    - 傳入「比 server 慢 2 分鐘的裝置時間加上時鐘差」時，結果與直接用 server 時間相同。

  既有測試全部通過。

  手動：`node --test public/student/logic.test.js`

## 2. 學生頁接線

- [x] 2.1 在 `public/student/app.js` 與 `public/student/index.html` 依 design 第 2 節完成倒數顯示：
  - `#countdown` 顯示區與樣式；
  - `clockOffset`、`countdownEndsAt`、`recordServerTime`；
  - 三處 `/api/session` 回應、`handlePhase`、`handleHeartbeat` 都呼叫 `recordServerTime`；
  - `renderCountdown` 與 1 秒 interval，在 `showPhaseScreen` 時更新。

  驗證：`npm test` 全部通過。

  手動：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 三個學生分別從不同來源進場：
     - 第 1 組：`http://localhost:3000/student/`
     - 第 2 組：`http://127.0.0.1:3000/student/`
     - 第 3 組：區網 IP `http://<本機區網 IP>:3000/student/`
  3. 老師在 `http://localhost:3000/teacher/` 登入，勾選「設定倒數」0 分 30 秒並開始：
     - 確認三個學生的作答區都顯示「剩餘時間」，並每秒遞減；
     - 確認與老師控制台相差不超過 1 秒。
  4. 第 1 組在倒數進行中重新整理頁面：確認剩餘時間接續顯示，不是從 0:30 重新開始。
  5. 第 2 組打開一題作答頁：確認作答頁上方仍顯示剩餘時間。
  6. 等倒數歸零：確認三個學生頁在 2 秒內顯示活動已結束，剩餘時間消失。
  7. 老師重設後不設倒數再開始一場：確認學生頁不顯示剩餘時間。

- [x] 2.2 在 `public/student/app.js` 依 design 第 3 節完成重設處理：
  - 新增 `handleReset`，掛上 SSE `reset` 事件；
  - 清除倒數狀態，以 `RESET_MESSAGE` 回選組頁，不儲存上一場的草稿。

  驗證：`npm test` 全部通過。

  手動（啟動方式與三個學生來源同 2.1）：
  1. 老師開始搶答。第 1 組送出第 1 題；第 2 組在第 2 題輸入一半不送出（留下草稿）；第 3 組停在題號格。
  2. 老師結束後重設：
     - 確認三個學生頁都在 2 秒內回到選組頁，並顯示「活動已重設，請重新選擇組別」；
     - 確認第 3 組在重設前已經停在結果頁也一樣。
  3. 第 1 組重設前先關閉分頁，重設後再開啟：確認顯示同一句說明。
  4. 三組重新選組，老師再開始一場：
     - 確認第 1 題、第 2 題都是「未作答」；
     - 確認第 2 組的第 2 題輸入框是空的。
  5. 老師把組數改成 2 組（第 3 組被移除）：確認第 3 組顯示「你原本的組別已被老師移除」，不是重設說明。
