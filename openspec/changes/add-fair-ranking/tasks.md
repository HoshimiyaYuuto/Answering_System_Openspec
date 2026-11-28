# Tasks

## 1. 判定規則

- [x] 1.1 在 `server/results.js` 依 design 第 1 節實作公平順位：
  - `now` 預設 `Infinity`；
  - 依 `(t0, questionId)` 的判定順序、3000 毫秒含邊界的同批、依成功題數再依 `rank` 排序；
  - 判定中的題目不計入成功題數；
  - 移除 `FAIR_RANKING_NOT_SUPPORTED`，保留 `OVERRIDE_NOT_SUPPORTED`。

  驗證：在 `server/results.test.js` 新增測試，涵蓋：
  - 成功 2 題與 0 題的兩組：後送達的 0 題組勝出，`winnerSource` 為 `'fair'`；
  - 3 秒後才送達的不在同一批；恰好 3000 毫秒仍在同一批；
  - 同批成功題數相同時依送達順序；三組依 0、1、2 題排序，批次外排在最後；
  - 第 2 題的第一個作答比第 1 題早時，先判定第 2 題，並影響第 1 題；兩題第一個作答時間相同時題號小者先；
  - `now` 在批次內時為判定中，不計入後面題目；`now` 省略或為 `Infinity` 時全部已判定；
  - 作廢第 1 題勝者後，第 1 題與第 2 題連鎖重判，兩題勝者與成功題數一致；
  - 未啟用時，同樣的資料仍是先到先得，作廢不影響其他題；
  - 同一輸入推導 100 次結果相同，所有批次結束後不同 `now` 結果相同；
  - 傳入的陣列沒有被修改。

  既有測試中「公平順位被拒絕」的那一個改為「公平順位可推導」，其他既有測試全部通過。

  手動：`node --test server/results.test.js`

## 2. server

- [x] 2.1 在 `server/index.js` 與 `server/student-results.js` 依 design 第 2、4 節完成：
  - 開始時檢查並寫入 `fairRankingEnabled`，重設時清除；
  - 摘要、`phase` 事件、開始回應帶出設定；
  - 新增 `judgeResults()`，監看、CSV、`currentWinners`、學生結果都改用它；
  - `buildStudentResults` 改為接受 `results` 與 `fairRankingEnabled`，輸出 `fairRankingEnabled` 與 `winner.byFairRanking`。

  驗證：新增 `server/fair-ranking-api.test.js`，並更新 `server/student-results.test.js` 的呼叫方式。涵蓋：
  - 預設 `false`；`true` 時摘要與 `phase` 事件都為 `true`；`"yes"` 回 `400 INVALID_FAIR_RANKING`，階段維持準備中；
  - 重設後回到 `false`；
  - 啟用時，第 1 組先贏 2 題，第 3 題第 1 組先送、第 2 組 1 秒內再送，結束後：
    - 監看的第 3 題勝者為第 2 組、`winnerSource` 為 `'fair'`；
    - CSV 第 3 題第 2 組順位 1、`是`，兩組第 8 欄都是 `是（改判）`，其他題為 `是`；
    - 學生結果 `fairRankingEnabled` 為 `true`，第 3 題 `winner.byFairRanking` 為 `true`；第 1 組的 `own.place` 為 2；
    - 學生結果仍不含 `rank`、`groupId`、`placings`、`winnerSource`；
  - 搶答中、第一個作答送達後 1 秒內，監看該題為判定中；結束後同一題已判定；
  - 未啟用時，所有回應的既有欄位與現在相同，CSV 第 8 欄為 `否`。

  為了控制時間，用 `createApplication` 的 `now` 注入時鐘，送出時間也由同一個時鐘產生。

  既有測試全部通過。

  手動：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 以 PowerShell 登入老師，呼叫 `POST /api/session/start`，body 為 `{"fairRankingEnabled":true}`。
  3. `GET /api/session` 確認 `fairRankingEnabled` 為 `true`。

