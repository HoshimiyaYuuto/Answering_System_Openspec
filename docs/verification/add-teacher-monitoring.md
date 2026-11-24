# add-teacher-monitoring 驗證紀錄

## 1. 驗證環境

| 欄位 | 填寫 |
| --- | --- |
| 作業系統 | Windows 11 家用版 |
| Node.js 版本 | v24.22.0 |
| PowerShell 版本 | 5.1.26100 |
| 瀏覽器 | Claude 桌面版內建瀏覽器 |
| 日期 | 2026/11/22 |

server 以 `NODE_ENV=production`、測試用密碼 `test-password`（環境變數，非 `.env` 的真實密碼）啟動於 port 3000。

## 2. 自動測試

| 指令 | 結果 | 數字 |
| --- | --- | --- |
結果與數字見第 4 節。本 change 新增的測試：`server/teacher-monitor.test.js`（9 項）、`server/teacher-monitor-api.test.js`（4 項，含 50 組 × 50 題查詢在 200 毫秒內）、`server/teacher-monitor-events.test.js`（4 項）、`public/teacher/monitor-logic.test.js`（11 項）。

## 3. 手動驗證（tasks 3.3）

學生作答畫面（`add-student-answering-ui`）尚未完成，學生進場與送出依 tasks 的替代方式改用 API：進場以 `curl.exe` 呼叫 `PUT /api/student/entry`，送出以 `POST /api/student/submissions`。匯入以 API 上傳 `fixtures/guided-notes/02-official-group.xlsx`（4 題，第 1、2 題為 2 空格題組）。

| 步驟 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| 1 | 老師在 `http://localhost:3000/teacher/` 登入，設定 2 組並匯入 `02` | 監看區塊顯示「開始搶答後會顯示各組作答。」 | 符合 |
| 2 | `stu-aaaa1111` 以第 1 組、`stu-bbbb2222` 以第 2 組進場 | 兩者 `valid: true` | 符合 |
| 3 | 老師按「開始搶答」，第 1 組先、第 2 組後送出第 1 題 | 2 秒內第 1 題顯示「已送出 2／2 組，第 1 名：第 1 組」；展開後第 1 組第 1 名、第 2 組第 2 名（AC-000-05） | 符合（等待 1 秒後即更新） |
| 4 | 第 1 題展開狀態下，第 2 組送出第 3 題 | 第 1 題保持展開 | 符合 |
| 5 | 第 2 組送出答案 `<b>粗體</b>` | 畫面顯示原字串，頁面中沒有 `<b>` 元素 | 符合（`<b>` 元素數為 0） |
| 6 | 老師按「結束搶答」並確認 | 2 秒內標題變為「搶答結果」，每題顯示勝者組別與答案（AC-000-07） | 符合（1 秒內） |
| 7 | 第 1 組送出第 2 題時，以 `curl.exe -N` 監聽公開連線與第 2 組學生連線 3 秒 | 兩條連線都只有 `retry: 3000`，沒有 `monitor` 或其他事件（AC-S-07） | 符合 |
| 8a | 在 `http://192.168.0.156:3000/teacher/`（Wi-Fi 位址）另開老師頁登入 | 畫面與 localhost 相同 | 符合 |
| 8b | 另開第二個 `http://localhost:3000/teacher/` 分頁（共用 cookie），在該頁登出，再切回原分頁 | 原分頁下一次更新時回到登入畫面，監看區塊清空 | 符合 |

說明：

- 步驟 8 的「其中一頁登出、另一頁回到登入」只適用於同一來源。localhost 與區網 IP 是不同來源，各有自己的 cookie 與登入 token，在其中一個登出不影響另一個，這是預期行為。
- 以 Git Bash 的 `curl` 送出中文答案時，命令列參數不是 UTF-8，畫面上出現亂碼；改用 Node `fetch` 送出的「光合作用」「甲／乙」顯示正確。這是測試工具的編碼問題，與系統無關；之後的手動驗證請用 PowerShell 的 `Invoke-RestMethod` 或學生頁送出中文。

