# add-student-results 驗證紀錄

> 環境欄、結果欄、數字欄、觀察與結論由驗證者填寫；未執行的步驟請標示「未測」並說明原因。

## 1. 環境

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026/11/23 |
| 作業系統 | Microsoft Windows 10 家用版 (10.0.19045.0) |
| Node 版本（`node -v`） | v26.13.1 |
| PowerShell 版本 | 5.1.19041.6456 |
| 瀏覽器 A（一般視窗，第 1 組） | Google 一般視窗 |
| 瀏覽器 B（無痕視窗，第 1 組） | Google 無痕視窗 |
| 瀏覽器 C（另一種瀏覽器，第 2 組） | Edge InPrivate 視窗 |
| 分支與 commit（`git log --oneline -1`） | 82ea100 |

## 2. 自動測試與靜態檢查

| 指令 | 預期 | 結果 | 數字（填 `totalMs／slowestMs` 與提交場景數字） |
| --- | --- | --- | --- |
| `node --test server/student-results.test.js server/student-results-api.test.js public/student/logic.test.js` | 全部通過 | 通過 | `tests 29`, `pass 29`, `fail 0`, `duration_ms 1012.5754` |
| `npm test` | 全部通過 | 通過 | `tests 190`, `pass 190`, `fail 0`, `duration_ms 16546.5754` |
| `npm run check:capacity`（第 1 次） | 全部斷言通過並輸出量測 JSON | 通過 | `SSE：clients 100、questionCount 50、maxLatencyMs 5；student 100、totalMs 79、slowestMs 79；提交：5000 筆、totalMs 606、slowestQuestionMs 35` |
| `npm run check:capacity`（第 2 次） | 全部斷言通過並輸出量測 JSON | 通過 | `SSE：clients 100、questionCount 50、maxLatencyMs 5；student 100、totalMs 70、slowestMs 70；提交：5000 筆、totalMs 617、slowestQuestionMs 34` |
| `Select-String -Path public\student\app.js -Pattern 'innerHTML'` | 沒有輸出 | 通過 | 沒有輸出 |

## 3. 手動驗證的共同準備

若尚未建立 `.env`，先複製範例並在 `.env` 設定 `TEACHER_PASSWORD`；不要將密碼寫入驗證紀錄。

```powershell
Copy-Item .env.example .env        # 已有則略過；確認 TEACHER_PASSWORD 已設定
$env:NODE_ENV='development'; npm start
```

另開 PowerShell 視窗登入老師並保留 session。開始與結束活動都使用同一個 `$teacher`：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<TEACHER_PASSWORD>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher
```

瀏覽器 A、B 分別進入第 1 組；瀏覽器 C 進入第 2 組。各視窗的 `studentId` 可由 F12 → Application → Local Storage → `http://localhost:3000` 底下的 `studentId` 取得（鍵名以實際看到的為準）。development 種子有 100 組與 50 題；題 10、20、30、40、50 是 2 空格題組，其餘為單題。不需呼叫 `/api/groups/generate`。

讀取指定學生的結果：

```powershell
Invoke-RestMethod "http://localhost:3000/api/student/results?studentId=<id>" | ConvertTo-Json -Depth 6
```