- [x] 2.2 在 `server/index.js` 依 design 第 3 節新增 `notifyTeachers()` 與 `scheduleBatchNotice()`：送出與作廢後重排計時器，結束與重設時清除。

  驗證：在 `server/fair-ranking-api.test.js` 新增測試（用注入的計時器）：
  - 啟用時一組送出後，排出一個在第一個作答加 3050 毫秒觸發的計時器；
  - 觸發後老師連線收到 `monitor`，重新讀取監看時該題已判定；
  - 有兩題時，依序排出第二個計時器；
  - 作廢後重新排程；
  - 結束後計時器被取消；
  - 未啟用時不排計時器。

  手動（啟動方式同 2.1）：
  1. 老師在 `http://localhost:3000/teacher/` 勾選「啟用公平順位」並開始（3.2 完成後操作）。
  2. 學生從 `http://localhost:3000/student/` 送出第 1 題。
  3. 確認老師監看先顯示「判定中」，約 3 秒後自動變成第 1 名，不需重新整理。

- [x] 2.3 更新文件，依 design 第 6 節：
  - `docs/api-contract.md`：start body 與錯誤、摘要與 `phase` 的 `fairRankingEnabled`、監看通知、學生結果欄位、重設清空項目。
  - `docs/submission-record.md`：第 2 節改為已實作，補上「`now` 省略或已結束時視為全部已判定」。
  - `docs/explore_summary.md`：模組表 `fair-ranking` 的負責人註明由教師端成員接手，狀態改為實作中。

  驗證：`openspec validate --all --strict` 通過；人工比對契約與 2.1、2.2 的測試，欄位、狀態碼、錯誤碼一致。

  手動：無（文件 task）。

## 3. 教師控制台

- [x] 3.1 在 `public/teacher/console-logic.js` 與 `public/teacher/monitor-logic.js` 依 design 第 5 節新增：
  - `canEditFairRanking`、`describeFairRanking`；
  - 已結束時改判題目的「（公平順位改判）」。

  驗證：在 `public/teacher/console-logic.test.js` 與 `public/teacher/monitor-logic.test.js` 新增測試，涵蓋：
  - 只有準備中、閒置時可以編輯；
  - 準備中與尚未載入時 `describeFairRanking` 為空字串，搶答中與已結束為「啟用」或「不啟用」；
  - 已結束時 `winnerSource` 為 `'fair'` 的題目加註，`'arrival'` 的題目不加；
  - 搶答中不加註。

  既有測試全部通過。

  手動：`node --test public/teacher/console-logic.test.js public/teacher/monitor-logic.test.js`

- [x] 3.3 在 `public/teacher/monitor-logic.js` 依 design 第 5 節，把展開的明細改為依名次列出有效作答，已作廢的依送達順序排在最後。

  驗證：在 `public/teacher/monitor-logic.test.js` 新增測試，涵蓋：
  - 公平順位改判後第 1 名列在第 2 名之前；
  - 已作廢的作答排在有效作答之後。

  既有測試只調整受順序影響的斷言，其他全部通過。

  手動（啟動方式同 2.1）：重複 3.2 第 5 步後展開第 3 題，確認第 2 組（第 1 名）列在第 1 組（第 2 名）之前。

- [x] 3.2 在 `public/teacher/app.js` 與 `public/teacher/index.html` 依 design 第 5 節完成：
  - 勾選框與規則說明；
  - 開始時帶出設定；
  - 活動狀態的「公平順位」列。

  驗證：`npm test` 全部通過。

  手動（啟動方式同 2.1）：
  1. 老師在 `http://localhost:3000/teacher/` 登入，確認「啟用公平順位」預設未勾選，旁邊有規則說明。
  2. 三組學生分別從不同來源進場：
     - 第 1 組：`http://localhost:3000/student/`
     - 第 2 組：`http://127.0.0.1:3000/student/`
     - 第 3 組：區網 IP `http://<本機區網 IP>:3000/student/`
  3. 勾選並開始：確認活動狀態顯示「公平順位：啟用」，勾選框停用。
  4. 第 1 組依序送出第 1、2 題，每題之間等超過 3 秒，讓第 1 組成功 2 題。
  5. 第 1 組送出第 3 題，第 2 組在 3 秒內也送出第 3 題：
     - 確認監看第 3 題先顯示「判定中」；
     - 約 3 秒後第 2 組變為第 1 名。
  6. 結束搶答：
     - 確認「搶答結果」第 3 題顯示第 2 組與「（公平順位改判）」，第 1、2 題沒有加註；
     - 下載 CSV，確認第 3 題第 8 欄為 `是（改判）`，其他題為 `是`。
  7. 重設後確認「公平順位」列隱藏。不勾選再開一場，重複第 5 步：確認第 1 組勝出，CSV 第 8 欄為 `否`。
