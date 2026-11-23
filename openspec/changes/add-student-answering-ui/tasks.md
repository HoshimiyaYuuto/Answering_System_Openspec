# Tasks: add-student-answering-ui

> 說明：每個 task 只動一到兩個檔案。純函式與草稿存取以 `node --test` 驗證，DOM 部分以手動驗證。手動驗證前須先 `Copy-Item .env.example .env` 並設定 `TEACHER_PASSWORD`，用 `$env:NODE_ENV='development'; npm start` 啟動（development 有 100 組與 50 題，其中題 10、20、30、40、50 為 2 空格題組），並以老師登入與 `-WebSession` 開始、結束搶答（指令見 `docs/api-contract.md` 的「搶答送出」章節）。需要第二個「裝置」時，請用另一個瀏覽器或無痕視窗，因為同一個瀏覽器的分頁共用 `localStorage`。

## 1. 純函式（logic.js）

- [x] 1.1 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增：`getAnsweringScreen(entryValid, phase)`（對應 select-group／waiting／answering／ended）、`getQuestionStatus(hasSubmission, hasDraft)`（對應未作答／草稿／已送出）、更新 `getPhaseDisplay('搶答中')` 的訊息。驗證：`node --test public/student/logic.test.js`，涵蓋四種畫面與三種狀態，並更新既有的 `getPhaseDisplay` 斷言。
- [x] 1.2 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增 `validateAnswers(values, blanksCount)`：每格 trim 後須 1–200 字元、數量須等於空格數，回傳 `{ ok, answers }` 或 `{ ok:false, errors }`（指出第幾格與原因）。驗證：`node --test public/student/logic.test.js`，涵蓋空白、200 與 201 字元邊界、前後空白、題組缺格。
- [x] 1.3 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增 `applySubmission(submissions, submission)`（冪等地加入或取代一筆本組作答，不修改原物件）與 `getSubmitErrorNextStep(error)`（把 design 第 5 節的表轉成動作：`show-message`、`refresh-submissions`、`refresh-session`、`restore-entry`、`reload-questions`、`retry`）。驗證：`node --test public/student/logic.test.js`，涵蓋重複套用同一筆、每種錯誤代碼、逾時。
- [x] 1.4 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增 `getEventErrorNextStep(readyState)`：`CLOSED`（2）回傳 `restore-entry`，`CONNECTING`（0）回傳 `wait`。驗證：`node --test public/student/logic.test.js`。

## 2. 草稿存取（drafts.js）

- [x] 2.1 新增 `public/student/drafts.js` 與 `public/student/drafts.test.js`：`createDraftStore(storage)` 提供 `get(studentId, questionId, blanksCount)`、`set(...)`、`remove(...)`、`has(...)`；鍵為 `draft:<studentId>:<questionId>`；空格數不符時 `get` 回傳 null 並移除；`storage` 丟例外或為 undefined 時降級為記憶體。驗證：`node --test public/student/drafts.test.js`，用假的 storage 涵蓋存取、移除、長度不符、storage 丟例外。

## 3. 畫面與資料載入

- [x] 3.1 修改 `public/student/index.html`：新增 `answering` 區塊（題號格容器、單題作答頁容器、訊息區）與 `ended` 區塊與樣式，全部預設 `hidden`；沿用現有的樣式風格，題號按鈕與輸入框最小高度 44px 以上。驗證：啟動 server 後開學生頁，進場後仍只看到等待畫面，沒有新區塊露出；用瀏覽器開發者工具確認新元素存在且為 hidden。
- [x] 3.2 修改 `public/student/app.js`：進入搶答中時並行讀取 `GET /api/student/questions` 與 `GET /api/student/submissions`，依 `getAnsweringScreen` 切換畫面，渲染題號格與狀態文字；已結束顯示「活動已結束」。驗證：手動——準備中只有等待畫面；開始搶答後約 2 秒內出現 50 個題號，標示「未作答」；第二個瀏覽器在搶答中首次進場也直接看到題號格；結束後顯示「活動已結束」。

