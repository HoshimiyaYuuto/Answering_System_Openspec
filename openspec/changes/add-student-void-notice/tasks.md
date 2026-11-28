# Tasks

## 1. 作廢狀態的純函式

- [x] 1.1 在 `public/student/logic.js` 依 design 第 1、2 節完成以下修改，所有函式都不修改傳入的陣列：
  - `mergeSubmissions`：同題保留 `submittedAt` 較新的一份，時間相同時保留本機的；
  - 新增 `mergeVoided`、`reconcileVoided`、`applyVoid`；
  - `getQuestionStatus` 新增第三個參數 `isVoided`，有作廢時回傳 `'voided'`。

  驗證：在 `public/student/logic.test.js` 新增測試，涵蓋：
  - 作廢時間晚於作答時，移除作答；
  - 重送時間晚於作廢時，移除作廢；
  - 作廢事件之後才收到的舊快照，不會把題目鎖回去；
  - 重送之後才收到的舊快照，不會把作廢提示加回來；
  - 同題作廢多次，保留最晚的作廢時間；
  - 快照的作答比本機新時，採用快照；
  - `getQuestionStatus` 的優先順序：已送出 → 已作廢 → 草稿 → 未作答；
  - 傳入的陣列沒有被修改。

  既有測試全部通過。

  手動：`node --test public/student/logic.test.js`

## 2. 學生頁接上作廢

- [x] 2.1 在 `public/student/app.js` 新增：
  - `loadedVoided`，並在清空 `loadedSubmissions` 的兩處一併清空；
  - `projectVoided`：欄位不存在時視為空陣列；
  - `applyGroupSnapshot`，取代三個快照合併點的 `mergeSubmissions`；
  - 重新同步後，該題的鎖定或作廢狀態有變化時，重繪作答頁。

  驗證：`npm test` 全部通過。

  手動：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server，學生從 `http://localhost:3000/student/` 進場並送出第 1 題。
  2. 關閉該分頁，以 PowerShell 登入老師並呼叫 `POST /api/teacher/submissions/void` 作廢第 1 題順位 1。
  3. 重新開啟學生頁，確認第 1 題顯示「已作廢，可重新送出」，而且可以作答。

- [x] 2.2 在 `public/student/app.js` 完成：
  - 新增 `handleVoid`，掛上 SSE `void` 事件；
  - 本裝置送出成功與收到 `submission` 事件後，執行 `reconcileVoided`；
  - `renderQuestionGrid` 顯示「已作廢，可重新送出」；
  - `renderQuestionPage` 在已作廢且未鎖定時，顯示作廢提示。

  驗證：`npm test` 全部通過。

  手動（啟動方式同 2.1）：
  1. 老師在 `http://localhost:3000/teacher/` 登入，產生 3 組並開始搶答。
  2. 三個學生分別從不同來源進場：
     - 第 1 組 A 裝置：`http://localhost:3000/student/`
     - 第 1 組 B 裝置：`http://127.0.0.1:3000/student/`
     - 第 2 組：區網 IP `http://<本機區網 IP>:3000/student/`
  3. 第 1 組 A 送出第 1 題，接著第 2 組也送出第 1 題。
  4. 第 1 組 A 停在第 1 題作答頁，B 停在題號格。老師作廢第 1 組第 1 題後，確認：
     - 2 秒內 A 的作答頁解鎖，並顯示作廢提示；
     - B 的題號格顯示「已作廢，可重新送出」；
     - 第 2 組畫面沒有任何變化，任何畫面都沒有出現順位。
  5. B 填寫並送出第 1 題，確認 A 在 2 秒內顯示「已送出」與 B 的答案，作廢提示消失。
  6. 老師畫面顯示第 1 組重送的作答排在最後。
  7. 讓 A 斷線約 45 秒，期間老師再作廢一次。A 恢復連線後，確認題目顯示為已作廢。
