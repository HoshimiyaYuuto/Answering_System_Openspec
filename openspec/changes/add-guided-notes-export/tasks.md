# Tasks: add-guided-notes-export

前提：`add-buzz-in-submission`（PR #8）與 `add-results-computation`（PR #9）都已合併到 main；apply 前先把本分支更新到最新的 main，確認 `server/submissions.js` 與 `server/results.js` 存在且介面與 design 的 Context 一致，不一致時先停下來更新 design。

測試一律不連 Google：服務帳號金鑰在測試中以 `crypto.generateKeyPairSync('rsa')` 即時產生並寫入暫存檔，Google 的 token、寫入與重新讀取都以注入的假 `fetch` 或假 `downloadGuidedNotesImpl` 取代。測試用密碼沿用 `test-password`。作答一律以注入的 `createSubmissions()` 呼叫 `submit()` 建立，不經開發用路由。repo 內不得出現真實金鑰、金鑰檔路徑以外的金鑰內容或真實試算表 ID。

## 1. 匯入保存寫回目標

- [x] 1.1 修改 `server/guided-notes-import.js` 與 `server/guided-notes-import.test.js`：`locateBlank()` 在前綴右側沒有空白格時，改取前綴合併範圍右側第一個起始格作為答案位置，該格有內容時加入「已有內容，匯出時會被取代」警告（design 第 4 節）；`downloadGuidedNotes()` 多回傳 `spreadsheetId`；`createPreview()` 多收 `target` 並由 `exportSource()` 回傳，`target` 不出現在 `summarize()` 的結果；驗證：`npm test` 涵蓋 8 份 fixtures 結果與 `expected.json` 一致，以 exceljs 在測試中產生「G5 為（1）、H5 已有文字」的工作表時答案位置為 H5 且有警告，`downloadGuidedNotes()` 回傳的 `spreadsheetId` 與連結相同，摘要中不含 `spreadsheetId`
- [x] 1.2 修改 `server/index.js` 與 `server/guided-notes-api.test.js`：連結預覽把 `{ spreadsheetId }` 當作 `target` 傳入，上傳預覽傳 `null`；驗證：`npm test` 確認連結匯入後 `exportSource().target.spreadsheetId` 正確，接著以上傳匯入取代後 `target` 為 `null`，且 `GET /api/teacher/guided-notes` 與學生可取得的資料都不含試算表 ID

## 2. 答案與儲存格內容、下載 xlsx

- [x] 2.1 新增 `server/guided-notes-export.js` 與 `server/guided-notes-export.test.js`：`winningAnswers()`、`buildCellWrites()`、`buildAnswerWorkbook()` 與 `GuidedNotesExportError`（design 第 2、3 節）；驗證：`npm test` 以 `computeResults()` 的實際輸出餵給 `winningAnswers()`，涵蓋順位最小的有效作答為勝者、順位 1 作廢時取順位 2 的答案、無勝者的題目不產生寫入；`02` 題組寫 H5、H6 且 G5、G6 不變；`04` 題組寫「（1）甲」到 G7；`01` 單題寫 G5；「=1+1」在產生的 xlsx 中重新讀取為字串而非公式；未作答題目的儲存格值與原檔相同
- [x] 2.2 在 `server/index.js` 新增 `GET /api/teacher/guided-notes/export`，勝者依 design 第 5 節第 7 步由 `computeResults()` 與既有 `submissions` 取得（design 第 3、7 節）；新增 `server/guided-notes-export-api.test.js`；驗證：`npm test` 涵蓋未登入 401、準備中與搶答中 409 `EXPORT_NOT_ALLOWED`、未匯入 409 `NO_GUIDED_NOTES`、已結束時回 xlsx 且 `Content-Disposition` 含 `filename*`、上傳與連結兩種來源都能下載、作廢的作答不被匯出、匯出前後 `GET /api/session` 相同；手動：`npm start` 後老師登入並上傳 `01-official-single.xlsx`、設定 1 組，執行下列指令，以 Excel 開啟 `answers.xlsx` 確認 G5 為「光合作用」

  ```powershell
  Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","groupId":1}'
  Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
  Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":1,"answers":["光合作用"]}'
  Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher
  Invoke-WebRequest http://localhost:3000/api/teacher/guided-notes/export -WebSession $teacher -OutFile answers.xlsx
  ```

## 3. 寫回 Google 試算表

