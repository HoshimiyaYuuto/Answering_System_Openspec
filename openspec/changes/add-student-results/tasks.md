# Tasks: add-student-results

> 說明：每個 task 只動一到兩個檔案。純函式與 API 以 `node --test` 驗證，畫面以手動驗證。手動驗證前須 `Copy-Item .env.example .env` 並設定 `TEACHER_PASSWORD`，用 `$env:NODE_ENV='development'; npm start` 啟動（development 有 100 組與 50 題，題 10、20、30、40、50 為 2 空格題組），並以老師登入與 `-WebSession` 開始、結束搶答（指令見 `docs/api-contract.md` 的「搶答送出」章節）。需要第二個「裝置」時，請用另一個瀏覽器或無痕視窗。

## 1. 契約與 server

- [x] 1.1 更新 `docs/api-contract.md`：只在檔案末尾新增「學生結果」章節（`GET /api/student/results`、檢查順序、回應白名單範例、`409 RESULTS_NOT_AVAILABLE`、不含組別識別碼與任何 `rank`），並在既有「待補的作答紀錄格式」一節中把「學生端結果」從待補敘述改成已定義；其他既有段落逐字不動。驗證：逐項對照 design 第 1、2 節，確認無遺漏。
- [x] 1.2 新增 `server/student-results.js` 與 `server/student-results.test.js`：純函式 `buildStudentResults({ questions, submissions, groups, groupId })`，依 design 第 3 節以 `computeResults()` 組出每題的 `winner`、`own`。驗證：`node --test server/student-results.test.js`，涵蓋：有勝者、自己是勝者、自己未作答、無人作答、題組答案依空格順序、狀態非有效的作答被忽略、組別名稱找不到時的備用文字、回應序列化後不含他組 `groupId`、`rank`、他組答案。
- [x] 1.3 在 `server/index.js` 新增 `GET /api/student/results`，沿用學生端點共用的 `studentId` 與有效進場檢查，階段須為已結束（否則 `409 RESULTS_NOT_AVAILABLE`），不快取；新增 `server/student-results-api.test.js`。驗證：`node --test server/student-results-api.test.js`，涵蓋：三種階段、無效 `studentId`、未進場、檢查順序（未進場且非已結束回 `STUDENT_NOT_ENTERED`）、已結束後兩組各自讀到自己的 `own`、勝者資訊兩組相同、回應不含 `rank` 與 `groupId`；手動：`Invoke-RestMethod "http://localhost:3000/api/student/results?studentId=<id>" \| ConvertTo-Json -Depth 6`，搶答中得 409，結束後得結果。

## 2. 學生頁

- [x] 2.1 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增 `formatAnswers(blanks, answers)`、`buildResultsRows(results)`、`getResultsLoadNextStep(status)`（403 → 回選組、409 → 重新確認階段、其他錯誤 → 顯示錯誤與重試）。驗證：`node --test public/student/logic.test.js`，涵蓋單題、題組有前綴、無人作答、本組未作答、本組成功、摘要計數、每種狀態碼、答案含 HTML 字元時原樣保留（不轉義，由畫面以純文字顯示）。
- [x] 2.2 修改 `public/student/index.html`：在「已結束」畫面新增結果區塊（摘要、列表容器、載入中與錯誤訊息、重試按鈕），預設 `hidden`；沿用既有樣式，按鈕最小高度 44px。驗證：開學生頁，準備中與搶答中都看不到新區塊（F12 確認存在且為 hidden）。
- [ ] 2.3 修改 `public/student/app.js`：進入已結束（階段事件與重新整理恢復）時讀取結果，依 `buildResultsRows` 渲染摘要與每題一列，一律用 `textContent`；已載入就不重複讀取；失敗時顯示「無法載入結果，請稍後再試」與重試按鈕；依 `getResultsLoadNextStep` 處理 403 與 409。驗證：手動，見 3.2 的 R 步驟。

## 3. 負載與驗證

- [ ] 3.1 擴充 `server/capacity-check.js`：在既有 5,000 筆提交場景結束後結束活動，讓 100 位學生同時讀取結果，確認全部回 200、每位的 `own` 與其組別的提交一致、回應不含 `rank`，並印出一行 JSON `{ students, totalMs, slowestMs }`。門檻先設為總耗時 5,000 毫秒內，首次量測後依實際結果調整並把理由寫入驗證紀錄。驗證：`npm run check:capacity`（跑兩次）。
- [ ] 3.2 新增 `docs/verification/add-student-results.md`，比照 `docs/verification/add-student-answering-ui.md` 的格式：環境欄、自動測試（`npm test` 與 `check:capacity` 的數字，留白）、手動步驟（R1 搶答中沒有結果區塊；R2 結束後約 2 秒內出現結果、摘要與每題列正確；R3 兩組各自看到自己的名次且勝者資訊相同；R4 題組答案顯示前綴與順序；R5 重新整理後仍顯示結果；R6 本組未作答與無人作答的題目顯示正確；R7 答案含 `<b>x</b>` 以純文字顯示；R8 暫停 server 後重新整理顯示錯誤與重試，恢復後重試成功；R9 server 重啟後回到選組畫面；R10 F12 搜尋 `rank` 與 `groupId` 沒有出現；R11 老師控制台（需 `add-teacher-monitoring` 已合併）顯示的名次與學生頁一致）、規格對照、觀察、未測項目，結果欄與結論留白。
- [ ] 3.3 執行 `npm test` 與 `npm run check:capacity`，完成 3.2 的手動驗證後填寫結果。驗證：全部通過；未通過的項目不得勾選此 task。

## Workflow follow-up

- 完成後執行 `/openspec-verify-change add-student-results`，通過後歸檔（`openspec archive add-student-results --yes`），歸檔後立刻補主規格的 Purpose 並執行 `openspec validate --specs --strict`。
- 歸檔前先通知組員。