## 4. 作答與送出

- [x] 4.1 修改 `public/student/app.js`：點題號進入作答頁，依 `blanks` 顯示前綴、提示與輸入框（題 10 應有兩個）；輸入時以 `drafts.js` 保存草稿，進入時恢復，返回題號格時狀態更新為「草稿」。驗證：手動——輸入後重新整理並再次進入該題，內容恢復，題號格顯示「草稿」。
- [x] 4.2 修改 `public/student/app.js`：送出前以 `validateAnswers` 驗證（失敗時顯示原因且不呼叫 API）；送出時進入 submitting（輸入與按鈕停用、10 秒逾時）；成功後鎖定並顯示「已送出」與答案、清除草稿。驗證：手動——空白、201 字元、題 10 只填一格都被擋下並顯示原因；有效答案送出後題號格顯示「已送出」且輸入框不可用。
- [x] 4.3 修改 `public/student/app.js`：依 `getSubmitErrorNextStep` 處理送出失敗：`ALREADY_SUBMITTED` 重新讀本組作答並說明由其他裝置送出；`SUBMISSION_NOT_ALLOWED` 重新確認階段；`STUDENT_NOT_ENTERED` 回到選組；逾時顯示「伺服器沒有回應」並允許重試。驗證：手動——以第二個瀏覽器同組送出同題後，第一個瀏覽器再送出，得到「已由其他裝置送出」並顯示對方答案；結束活動後送出，顯示「活動已結束」；暫停 server 後送出，顯示「伺服器沒有回應」，恢復後重試成功或得到已送出。

## 5. 即時同步與重連

- [x] 5.1 修改 `public/student/app.js`：進場成功與重新整理恢復後，關閉舊連線並建立 `EventSource('/api/events?studentId=...')`；階段事件與心跳行為不變；換組或進場失效時關閉；`error` 時依 `getEventErrorNextStep` 處理（CLOSED 時重新確認進場）。驗證：手動——學生進場後，開發者工具的 Network 分頁看到帶 studentId 的事件連線；重啟 server 後頁面回到選組畫面並說明進場狀態失效。
- [x] 5.2 修改 `public/student/app.js`：收到 `submission` 事件時以 `applySubmission` 更新本組作答並鎖定畫面；重新連線成功（`open`）後重新讀取階段與本組作答。驗證：手動——兩個瀏覽器同一組，A 送出題 1，B 在 2 秒內看到題 1 變成「已送出」並顯示 A 的答案（若 B 正開著題 1，輸入框鎖定）；第三個瀏覽器在另一組，畫面完全沒有變化。

## 6. 整合驗證

- [x] 6.1 新增 `docs/verification/add-student-answering-ui.md`，比照既有驗證紀錄格式：環境欄（作業系統、Node 版本、瀏覽器與版本，留白）、自動測試（`npm test` 的 tests／pass／fail，留白）、手動驗證步驟（涵蓋 spec 的每個 Requirement，每步有操作與預期結果，結果欄留白；有巢狀陣列輸出的指令要加 `| ConvertTo-Json -Depth 5`），以及「未測項目」：真實手機與區網裝置、100 位學生同時在線的畫面表現、螢幕閱讀器、已結束後的結果頁（屬於 `add-student-results`）。老師控制台的作答監看（需 add-teacher-monitoring 已合併）看得到學生頁送出的答案與名次，而學生頁本身不顯示名次。
- [x] 6.2 執行 `npm test`，並完成 6.1 的手動驗證後填寫結果。驗證：全部通過；未通過的項目不得勾選此 task。

## Workflow follow-up

- 完成後執行 `/openspec-verify-change add-student-answering-ui`，通過後 sync 與 archive。
- 歸檔前先通知組員，避免重複歸檔。
