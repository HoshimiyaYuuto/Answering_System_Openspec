# Tasks

## 1. server

- [x] 1.1 在 `server/index.js` 依 design 第 1、2 節新增：
  - `groupPresence()` 與 `GET /api/teacher/presence`；
  - `notifyPresence()`，在學生連線開啟與關閉、進場或換組成功、組別設定成功、重設之後呼叫。

  驗證：新增 `server/presence-api.test.js`，涵蓋：
  - 未登入回 `401 TEACHER_AUTH_REQUIRED`；
  - 第 2 組學生連上後，第 2 組 `online: true`，其他組為 `false`；
  - 同組兩條連線關閉一條仍在線，兩條都關閉後離線；
  - 準備中換組後，原組離線、新組在線；
  - 學生連線開啟與關閉時，老師連線收到 `presence`，內容只有 `serverTime`；學生連線與公開連線沒有收到；
  - 進場、組別設定、重設之後，老師連線都收到 `presence`；重設後所有組離線；
  - 老師登出後，同一條連線不再收到 `presence`；
  - `GET /api/session` 不含在線資訊。

  既有測試全部通過。`teacher-monitor-events`、`submission-void-api`、`session-reset-api` 三個測試會逐一比對老師連線的事件，它們的 SSE 輔助函式改為略過 `presence`（apply 時發現；在線通知由本 task 的測試驗證），其他斷言不變。

  手動：`node --test server/presence-api.test.js`

- [x] 1.2 更新文件：
  - `docs/api-contract.md`：新增 `GET /api/teacher/presence` 與 `presence` 事件，說明在線的判定方式與只送給老師；
  - `docs/explore_summary.md`：模組表 `projection-board` 狀態改為實作中。

  驗證：`openspec validate --all --strict` 通過；人工比對契約與 1.1 的測試，欄位、狀態碼、事件名稱一致。

  手動：無（文件 task）。

## 2. 投影看板

- [x] 2.1 新增 `public/teacher/board-logic.js`，依 design 第 3 節實作 `createBoardState`、`reduceBoard`、`getBoardView`。

  驗證：新增 `public/teacher/board-logic.test.js`，涵蓋：
  - 未登入與 401 切到 `login` 檢視；
  - 準備中與搶答中列出各組在線或離線，已結束不列；
  - 搶答中有倒數時依 server 時間顯示剩餘時間，沒有倒數或不在搶答中時為空；
  - 搶答中的檢視不含任何作答相關欄位；
  - 已結束時所有題目為「尚未揭曉」：
    - 揭曉下一題依題號順序；
    - 全部揭曉後兩個按鈕都停用；
    - 揭曉數不超過題數；
  - 結果文字：有勝者、題組答案以「／」串接、無人作答、公平順位改判加註；
  - 離開已結束（重設）後清空結果與揭曉進度，再次進入已結束時從 0 開始；
  - 在線與結果的舊回應（序號不是最新）被丟棄。

  手動：`node --test public/teacher/board-logic.test.js`

- [x] 2.2 新增 `public/teacher/board.html` 與 `board.js`，並在 `public/teacher/index.html`、`app.js` 加上「開啟投影看板」連結（design 第 3、4、5 節）。

  驗證：`npm test` 全部通過。

  手動（瀏覽器）：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 未登入的瀏覽器開 `http://localhost:3000/teacher/board.html`：只看到「請先在教師控制台登入」與連結。
  3. 在 `http://localhost:3000/teacher/` 登入，確認有「開啟投影看板」，點下後新分頁開啟看板，顯示「準備中」與各組離線。
  4. 學生分別從不同來源進場，2 秒內看板上該組變成在線：
     - 第 1 組：`http://localhost:3000/student/`
     - 第 2 組：`http://127.0.0.1:3000/student/`
     - 第 3 組：區網 IP `http://<本機區網 IP>:3000/student/`
  5. 關閉第 3 組的分頁，2 秒內看板上第 3 組變成離線。
  6. 老師以 1 分鐘倒數開始：看板顯示「搶答中」與剩餘時間。第 1 組送出第 1 題，看板沒有任何變化。
  7. 老師結束：看板顯示「搶答結果」，各題「尚未揭曉」。
     - 按兩次「揭曉下一題」：第 1 題顯示第 1 組與答案，第 2 題顯示「無人作答」。
     - 按「全部揭曉」後，按鈕停用。
  8. 重新整理看板：回到全部未揭曉。
  9. 老師重設：看板回到「準備中」。