## 4. 整合檢查（tasks 4.1）

| 指令 | 結果 | 數字 |
| --- | --- | --- |
| `npm test` | 通過 | `tests 158`、`pass 158`、`fail 0`、`duration_ms 16803` |
| `npm run check:capacity` | 通過 | SSE：clients 100、questionCount 50、maxLatencyMs 7；提交：5000 筆、totalMs 1067、slowestQuestionMs 60 |
| `openspec validate add-teacher-monitoring --strict` | 通過 | |

## 5. 以學生頁重跑（2026/11/23）

`add-student-answering-ui`（PR #13，commit `736fe9c`）完成後，在本機把它合併到 main（`2370014`，已含本 change）的暫時分支上重跑；該分支只用於驗證，沒有推送。環境同第 1 節，`npm test` 為 `tests 172`、`pass 172`、`fail 0`。

兩個學生「裝置」以不同來源開啟學生頁，各自有獨立的 `localStorage`：第 1 組用 `http://localhost:3000/student/`，第 2 組用 `http://127.0.0.1:3000/student/`。組別與匯入同第 3 節（2 組、`02`）。

| 步驟 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| 2' | 兩個學生頁分別點選第 1 組、第 2 組進場 | 進入等待畫面 | 符合 |
| 3' | 老師開始搶答；第 1 組在學生頁填第 1 題兩格（`CPU`、`作業系統`）送出，第 2 組接著送出 | 學生頁顯示「已送出」且不顯示名次；老師端 2 秒內顯示「已送出 1／2 組，第 1 名：第 1 組」，第 2 組送出後為 2／2；展開後第 1 組第 1 名、第 2 組第 2 名 | 符合（等待 2 秒內更新） |
| 4' | 第 1 題展開狀態下，第 2 組在學生頁送出第 3 題 | 第 1 題保持展開，第 3 題更新為 1／2 | 符合 |
| 5' | 第 2 組第 1 題第 1 格填 `<b>粗體</b>` | 老師端顯示原字串，頁面中沒有 `<b>` 元素 | 符合（`<b>` 元素數為 0） |
| 6' | 老師結束搶答 | 老師端 2 秒內變為「搶答結果」：第 1、3 題顯示勝者，第 2、4 題顯示「無人作答」；兩個學生頁顯示「活動已結束」 | 符合 |
| 9 | 重啟 server，設定 100 組、匯入 `02`，老師頁登入後以 Node 腳本讓 100 位學生進場並同時送出 4 題（共 400 筆） | 400 筆都成功；老師端最後每題顯示「已送出 100／100 組」，與 `GET /api/teacher/monitor` 一致；查詢次數遠少於送出筆數 | 符合：400 筆全部 200，總耗時 265 毫秒；老師頁每題 100／100；這段期間老師頁只查詢 `/api/teacher/monitor` 6 次 |

說明：

- 步驟 9 回應 PR #12 review 的提醒：查詢進行中收到的 `monitor` 事件只會累積成一次補查，快速大量送出後「已送出 N／M 組」仍等於最後的真實數字。查詢次數以在老師頁包裝 `fetch` 計數取得。
- 步驟 7（公開連線與學生連線收不到 `monitor` 事件）沒有用學生頁重跑；學生頁送出時兩邊畫面都只顯示本組資料，連線層的行為仍以第 3 節的 `curl.exe -N` 結果與 `teacher-monitor-events.test.js` 為準。

## 6. 未測項目

- 「判定中」的畫面：未啟用公平順位，由 `monitor-logic.test.js` 涵蓋。「無人作答」已在第 5 節步驟 6' 確認。
- 已作廢作答的畫面：作廢功能尚未實作，由 `teacher-monitor.test.js` 與 `monitor-logic.test.js` 以手寫資料涵蓋。
- server 重啟後老師頁的行為：`EventSource` 以 `role=teacher` 重連得到 401 後會重新確認登入狀態並回到登入畫面；本次未手動重啟 server 驗證（第 5 節步驟 9 重啟後是重新整理頁面再登入）。
