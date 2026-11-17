# Tasks: add-guided-notes-import

## 1. 相依套件

- [x] 1.1 以 `npm install exceljs@4.4.0` 加入相依套件（`package.json`、`package-lock.json`）；驗證：`node -e "import('exceljs').then(m => console.log(typeof m.default.Workbook))"` 輸出 `function`，且 `npm test` 原有測試全數通過

## 2. 解析與匯入模組

本組只動 `server/guided-notes-import.js` 與 `server/guided-notes-import.test.js`。

- [x] 2.1 實作表頭列定位、工作表選擇與單題辨識（題號為正整數的列為一題，接受數值 `1`、`1.0` 與文字 `"1"`，其他列略過）；驗證：`npm test` 中對 `01`、`03`、`05` 的測試通過，工作表名稱、表頭列、題號、每個空格的 `anchorCell` 與 `expected.json` 一致
- [x] 2.2 實作題組辨識、前綴擷取與答案寫入位置規則（design 第 4 節），以及「作答格已有內容」與空白題目敘述的處理；驗證：`02`、`04` 的題數、空格數、前綴、`anchorCell` 與 `expected.json` 一致，`02` 第 1 題第 1 格 `answerCell` 為 `H5`、`01` 第 1 題為 `G5`；以測試內建立的活頁簿確認非數字列被略過、已有內容的作答格產生提醒、空白敘述仍匯入
- [x] 2.3 實作錯誤：`IMPORT_NO_HEADER`、`IMPORT_NO_QUESTIONS`、`IMPORT_DUPLICATE_NUMBER`（訊息含題號與兩個列號）、`IMPORT_INVALID_FILE`（空內容、非 xlsx、損壞檔）；驗證：`90`、`91`、`92` 與兩種無效位元組的測試各自得到對應錯誤代碼
- [x] 2.4 實作匯入狀態：建立預覽（含 `previewId`、`replacesExisting`、摘要）、只保留最新預覽、確認後輸出公開題目 `{ id, prompt, blanks: [{ index, prefix, prompt }] }` 並保存私有的原始檔與空格位置；驗證：測試確認舊 `previewId` 被拒絕、公開題目序列化後不含 `anchorCell`、`answerCell` 與檔案內容
- [x] 2.5 實作 Google 試算表連結轉換與下載（只接受 `https://docs.google.com/spreadsheets/d/<id>`，10 秒逾時、5 MiB 上限、內容非 zip 視為無法存取），下載函式可注入；驗證：以假的下載函式測試合法連結、其他網域、`http`、非試算表路徑、回傳 HTML、超過大小與逾時，各自得到預期結果，且無效連結不會呼叫下載函式

## 3. 匯入 API

本組只動 `server/index.js` 與 `server/guided-notes-api.test.js`（`3.4` 例外，見該項）。

- [x] 3.1 新增 `POST /api/teacher/guided-notes/preview/file`：路由個別使用 5 MiB 的原始位元組解析、讀取 `X-File-Name`，檢查順序為 loopback → 準備中 → 內容，超過大小回 `413 IMPORT_FILE_TOO_LARGE`；驗證：測試涵蓋成功摘要、非 loopback（連到區網位址）回 `403`、搶答中回 `409 IMPORT_NOT_ALLOWED`、超過大小回 `413`，且原有 16 KiB JSON 上限的測試仍通過
- [x] 3.2 新增 `POST /api/teacher/guided-notes/preview/link`，`createApplication()` 新增可注入下載函式的選項；驗證：以假下載函式測試成功、`IMPORT_INVALID_LINK` 與 `IMPORT_LINK_UNREACHABLE`
- [x] 3.3 新增 `POST /api/teacher/guided-notes/confirm` 與 `GET /api/teacher/guided-notes`；確認後取代 `session.questions`；驗證：測試確認 `GET /api/session` 的 `questionCount` 在確認後才變為 6、再匯入題組範本後變為 4、舊 `previewId` 回 `409 IMPORT_PREVIEW_EXPIRED`、匯入失敗時題數不變、非準備中確認被拒絕
- [x] 3.4 在 `docs/api-contract.md` 新增「Guided Notes 匯入」一節（4 個端點、request／response 範例、錯誤代碼表）；驗證：啟動 `npm start` 後依文件執行下列 PowerShell 指令，回應與文件一致

  ```powershell
  Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/guided-notes/preview/file -ContentType 'application/octet-stream' -Headers @{ 'X-File-Name' = '01-official-single.xlsx' } -InFile fixtures/guided-notes/01-official-single.xlsx
  Invoke-RestMethod http://localhost:3000/api/teacher/guided-notes
  ```

