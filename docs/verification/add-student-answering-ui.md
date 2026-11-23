# add-student-answering-ui 驗證紀錄

> 結果欄、環境欄與結論一律由驗證者親自填寫；未執行的步驟請寫「未測」並說明原因，不要留白後視為通過。

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
| 分支與 commit（`git log --oneline -1`） | 0e1009b |

## 2. 自動測試與靜態檢查

| 指令 | 預期 | 結果 | 數字（tests／pass／fail／duration_ms） |
| --- | --- | --- | --- |
| `node --test public/student/logic.test.js public/student/drafts.test.js` | 全部通過 | 通過 | `tests 16`, `pass 16`, `fail 0`, `duration_ms 55.9503` |
| `npm test` | 全部通過 | 通過 | `tests 142`, `pass 142`, `fail 0`, `duration_ms 16513.589` |
| `Select-String -Path public\student\app.js -Pattern 'innerHTML'` | 沒有輸出 | 通過 | 沒有輸出 |

## 3. 手動驗證的共同準備

```powershell
Copy-Item .env.example .env        # 已有則略過；確認 TEACHER_PASSWORD 已設定
$env:NODE_ENV='development'; npm start
```

另開 PowerShell 視窗登入老師並保留（後面的開始、結束都用它）：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<TEACHER_PASSWORD>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher
```

學生識別碼：F12 → Application → Local Storage → `http://localhost:3000` 底下的 `studentId`（鍵名以實際看到的為準）。以學生身分用 PowerShell 提交的格式：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/student/submissions -ContentType 'application/json' -Body '{"studentId":"<該視窗的 studentId>","questionId":1,"answers":["H2O"]}'
```

development 種子：100 組、50 題；題 10、20、30、40、50 為 2 空格題組，其餘為單題。

## 4. 題號格與階段（G）

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| G1 | 瀏覽器 A 開 `http://localhost:3000/student/`，選第 1 組進場 | 只看到等待畫面，沒有題號格或題目內容 | 符合預期 |
| G2 | F12 Elements 搜尋作答區塊 | 存在且為 hidden | 符合預期 |
| G3 | 老師開始搶答 | 約 2 秒內出現 50 個題號，每個標示「未作答」 | 符合預期 |
| G4 | A 重新整理 | 直接回到題號格，不回選組 | 符合預期 |
| G5 | B 在搶答中首次進場第 1 組 | 直接看到題號格 | 符合預期 |
| G6 | PowerShell 以 A 的 studentId 提交題 1，再重新整理 A | 題 1 標示「已送出」 | 符合預期 |
| G7 | 老師結束活動 | A、B 顯示「活動已結束」，題號不可再操作 | 符合預期 |

## 5. 作答與送出（S）

重新開始一場（重啟 server、重新進場、老師重新登入並開始）。**先在 B 開著題 2 的作答頁並輸入 `bbb`，不要送出**。

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| S1 | A 點題 1；再點題 10 | 題 1 一個輸入框、有標籤；題 10 兩個輸入框，標示（1）（2） | 符合預期 |
| S2 | A 在題 1 輸入 `abc` 後返回 | 題號格題 1 標示「草稿」 | 符合預期 |
| S3 | A 重新整理後進題 1 | 輸入框恢復 `abc`，題號格仍為「草稿」 | 符合預期 |
| S4 | A 打開題 5，什麼都不輸入就返回 | 題號格題 5 仍為「未作答」，不是「草稿」 | 符合預期 |
| S5 | A 題 1 清空後送出 | 輸入框旁顯示原因；F12 Network 沒有 POST | 符合預期 |
| S6 | 在 PowerShell 執行 `'a' * 201 \| Set-Clipboard`，貼到題 1 送出 | 顯示超過 200 字元的原因，沒有 POST | 符合預期 |
| S7 | A 在題 10 只填第一格後送出 | 沒填的空格下顯示需填寫，沒有 POST | 符合預期 |
| S8 | A 題 1 輸入 `  H2O  ` 送出 | 顯示「已送出」與 `H2O`，輸入框鎖定；題號格為「已送出」；Local Storage 的 `draft:...:1` 消失；POST 內容為 `["H2O"]`，回應只有 `questionId`、`submittedAt` | 符合預期 |
| S9 | A 在題 2 輸入 `aaa` 送出；B 接著按題 2 的送出 | B 顯示「本組已由其他裝置送出」與 A 的 `aaa`(先送出者的答案)，B 輸入框鎖定 | 符合預期 |
| S10 | A 在題 3 輸入 `x`，F12 Network 改為 Offline 後按送出 | 顯示「伺服器沒有回應」，輸入保留，按鈕可再按 | 符合預期 |
| S11 | 取消 Offline，再按送出 | 送出成功，顯示「已送出」 | 符合預期 |
| S12 | A 在題 4 輸入 `late` 不送出；老師結束活動；按送出 | 顯示「活動已結束」；Local Storage 的 `draft:...:4` 仍在 | 符合預期 |

