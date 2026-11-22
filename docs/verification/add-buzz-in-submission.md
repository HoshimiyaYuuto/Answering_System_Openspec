# add-buzz-in-submission 驗證紀錄

## 1. 驗證環境

| 欄位 | 填寫 |
| --- | --- |
| 作業系統 | Microsoft Windows 10 家用版 (10.0.19045.0)  |
| Node.js 版本 | v26.13.1 |
| PowerShell 版本 | 5.1.19041.6456 |
| 日期 |  |

## 2. 自動測試

請各執行兩次，並分別記錄結果與輸出數字。

| 執行次數 | 指令 | 結果 | 數字 |
| --- | --- | --- | --- |
| 第一次 | `npm test` | 通過 | `tests 115`, `pass 115`, `fail 0`, `duration_ms 16468.3365` |
| 第二次 | `npm test` | 通過 | `tests 115`, `pass 115`, `fail 0`, `duration_ms 23081.5268` |
| 第一次 | `npm run check:capacity` | 通過 | `SSE：clients 100、questionCount 50、maxLatencyMs 5；提交：5000 筆、totalMs 603、slowestQuestionMs 35` |
| 第二次 | `npm run check:capacity` | 通過 | `SSE：clients 100、questionCount 50、maxLatencyMs 5；提交：5000 筆、totalMs 589、slowestQuestionMs 34` |

## 3. API 手動驗證

請先在 repo 根目錄建立 `.env`，並設定 `TEACHER_PASSWORD`。以下指令及預期結果供逐步驗證；每步結果留待填寫。

| 步驟 | 指令 | 預期結果 | 結果 |
| --- | --- | --- | --- |
| 1. 啟動 server | `$env:NODE_ENV='development'; npm start` | server 啟動，development 題目與組別種子可用 | 符合預期 |
| 2. 準備中讀題 | `Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","groupId":1}'`；再執行 `Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=stu-aaaa1111"` | 進場有效；讀題回 `409 QUESTIONS_NOT_AVAILABLE` | 符合預期 |
| 3. 組 1 學生 A 進場 | `Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","groupId":1}'` | `valid=True` | 符合預期 |
| 4. 組 1 學生 B 進場 | `Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-cccc3333","groupId":1}'` | `valid=True` | 符合預期 |
| 5. 組 2 學生進場 | `Invoke-RestMethod -Method Put http://localhost:3000/api/student/entry -ContentType 'application/json' -Body '{"studentId":"stu-bbbb2222","groupId":2}'` | `valid=True` | 符合預期 |
| 6. 啟動組 1 學生 A SSE 視窗 | `Start-Process powershell -ArgumentList '-NoExit','-Command','curl.exe -N "http://localhost:3000/api/events?studentId=stu-aaaa1111"'` | 獨立視窗保持 SSE 連線 | 符合預期 |
| 7. 啟動組 1 學生 B SSE 視窗 | `Start-Process powershell -ArgumentList '-NoExit','-Command','curl.exe -N "http://localhost:3000/api/events?studentId=stu-cccc3333"'` | 獨立視窗保持 SSE 連線 | 符合預期 |
| 8. 啟動組 2 SSE 視窗 | `Start-Process powershell -ArgumentList '-NoExit','-Command','curl.exe -N "http://localhost:3000/api/events?studentId=stu-bbbb2222"'` | 獨立視窗保持 SSE 連線 | 符合預期 |
| 9. 啟動公開 SSE 視窗 | `Start-Process powershell -ArgumentList '-NoExit','-Command','curl.exe -N "http://localhost:3000/api/events"'` | 獨立視窗保持 SSE 連線 | 符合預期 |
| 10. 老師登入 | `Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<TEACHER_PASSWORD>"}' -SessionVariable teacher` | 登入成功並建立 `$teacher` WebSession | 符合預期 |
| 11. 開始搶答 | `Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher` | 成功開始；四個 SSE 視窗都收到 `event: phase` | 符合預期 |
| 12. 組 1 學生 A 提交題 1 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":1,"answers":["答案A"]}'` | 成功；只有 `stu-aaaa1111` 與 `stu-cccc3333` 視窗收到 `event: submission`；事件不含 `rank`，組 2 與公開視窗沒有提交事件 | 符合預期 |
| 13. 組 1 學生 B 重送題 1 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-cccc3333","questionId":1,"answers":["答案B"]}'` | `409 ALREADY_SUBMITTED` | 符合預期 |
| 14. 組 2 學生提交題 1 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-bbbb2222","questionId":1,"answers":["答案C"]}'` | 成功；組 2 可獨立提交同題，事件只送組 2 連線 | 符合預期 |
| 15. 讀取組 1 作答狀態 | `Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=stu-aaaa1111" \| ConvertTo-Json -Depth 5` | 只看見組 1 答案，回應沒有 `rank` | 符合預期 |
| 16. 讀取組 2 作答狀態 | `Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=stu-bbbb2222" \| ConvertTo-Json -Depth 5` | 只看見組 2 答案，回應沒有 `rank` | 符合預期 |
| 17. 題組答案缺空格 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":10,"answers":["只有一格"]}'` | `400 INVALID_ANSWER` | 符合預期 |
| 18. 字串題號 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":"1","answers":["答案"]}'` | `404 QUESTION_NOT_FOUND` | 符合預期 |
| 19. 結束活動 | `Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher` | 成功結束活動 | 符合預期 |
| 20. 結束後提交 | `Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"stu-aaaa1111","questionId":2,"answers":["答案"]}'` | `409 SUBMISSION_NOT_ALLOWED` | 符合預期 |
| 21. 結束後讀取資料 | 依序執行`Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=stu-aaaa1111" \| ConvertTo-Json -Depth 5`, `(Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=stu-aaaa1111").data.questions.Count`, 及`(Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=stu-aaaa1111").data.questions[0] \| ConvertTo-Json -Depth 5` | 第一個回 200，內容與結束前相同，只有 questionId、answers、submittedAt，沒有 rank；第二個回50（development 種子）；第三個只有 id 與 blanks（每個 blank 只有 index、prefix、prompt） | 符合預期 |
| 22. 未進場學生呼叫題目、提交、狀態端點及 `GET /api/events?studentId=student-unknown` | `Invoke-RestMethod "http://localhost:3000/api/student/questions?studentId=student-unknown"`；`Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"student-unknown","questionId":1,"answers":["答案"]}'`；`Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=student-unknown"`；`curl.exe -i "http://localhost:3000/api/events?studentId=student-unknown"` | 四個請求皆為 `403 STUDENT_NOT_ENTERED` | 符合預期 |

## 4. 未測項目

- 100 條帶 `studentId` 的 SSE 連線同時在線並承受 5,000 筆提交的事件送達。`capacity-check` 只量測 100 條公開連線的階段事件延遲，以及 5,000 筆提交的耗時與順位。
- server 重啟後，帶 `studentId` 的 EventSource 會得到 403；學生端需自行改走進場恢復流程，屬於學生端畫面的 change。
- 多程序或持久化情境；目前僅使用單一程序記憶體狀態。