## 4. 臨時教師頁的匯入區塊

- [x] 4.1 新增 `public/teacher/import-logic.js` 與 `public/teacher/import-logic.test.js`：純函式負責畫面狀態轉換（未匯入、已匯入、讀取中、待確認、確認中）、依階段與來源決定按鈕是否可用、摘要表格的列資料、以遞增序號丟棄過期回應；驗證：`npm test` 涵蓋每個狀態轉換、非準備中與區網 IP 時停用、過期回應被丟棄
- [x] 4.2 在 `public/teacher/index.html` 的組別設定下方加入「匯入學習單」區塊（選檔、連結輸入、摘要表格、確認與取消按鈕、狀態訊息），沿用既有樣式；驗證：`npm start` 後開啟 `http://localhost:3000/teacher/`，區塊顯示「尚未匯入」，組別設定仍可正常使用
- [x] 4.3 在 `public/teacher/app.js` 串接匯入 API 與 4.1 的邏輯，畫面一律以取代內容繪製；驗證：`npm test` 通過，並依下列瀏覽器步驟操作：
  1. `http://localhost:3000/teacher/` 上傳 `01-official-single.xlsx`，摘要顯示 6 題；按取消，顯示「尚未匯入」
  2. 再上傳並確認，顯示 6 題；開 `http://localhost:3000/api/session`，`questionCount` 為 6
  3. 上傳 `02-official-group.xlsx`，摘要提示會取代目前題目，第 1、2 題為題組並顯示前綴；確認後顯示 4 題
  4. 上傳 `90-invalid-no-header.xlsx`，顯示找不到表頭的錯誤，題數仍為 4
  5. 改用 `http://127.0.0.1:3000/teacher/` 開啟，匯入操作可用
  6. 以 `http://<區網IP>:3000/teacher/` 開啟，顯示警告且匯入操作停用
  7. 以 `Invoke-RestMethod -Method Post http://localhost:3000/api/session/start` 開始搶答後重新整理教師頁，匯入操作停用並說明原因
  8. 分別以 `http://localhost:3000/student/`、`http://127.0.0.1:3000/student/`、`http://<區網IP>:3000/student/` 模擬三位學生進場，確認進場不受匯入影響
- [x] 4.4 更新 `README.md` 的「目前進度」與新增「匯入學習單」使用說明（支援格式、Google 試算表分享設定、只能在準備中匯入）；驗證：依 README 的說明可完成一次上傳匯入

## 5. 整合驗證

- [x] 5.1 執行 `npm test` 與 `npm run check:capacity`，全部通過，確認既有功能未受影響
- [ ] 5.2 人工驗證並記錄於 `docs/verification/add-guided-notes-import.md`：
  - 把官方範本複製到自己的 Google 雲端硬碟，設為「知道連結者可檢視」，以連結匯入，結果與上傳 xlsx 相同；改回「限制」後再匯入，顯示檢查分享設定的錯誤
  - 自製一份表頭位置、欄位位置與題數都和 fixtures 不同的學習單（含題組），匯入後題數、空格數與前綴正確（AC-000-03）
  - 記錄驗證環境、步驟、結果與發現的問題

## Workflow follow-up

- 與學生端成員確認 `session.questions` 的欄位名稱；若有改名，在 apply 前更新 design 與 2.4。
- 執行 `/openspec-verify-change add-guided-notes-import`，通過後 sync 與 archive。
- 依組員約定的目標分支開 PR，由學生端成員 review 後合併。
