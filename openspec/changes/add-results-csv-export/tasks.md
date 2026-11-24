# Tasks: add-results-csv-export

前提：本分支建立在 `feat/guided-notes-export`（PR #16）之上，並已併入 `docs/submission-record.md` v0.4。apply 前先確認 `server/results.js` 的 `computeResults()`、`server/index.js` 的 `exportGuard()` 與 `exportFileName()`、`public/teacher/export-logic.js` 的 `reduceExport()`／`getExportView()` 存在且與 design 的 Context 一致；不一致時先停下來更新 design。

作答一律以注入的 `createSubmissions()` 呼叫 `submit()` 或經 `POST /api/student/submissions` 建立，不經開發用路由。測試用密碼沿用 `test-password`。時間相關測試一律傳入明確的 `timeZone`，不依賴執行機器的時區。

## 1. csv 產生

- [x] 1.1 新增 `server/results-csv.js` 與 `server/results-csv.test.js`：`buildResultsCsv({ questions, groups, submissions, results, fairRankingEnabled, timeZone })`，包含欄位跳脫（公式前綴後再 RFC 4180）、本地時間格式化與排序（design 第 2、3、4 節）；驗證：`npm test` 涵蓋
  - 表頭逐字為 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位`，開頭為 BOM、每列以 `\r\n` 結尾（含最後一列）
  - 2 空格題組兩組送出時輸出 4 列，順序為第 1 名的空格 1、2，再第 2 名的空格 1、2；勝者為 `是`、其他為 `否`
  - 無作答的題目沒有資料列；完全沒有作答時只有表頭
  - 以 `computeResults()` 的實際輸出餵入，送達第 1 的作答已作廢時該筆不出現，第 2 名的順位為 1 且為 `是`
  - `timeZone: 'Asia/Taipei'` 時 `2026-11-24T01:02:03.456Z` 輸出 `2026-11-24 09:02:03`，`timeZone: 'UTC'` 時輸出 `2026-11-24 01:02:03`；跨日（UTC 16:30 → 台北隔天 00:30）正確
  - `=1+1` → `'=1+1`，`+1`、`-1`、`@a` 同樣加單引號；`甲,"乙"` → `"甲,""乙"""`；含換行的答案被雙引號包住；`=a,b` → `"'=a,b"`；組名 `-第一組` → `'-第一組`；一般中文答案不加引號
  - `fairRankingEnabled` 為 `false` 時公平順位欄為 `否`；為 `true` 時以手寫的判定結果測試 `winnerSource: 'fair'` 的題目為 `是（改判）`、其他題目為 `是`
  - 找不到的組別輸出 `組 <id>`
  - 100 組 × 50 題（每題 2 空格）共 10,000 列在 500 毫秒內產生

## 2. 端點與契約

- [x] 2.1 在 `server/index.js` 新增 `GET /api/teacher/results/csv`（design 第 1 節），檔名與 xlsx 共用同一個產生函式只換副檔名；新增 `server/results-csv-api.test.js`；驗證：`npm test` 涵蓋未登入 401 `TEACHER_AUTH_REQUIRED`、準備中與搶答中 409 `EXPORT_NOT_ALLOWED`、已結束時 `Content-Type` 為 `text/csv; charset=utf-8` 且 `Content-Disposition` 含 `filename*` 與「（搶答結果）.csv」、回應位元組以 `EF BB BF` 開頭、上傳與連結兩種學習單來源都能下載、csv 的順位與 `GET /api/teacher/monitor` 的 `place` 與 `winner` 一致、下載前後 `GET /api/session` 與 `GET /api/teacher/monitor` 相同；手動：`npm start` 後依 2.2 的 PowerShell 範例下載 `results.csv`，以 Excel 開啟確認中文不亂碼、8 欄正確、`=1+1` 顯示為文字
- [x] 2.2 更新 `docs/api-contract.md`（design 第 6 節）：新增「結果 csv 匯出」一節（端點、檢查順序、回應標頭、8 欄定義、排序、編碼、公式防護、PowerShell 範例），並把老師監看章節 `winnerSource` 的可能值改為 `arrival`／`fair`；驗證：依文件的 PowerShell 範例操作，未結束時得到 `409 EXPORT_NOT_ALLOWED`、結束後下載的檔案與文件描述一致；`git grep -n "override" docs/api-contract.md` 沒有結果

  ```powershell
  Invoke-WebRequest http://localhost:3000/api/teacher/results/csv -WebSession $teacher -OutFile results.csv
  ```

## 3. 控制台

- [x] 3.1 修改 `public/teacher/export-logic.js` 與 `public/teacher/export-logic.test.js`：新增 `requestCsv`、`csvDone`、`csvFailed` 事件與 `canDownloadCsv`、`csvLabel`（design 第 5 節）；驗證：`npm test` 涵蓋未結束時 `canDownloadCsv` 為 false、已結束時不論 `importSource` 為 `file` 或 `link`、`config.configured` 為 true 或 false 都為 true、下載中三個動作都停用且標籤為「下載中…」、完成顯示「已下載 CSV。」、失敗顯示 server 訊息、`reset` 回到初始狀態
- [x] 3.2 修改 `public/teacher/index.html` 與 `public/teacher/app.js`：新增「下載 CSV」按鈕，xlsx 與 csv 共用 `downloadFile(url, fallbackName)`（design 第 5 節）；驗證：`npm test` 通過；手動：
  1. `npm start`，在 `http://localhost:3000/teacher/` 登入，設定 2 組並上傳 `02-official-group.xlsx`，「下載 CSV」停用。
  2. 學生以 `http://localhost:3000/student/` 選第 1 組、以 `http://127.0.0.1:3000/student/` 選第 2 組進場；老師開始搶答，按鈕仍停用。
  3. 第 1 組在學生頁送出第 1 題「甲」「乙」，第 2 組送出第 1 題「=1+1」「丙,丁」，第 1 組送出第 3 題。
  4. 老師結束搶答，「下載 CSV」可用；按下後下載檔名為「02-official-group（搶答結果）.csv」並顯示「已下載 CSV。」；以 Excel 開啟，第 1 題 4 列、第 3 題 1 列，順位與老師監看一致，`=1+1` 顯示為文字，「丙,丁」在同一格。
  5. 在 `http://<區網 IP>:3000/teacher/` 另開老師頁登入，「下載 CSV」同樣可用。
  6. 重新啟動 server，老師頁回到登入畫面；重新登入後匯出區塊沒有殘留先前的訊息。

## 4. 整合驗證

- [x] 4.1 新增 `docs/verification/add-results-csv-export.md`，比照既有驗證紀錄格式記錄環境、自動測試數字、3.2 的手動步驟結果與未測項目（作廢與公平順位只以手寫資料測試；SpecKit 的送出時間格式與「順位」語意尚待比對）；驗證：`npm test` 全部通過，`npm run check:capacity` 通過，`openspec validate add-results-csv-export --strict` 通過，紀錄中每一步都有結果
