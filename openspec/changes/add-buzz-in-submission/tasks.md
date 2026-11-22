# Tasks: add-buzz-in-submission

> 前提：`add-teacher-console` 已合併，老師端點改用 `requireTeacher`，開始搶答須先登入，且至少一組一題（`NO_GROUPS`、`QUESTIONS_REQUIRED`）。自動測試沿用 `server/groups-entry.test.js` 的做法：以 `createApplication({ teacherPassword })` 建立 app，先呼叫 `POST /api/teacher/login` 取得 cookie，再呼叫 `POST /api/session/start`。手動驗證前須 `Copy-Item .env.example .env` 並設定 `TEACHER_PASSWORD`；開發環境也可用 `POST /api/dev/phase/搶答中` 略過登入（僅限開發測試）。

## 1. 契約與提交狀態模組

- [x] 1.1 更新 `docs/api-contract.md`：新增三個學生端點、`/api/events` 的 `studentId` 參數與 `submission` 事件、新錯誤代碼（`STUDENT_NOT_ENTERED`、`QUESTIONS_NOT_AVAILABLE`、`SUBMISSION_NOT_ALLOWED`、`QUESTION_NOT_FOUND`、`INVALID_ANSWER`、`ALREADY_SUBMITTED`）、檢查順序與隱私規則，並把「待補的公開題目格式」改為正式定義。驗證：逐項對照 design 第 1、2、6、7 節，確認無遺漏；之後各 task 的 API 測試須與契約範例一致。
- [x] 1.2 新增 `server/submissions.js` 與 `server/submissions.test.js`：純記憶體、同步的提交狀態（每組每題一筆、答案驗證與 trim、server UTC 時間、每題獨立順位、`status:'valid'`、內部 `listSubmissions()` 與狀態變更訂閱）。驗證：`node --test server/submissions.test.js`，涵蓋空白、200 字元邊界、題組缺空格、重複提交、順位獨立。
- [x] 1.3 在 `server/submissions.test.js` 加入並行測試：100 組同題同時提交，順位恰為 1 至 100；同組兩筆同時提交只有一筆成功；100 組 × 50 題連續提交後各題順位皆連續不重複。驗證：`node --test server/submissions.test.js`。

## 2. 學生 API

- [x] 2.1 在 `server/index.js` 新增 `GET /api/student/questions`（白名單投影、準備中 409、搶答中與已結束可讀），並新增 `server/buzz-in-api.test.js`。驗證：`node --test server/buzz-in-api.test.js`；手動：以 PowerShell 啟動 development server（已設定 `.env`），用 `Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=stu-aaaa1111"` 在準備中得 409、開始後得題目且不含題目層 `prompt` 與儲存格位置。
- [x] 2.2 在 `server/index.js` 新增 `POST /api/student/submissions`，依 design 第 1 節的檢查順序，成功只回 `{ questionId, submittedAt }`；在 `server/buzz-in-api.test.js` 補測試：六種錯誤代碼、檢查順序、成功回應不含順位。驗證：`node --test server/buzz-in-api.test.js`；手動：`Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":1,"answers":["答案"]}'`，再送一次應得 `409 ALREADY_SUBMITTED`。
- [x] 2.3 在 `server/index.js` 新增 `GET /api/student/submissions`（任何階段、只回本組、不含順位）；在 `server/buzz-in-api.test.js` 補測試：同組另一個 `studentId` 取得相同結果、他組提交不出現在本組回應。驗證：`node --test server/buzz-in-api.test.js`；手動：以同組兩個 `studentId` 各呼叫一次，結果一致。
- [x] 2.4 在 `server/index.js` 更新 development 50 題種子（`id` 10、20、30、40、50 為 2 空格題組，其餘單題，皆含題目層 `prompt` 與 `blanks`）；在 `server/buzz-in-api.test.js` 補測試：development 啟動題數為 50 且形狀正確、production 為 0。驗證：`node --test server/buzz-in-api.test.js`。

## 3. 組別限定即時同步

- [x] 3.1 在 `server/index.js` 讓 `GET /api/events` 支援可選 `studentId`：驗證失敗回標準錯誤、成功則保存連線與 `studentId`，事件送出時才查詢目前組別，連線關閉時移除；新增 `server/buzz-in-events.test.js`。驗證：`node --test server/buzz-in-events.test.js`，涵蓋無參數行為不變、無效 `studentId` 被拒、關閉連線被釋放、準備中換組後事件送到新組。
- [x] 3.2 在 `server/index.js` 讓成功提交時發出 `submission` 事件（內容 `{ questionId, answers, submittedAt }`，不含順位）給同組連線；在 `server/buzz-in-events.test.js` 補測試：同組收到、他組與無參數連線什麼都沒收到、公開 `/api/session` 與 `phase` 事件內容不變、2 秒內送達。驗證：`node --test server/buzz-in-events.test.js`；手動：見 4.2。

## 4. 負載與整合驗證

- [ ] 4.1 擴充 `server/capacity-check.js`：新增送出場景，100 組 × 50 題經 HTTP 全部送出（先讓 100 個 `studentId` 進場並開始搶答），確認全部成功、每題順位無重複（以 `listSubmissions()` 檢查，不經學生 API），並印出總耗時。門檻：5,000 筆在本機 10 秒內完成；首次量測後依實際結果與測試機器調整，並把理由與數字寫入驗證紀錄。驗證：`npm run check:capacity`。
- [ ] 4.2 新增 `docs/verification/add-buzz-in-submission.md`，記錄環境（作業系統、Node 版本、PowerShell）與手動步驟。需包含：`$env:NODE_ENV='development'; npm start`；用 `Invoke-RestMethod -Method Put` 讓 `stu-aaaa1111`、`stu-cccc3333`（組 1）與 `stu-bbbb2222`（組 2）進場；開三個 PowerShell 視窗各執行 `curl.exe -N "http://localhost:3000/api/events?studentId=..."`（組 1 兩台、組 2 一台），另開第四個視窗不帶參數；先登入（`Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<TEACHER_PASSWORD>"}' -SessionVariable teacher`），再以 `Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher` 開始搶答（development 種子已有組別與題目），結束活動同理使用 `/api/session/end`；開始後以組 1 提交題 1，確認只有組 1 兩個視窗出現 `submission` 事件、組 2 與公開視窗沒有；再以組 2 提交同題，兩邊互不影響；提交題 10（題組）缺一個空格得 `400 INVALID_ANSWER`；結束活動後再提交得 `409 SUBMISSION_NOT_ALLOWED`，但 `GET /api/student/submissions` 仍可讀取。
- [ ] 4.3 執行 `npm test` 與 `npm run check:capacity`，把結果與未測項目補進驗證紀錄。驗證：兩個指令皆通過；Codex 沙盒無法執行時，由使用者在本機執行並記錄，不得宣稱通過。

## Workflow follow-up

- 完成後執行 `/openspec-verify-change add-buzz-in-submission`，通過後 sync 與 archive。
- 開 PR 前確認 `docs/api-contract.md` 與實作一致。
