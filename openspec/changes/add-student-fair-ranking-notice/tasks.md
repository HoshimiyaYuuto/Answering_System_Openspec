# Tasks

## 1. 純函式

- [x] 1.1 在 `public/student/logic.js` 依 design 第 1 節擴充 `buildResultsRows`：
  - 新增 `fairRankingNotice`：`fairRankingEnabled === true` 時為「本場使用公平順位」，否則為空字串；
  - `winner.byFairRanking === true` 的題目，`winnerText` 後加「（本題因公平順位改判）」。

  驗證：在 `public/student/logic.test.js` 新增測試，涵蓋：
  - 啟用且第 3 題改判：`fairRankingNotice` 為「本場使用公平順位」，第 3 題 `winnerText` 加註，`ownText` 為「本組第 2 名：…」；第 1 題（`byFairRanking: false`）不加註；
  - `fairRankingEnabled: false`：`fairRankingNotice` 為空字串，沒有任何加註；
  - 缺少 `fairRankingEnabled` 與 `byFairRanking`，或值為 `null`、`"true"`：視為否；
  - `null`、`{}` 輸入的 `fairRankingNotice` 為空字串；
  - 加註後的答案仍是原樣的純文字（含 `<b>` 的答案不被轉換）。

  既有測試除了空輸入的完整比對要補上 `fairRankingNotice: ''` 之外，全部不需修改且通過。

  手動：`node --test public/student/logic.test.js`

## 2. 學生頁接線

- [x] 2.1 在 `public/student/app.js` 與 `public/student/index.html` 依 design 第 2 節：
  - 新增 `#results-fair-ranking` 段落（`hint` 樣式，預設隱藏）；
  - `loadStudentResults()` 把 `fairRankingEnabled` 一併傳給 `renderStudentResults()`；
  - `renderStudentResults()` 依 `fairRankingNotice` 設定文字與顯示；
  - `clearResultsView()` 清空並隱藏。

  驗證：`npm test` 全部通過。

  手動（瀏覽器）：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 學生分別從不同來源進場：
     - 第 1 組：`http://localhost:3000/student/`
     - 第 2 組：`http://127.0.0.1:3000/student/`
  3. 老師在 `http://localhost:3000/teacher/` 勾選「啟用公平順位」並開始。
  4. 第 1 組依序送出第 1、2 題，每題之間等超過 3 秒。
  5. 第 1 組送出第 3 題，第 2 組在 3 秒內也送出第 3 題，之後老師結束搶答。
  6. 第 1 組結果頁確認：
     - 摘要下方顯示「本場使用公平順位」；
     - 第 3 題顯示第 2 組與答案並加註「（本題因公平順位改判）」，本組第 2 名；
     - 第 1、2 題沒有加註。
  7. 第 2 組結果頁確認同樣的說明，第 3 題本組第 1 名（成功）。
  8. 老師重設：學生回到選組頁，結果區塊與說明都不見。不勾選再開一場並結束：結果頁沒有「本場使用公平順位」，也沒有加註。