- [x] 3.1 新增 `server/google-sheets.js` 與 `server/google-sheets.test.js`：`loadServiceAccount()`、`createSheetsClient()` 的 JWT 簽章、token 快取、`values.batchUpdate`（RAW、工作表名稱加引號與跳脫）與錯誤分類（design 第 6 節）；驗證：`npm test` 以測試產生的公鑰驗證 JWT 簽章與 claim，連續兩次寫入只取一次 token、時間前進到到期前 60 秒內會重新取得，請求 body 的 `range` 為 `'學習單'!H5` 且 `valueInputOption` 為 `RAW`，design 第 6 節錯誤表的每一列各有一個案例，金鑰檔不存在或缺欄位時回 `null`，任何錯誤的 `message` 都不含私鑰、token 或 Google 原文
- [x] 3.2 在 `server/guided-notes-export.js` 新增 `relocateQuestions()`，並補 `server/guided-notes-export.test.js`（design 第 5 節第 9 步）；驗證：`npm test` 以 exceljs 在測試中產生「匯入版」與「插入一列後」兩份工作表，插列後答案位置下移一列且 `remapped` 為 true；版面相同時 `remapped` 為 false；題號 3 改成 30 時丟出 `SHEET_MODIFIED` 且訊息含「第 3 題」；空格數不同時丟出 `SHEET_MODIFIED`；已寫回過的 `02` 與 `04` 工作表重新定位後答案位置與第一次相同，且沿用匯入時的前綴
- [x] 3.3 在 `server/index.js` 新增 `sheetsClient` 選項、`POST /api/teacher/guided-notes/writeback`、`GET /api/teacher/guided-notes/writeback` 與寫回進行中旗標，啟動時依 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` 建立預設 client（design 第 5、7 節）；新增 `server/guided-notes-writeback-api.test.js`；驗證：`npm test` 依 design 第 5 節的順序逐一涵蓋 401、409 `EXPORT_NOT_ALLOWED`、409 `NO_GUIDED_NOTES`、409 `GUIDED_NOTES_NOT_LINK`、503 `SHEET_NOT_CONFIGURED`、409 `WRITEBACK_IN_PROGRESS`（第一個請求未完成時送第二個）、無勝者時回 0 且沒有呼叫假 client（作答以注入的 `submissions` 建立）、502 `SHEET_CHECK_FAILED`、409 `SHEET_MODIFIED`、成功時假 client 收到的 writes 與 `writtenCells`、`remapped` 正確，假 client 丟出 `SHEET_NOT_EDITABLE` 時原樣回傳；查詢端點在已設定與未設定時的 `configured`、`serviceAccountEmail`、`target` 正確；任何失敗後 `GET /api/session` 不變
- [x] 3.4 更新 `docs/api-contract.md` 與 `.env.example`（design 第 9 節）：新增「Guided Notes 匯出」一節（三個端點、回應、錯誤表、PowerShell 範例）；`.env.example` 加上註解掉的 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=` 與「金鑰檔放 repo 外」的說明；驗證：依文件的 PowerShell 範例操作，未設定金鑰時寫回得到 `503 SHEET_NOT_CONFIGURED`，查詢得到 `configured: false`，回應與文件一致；`git grep -nE "BEGIN [P]RIVATE KEY"`（以 `[P]` 避免比對到這行指令本身） 在 repo 中沒有結果

## 4. 教師控制台匯出區塊