以 PowerShell 提交答案的格式（將 `<id>` 與答案換成該視窗的資料）：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"<id>","questionId":1,"answers":["H2O"]}' | ConvertTo-Json -Depth 6
```

## 4. 結果頁（R）

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| R1 | 活動在搶答中時，瀏覽器 A 查看學生頁與 F12 Network。 | 畫面沒有結果區塊，Network 沒有 `GET /api/student/results`。 | 符合預期 |
| R2 | 老師結束活動，查看 A 的學生頁。 | 約 2 秒內顯示「活動已結束」與結果區塊；摘要顯示本組成功題數與總題數，每題列出題號、勝者與答案、本組名次與答案。 | 符合預期 |
| R3 | A、B 同為第 1 組，C 為第 2 組；讓 A、C 依序提交同一題，結束活動後比較三個結果頁。 | 三個畫面顯示相同勝者；第 1 組與第 2 組各自顯示本組名次與答案。 | 符合預期 |
| R4 | 提交題 10 的兩個空格答案後結束活動，查看結果頁該題。 | 答案依空格順序顯示，並帶有題組前綴。 | 符合預期 |
| R5 | 在活動已結束且結果已顯示時重新整理 A。 | 恢復進場後仍顯示結果。 | 符合預期 |
| R6 | 造出指定情境：A（第 1 組）只送出題 1；C（第 2 組）送出題 1 與題 2；題 3 無人作答。結束活動後查看 A 的結果頁。 | A 的題 2 顯示「本組未作答」，題 3 顯示「無人作答」。 | 符合預期 |
| R7 | 提交答案 `<b>x</b>`，結束活動後查看對應答案。 | `<b>x</b>` 以純文字顯示，不執行 HTML。 | 符合預期 |
| R8 | 在 Network 分頁找 results?studentId=，對其右鍵->Block Request->Block Request URL，重新整理已結束的學生頁；解除封鎖後按重試。 | 封鎖時顯示「無法載入結果，請稍後再試」與重試按鈕；解除封鎖後重試成功並顯示結果。 | 符合預期 |
| R9 | A 停在已結束的結果畫面時重啟 server，再重新整理。 | 回到選組畫面並說明進場狀態已失效。 | 符合預期 |
| R10 | 在 F12 Network 只檢查 `GET /api/student/results` 的回應本文，搜尋 `rank`、`groupId`、`placings`、`settled`、`winnerSource`；再檢查學生畫面文字。 | 回應本文找不到上述字串；畫面沒有他組組名（勝者除外）。其他端點（例如進場）可能包含 `groupId`，不屬於此檢查範圍。 | 符合預期 |
| R12a | 見上述步驟：A 的 Console 讓 `/api/student/submissions?` 回應延遲 8 秒；開始搶答後，8 秒內 B 提交題 1 | 事件抵達後 A 的題 1 為「已送出」；快照回覆後仍為「已送出」，不退回「未作答」 | 符合預期 |
| R12b | A 在搶答中封鎖 `*://*/api/events*` 後重新整理；B 提交題 2；解除封鎖 | 10 秒內 A 的題 2 同步為「已送出」 | 符合預期 |
| R13 | A 已進場；封鎖 `*://*/api/student/entry*`；重啟 server；數秒後解除封鎖 | 封鎖期間有重試且畫面不卡住；解除後回到選組畫面並說明進場失效 | 符合預期 |
| R14 | 第一場開始後以 `$activity1 = (Invoke-RestMethod http://localhost:3000/api/session).data.activityId` 記錄 ID；題 1 輸入非空草稿並重新整理，確認恢復後仍有草稿。結束活動後再次讀取 session 並確認 ID 仍等於 `$activity1`。重啟 server，以相同瀏覽器與 studentId 重新進場、開始第二場，記錄 `$activity2`，並開啟題 1。 | 同場草稿可恢復且結束後 ID 不變；`$activity2` 與 `$activity1` 不同，第二場題號格顯示「未作答」、輸入框不帶入第一場答案。 | 符合預期 |

## 5. 老師控制台交叉確認

需 `add-teacher-monitoring` 已合併。

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| R11 | 以老師身分查看控制台或 `GET /api/teacher/monitor` 的名次，並與學生頁 `own.place` 比對。 | 老師端名次與該組學生結果頁顯示的本組名次一致。 | 符合預期 |

## 6. 規格對照

格式錯誤的 `studentId`、未進場、非已結束階段的拒絕順序、非有效作答排除、重複結束事件不重讀，以及結果載入錯誤狀態對應，沒有獨立手動步驟，由自動測試涵蓋。

| 規格 Requirement | 手動步驟 | 自動測試 |
| --- | --- | --- |
| Results are available only after the activity ends | R1、R2 | `server/student-results-api.test.js` |
| Only validly entered students can read results |  | `server/student-results-api.test.js` |
| Results show the winner of each question and the student's own group | R2、R3、R4、R6 | `server/student-results.test.js`、`server/student-results-api.test.js` |
| Results never reveal other groups beyond the winner | R10 | `server/student-results.test.js`、`server/student-results-api.test.js`、`public/student/logic.test.js` |
| Results come from the shared computation | R3、R6 | `server/student-results.test.js` |
| The student page shows results after the activity ends | R1、R2、R4、R5、R6、R7 | `public/student/logic.test.js` |
| The results view handles failures and invalid entries | R8、R9 | `public/student/logic.test.js`、`server/student-results-api.test.js` |
| The student view preserves group submissions across snapshots and reconnects | R12、R13 | `public/student/logic.test.js`（只驗證合併函式；app.js 接線與重試由手動步驟驗證） |
| Student drafts are scoped to one activity | R14 | 手動驗證（草稿 store 的活動範圍及跨 server 重啟行為） |

## 7. 觀察與備註

| 項目 | 說明 |
| --- | --- |
| check:capacity 首次量測後是否調整 5,000 毫秒門檻及理由 | 暫不調整，目前仍足夠 |

## 8. 未測項目

驗證者確認後可增刪以下項目：

- 真實手機與區網裝置。
- 螢幕閱讀器與鍵盤操作。

## 9. 結論

| 項目 | 內容 |
| --- | --- |
| 自動測試 | 通過 |
| 手動驗證 | 通過 |
| 是否可歸檔 | 待教師端成員review後即可歸檔 |