## 6. 同組同步與即時連線（N）

重新開始一場，A、B 選第 1 組，C 選第 2 組並開始搶答。

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| N1 | 看 A 進場前後 F12 Network 的 `events` 請求 | 進場前為 `events`，進場後為 `events?studentId=...`，同一時間只有一條 | 符合預期 |
| N2 | B 先開著題 1 的作答頁（不輸入）；A 在題 1 輸入 `H2O` 送出 | 2 秒內 B 題號格題 1 變「已送出」；B 作答頁輸入框鎖定並顯示 `H2O`，沒有送出按鈕 | 符合預期 |
| N3 | 同時看 C 的畫面與 F12 Network 的 events 內容 | C 沒有任何變化，EventStream 沒有 `submission` | 符合預期 |
| N4 | B 在題 2 輸入 `bbb`（不送出）；A 送出題 2 | B 的題 2 鎖定並顯示 A 的答案，草稿 `bbb` 被清除 | 符合預期 |
| N5 | A 的 DevTools 節流改為 Slow 3G，在題 3 輸入 fromA 並按送出；2 秒內用 PowerShell 以 B 的 studentId 提交題 3，答案為 fromB。結束後用 PowerShell 查詢：`Invoke-RestMethod "http://localhost:3000/api/student/submissions?studentId=<A 的 studentId>" \| ConvertTo-Json -Depth 5` | server 先收到的那一筆被記錄（Slow 3G 時通常是 fromB），只有一筆；後送的一方（A）顯示「本組已由其他裝置送出」並顯示被記錄的答案；A、B 的題 3 最後都是鎖定、顯示同一個答案，沒有錯誤畫面或空白 | 符合預期 |
| N6 | B 的 DevTools 切 Offline 約 10 秒，期間用 PowerShell 以 A 的 studentId 提交題 5，再取消 Offline | 幾秒內 B 出現題 5「已送出」 | 符合預期 |
| N7 | 停止 server 超過 40 秒 | A 顯示「重新連線中…」 | 符合預期 |
| N8 | 重新啟動 server（記憶體清空，進場紀錄消失） | A 約數秒內回到選組畫面並說明進場狀態已失效，沒有卡在連線中；Local Storage 的草稿仍在 | 符合預期 |
| N9 | 重新進場、老師重新登入並開始搶答，再打開有草稿的題 | 草稿恢復；A、B 同步行為恢復 | 符合預期 |
| N10 | 老師結束活動 | 所有視窗顯示「活動已結束」 | 符合預期 |

## 7. 隱私檢查（P）

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| P1 | 在 A 的 F12 Network 搜尋 `rank` | 所有 API 回應與事件都沒有 `rank` 欄位 | 符合預期 |
| P2 | 檢視 A、B、C 各階段的畫面 | 沒有順位、他組是否送出或題目是否被搶走的任何文字 | 符合預期 |

## 8. 老師控制台交叉確認（需 `add-teacher-monitoring` 已合併）(代測)

| 編號 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| T1 | 以老師身分開 `http://localhost:3000/teacher/`，學生 A 在題 1 送出 | 作答監看顯示題 1「已送出 1／M 組」、第 1 名為第 1 組與其答案 | |
| T2 | 同時看學生頁 | 學生頁沒有顯示名次 | |

## 9. 規格對照

| 規格 Requirement | 對應步驟 |
| --- | --- |
| Student page shows a question grid during the buzzer phase | G1、G3、G5、S1 |
| Student fills the blanks of one question | S1 |
| Student submits a validated answer | S5、S6、S7、S8 |
| A submitted question is locked and synchronized across the group | S8、S9、N2、N4、N5 |
| Drafts stay on the student's device | S2、S3、S4、S12 |
| The page never reveals other groups or ranks | P1、P2、N3 |
| The page recovers after refresh or reconnection | G4、G6、S10、S11、N6、N7、N8、N9 |
| The student connection carries the student identity | N1、N8 |
| Answering is closed when the activity ends | G7、S12、N10 |

## 10. 觀察與備註

| 項目 | 說明 |
| --- | --- |
| development 種子的題組提示（「第 N 題第一空」） | 來自 `server/index.js` 的假資料，不是畫面寫死的文字；匯入真實學習單時會顯示學習單上的提示 |
| 其他觀察 | |

## 11. 未測項目

- 真實手機與區網裝置（本次只用同一台電腦的多個瀏覽器）。
- 100 位學生同時在線時的畫面表現。
- 螢幕閱讀器與鍵盤操作。
- 結束後的結果頁（屬於 `add-student-results`）。
- N5（同時送出同一題）若未能完成，請在此註明。
- 第 8 節若 `add-teacher-monitoring` 尚未合併，請在此註明並待合併後補測。

## 12. 結論

| 項目 | 內容 |
| --- | --- |
| 自動測試 | 通過 |
| 手動驗證 | |
| 是否可歸檔 | |