- [x] 4.1 新增 `public/teacher/export-logic.js` 與 `public/teacher/export-logic.test.js`：狀態、`getExportView()` 的五種畫面、事件與按鈕可用條件（design 第 8 節）；驗證：`npm test` 涵蓋五種畫面的判定、寫回中與下載中兩個按鈕都停用、成功訊息含格數且 `remapped` 時含重新對位說明、失敗訊息含 server 訊息與下載備援提示、`phaseChanged` 清除結果
- [x] 4.2 修改 `public/teacher/index.html`：在匯入區塊之後新增「匯出結果」區塊（狀態說明、服務帳號信箱、「寫回 Google 試算表」與「下載 xlsx」按鈕、結果訊息）；驗證：`npm start` 後開啟 `http://localhost:3000/teacher/` 並登入，區塊存在且在準備中顯示「活動結束後才能匯出」、兩個按鈕停用
- [x] 4.3 修改 `public/teacher/app.js`：串接 4.1 的邏輯，進入控制台與 SSE `open` 時讀取寫回設定（丟棄過期回應），匯入確認後更新來源，寫回呼叫 `POST .../writeback`，下載以 `fetch` 取得 blob 後觸發下載，401 回到登入；驗證：`npm test` 通過，並依下列瀏覽器步驟操作（`.env` 設定測試用密碼，未設定服務帳號）：
  1. 在 `http://localhost:3000/teacher/` 登入，上傳 `01-official-single.xlsx` 並確認，匯出區塊顯示「活動結束後才能匯出」。
  2. 以 `http://127.0.0.1:3000/student/` 與 `http://<區網 IP>:3000/student/` 兩個視窗分別選第 1 組、第 2 組進場。
  3. 老師開始搶答，先不結束，匯出區塊仍顯示「活動結束後才能匯出」；步驟 4 結束後，匯出區塊變成「只有下載可用」並說明上傳的檔案沒有線上試算表可寫回。
  4. 在第 1 組學生頁送出第 1 題答案（學生頁尚未完成時，改用 2.2 的 `POST /api/student/submissions` 指令送出）後，老師結束搶答，按「下載 xlsx」，下載的檔案 G5 為該組的答案。
  5. 在 `http://<區網 IP>:3000/teacher/` 另開老師頁登入，畫面與 localhost 相同。
  6. 重新啟動 server（狀態清空、階段回到準備中），老師頁回到登入畫面，重新登入後匯出區塊沒有殘留先前的訊息。

## 5. 服務帳號設定與真實試算表驗證

- [ ] 5.1 更新 `README.md`：新增「寫回 Google 試算表」一節，包含建立 Google Cloud 專案、啟用 Sheets API、建立服務帳號與 JSON 金鑰、把金鑰放在 repo 外並在 `.env` 寫路徑、把試算表共用給服務帳號信箱為編輯者、匯入前需設為「知道連結者可檢視」、第二次寫回不會清除本次無人作答的題目、下載 xlsx 可能遺失部分格式；驗證：依 README 步驟設定後 `npm start`，`GET /api/teacher/guided-notes/writeback` 回 `configured: true` 與服務帳號信箱
- [ ] 5.2 以真實 Google 試算表人工驗證，結果記錄於 `docs/verification/add-guided-notes-export.md`（不記錄試算表 ID、金鑰路徑以外的金鑰資訊或答案以外的個資）：把 `02-official-group.xlsx` 與 `04-mixed-groups.xlsx` 上傳到 Google 雲端硬碟並「儲存為 Google 試算表」，設為「知道連結者可檢視」並共用給服務帳號；驗證：
  1. 以連結匯入 `02`，開始後由一組學生以 `POST /api/student/submissions` 送出第 1 題「甲」「乙」，結束後按寫回，線上試算表 H5、H6 出現答案，G5、G6 前綴與格式不變，畫面顯示寫入 2 格。
  2. 再按一次寫回，答案仍在 H5、H6，前綴不變。
  3. 以 `04` 重做一次，G7 等格為「（1）甲」形式。
  4. 匯入後在線上試算表第 3 列上方插入一列，寫回仍對到正確題目，畫面顯示已重新對位（AC-S-05）。
  5. 把某題題號改掉後寫回，畫面顯示 `SHEET_MODIFIED` 的原因，線上試算表沒有被寫入。
  6. 取消共用服務帳號後寫回，畫面顯示沒有編輯權限與服務帳號信箱，並提示改用下載 xlsx。
  7. 未轉成 Google 試算表的 xlsx 檔以連結匯入後寫回，畫面顯示 `SHEET_NOT_NATIVE` 的說明（若該檔無法以連結匯入，記錄實際結果）。
  8. 學生以 `POST /api/student/submissions` 送出答案「=1+1」並寫回，線上試算表顯示文字「=1+1」（學生頁尚未完成，以 PowerShell 送出）。

## 6. 整合檢查

- [x] 6.1 整合檢查：以最新 main（含 PR #8、#9）重跑全部測試，並以學生頁實際送出重跑 4.3 的步驟 3、4（學生頁尚未完成時改用 PowerShell 送出，並在 `docs/verification/add-guided-notes-export.md` 記錄）；驗證：`npm test` 全部通過，`npm run check:capacity` 通過，`openspec validate add-guided-notes-export --strict` 通過

## Workflow follow-up

- 開 PR 請學生端成員 review，合併後執行 archive。
