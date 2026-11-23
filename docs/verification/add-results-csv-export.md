# add-results-csv-export 驗證紀錄

## 1. 驗證環境

| 欄位 | 填寫 |
| --- | --- |
| 作業系統 | Windows 11 家用版 |
| Node.js 版本 | v24.22.0 |
| PowerShell 版本 | 5.1.26100 |
| 瀏覽器 | Claude 桌面版內建瀏覽器 |
| 時區 | Asia/Taipei（UTC+8） |
| 日期 | 2026/11/24 |

分支 `feat/results-csv-export`，建立在 `feat/guided-notes-export`（PR #16）之上並併入 `docs/submission-record.md` v0.4。server 以 `NODE_ENV=production`、測試用密碼 `test-password`（環境變數，非 `.env` 的真實密碼）啟動於 port 3000。

## 2. 自動測試（tasks 4.1）

| 指令 | 結果 | 數字 |
| --- | --- | --- |
| `npm test` | 通過 | `tests 247`、`pass 247`、`fail 0`、`duration_ms 17176` |
| `npm run check:capacity` | 通過 | SSE：clients 100、maxLatencyMs 11；提交：5000 筆、totalMs 1339、slowestQuestionMs 72 |
| `openspec validate add-results-csv-export --strict` | 通過 | |
| `git grep -nE "BEGIN [P]RIVATE KEY"` | 沒有結果 | |

本 change 新增或修改的測試：`server/results-csv.test.js`（10 項，含 100 組 × 50 題 × 2 空格共 10,000 列在 500 毫秒內產生，實測約 30 毫秒）、`server/results-csv-api.test.js`（4 項）、`public/teacher/export-logic.test.js`（+4 項）。時間相關測試一律傳入 `Asia/Taipei` 或 `UTC`，不依賴執行機器的時區。

## 3. 契約範例（tasks 2.1、2.2）

依 `docs/api-contract.md`「結果 csv 匯出」的 PowerShell 範例，在第 4 節的活動結束後執行：

| 操作 | 預期 | 結果 |
| --- | --- | --- |
| `Invoke-WebRequest .../api/teacher/results/csv -WebSession $teacher -OutFile results.csv` | `200`、`text/csv; charset=utf-8`，檔案以 `EF BB BF` 開頭，6 列資料加表頭 | 符合：前 3 個位元組為 `239,187,191`，以 CRLF 切開為 7 段（表頭、5 列資料、最後一列後的空字串） |
| `git grep -n "override" docs/api-contract.md` | 沒有結果 | 符合 |

未結束時的 `409 EXPORT_NOT_ALLOWED` 由 `results-csv-api.test.js` 涵蓋，也在第 4 節步驟 1～2 的按鈕停用中確認。

## 4. 控制台手動驗證（tasks 3.2）

組別與匯入以 API 完成（2 組、上傳 `02-official-group.xlsx`，上傳時檔名為 `02.xlsx`；瀏覽器的檔案選擇視窗無法自動操作）。兩個學生「裝置」以不同來源開啟學生頁，各自有獨立的 `localStorage`：第 1 組 `http://localhost:3000/student/`，第 2 組 `http://127.0.0.1:3000/student/`。

| 步驟 | 操作 | 預期 | 結果 |
| --- | --- | --- | --- |
| 1 | 老師在 `http://localhost:3000/teacher/` 登入 | 「下載 CSV」停用，說明「活動結束後才能匯出。」 | 符合 |
| 2 | 兩個學生頁分別選第 1、2 組進場，老師開始搶答 | 按鈕仍停用 | 符合 |
| 3 | 第 1 組在學生頁送出第 1 題「甲」「乙」；第 2 組送出第 1 題「=1+1」「丙,丁」；第 1 組送出第 3 題「0」 | 送出成功 | 符合 |
| 4 | 老師結束搶答並按「下載 CSV」 | 按鈕可用；下載檔名為「<匯入檔名>（搶答結果）.csv」並顯示「已下載 CSV。」；第 1 題 4 列、第 3 題 1 列，順位與老師監看一致，`=1+1` 為文字，「丙,丁」在同一格 | 符合，見下方內容；檔名為「02（搶答結果）.csv」（匯入時檔名為 `02.xlsx`）。老師監看第 1 題：第 1 名第 1 組「甲／乙」、第 2 名第 2 組「=1+1／丙,丁」，與 csv 的順位與是否搶答成功一致 |
| 5 | 在 `http://192.168.56.1:3000/teacher/`（本機另一張網卡的位址，當時沒有 Wi-Fi 位址）另開老師頁登入 | 「下載 CSV」同樣可用 | 符合 |
| 6 | 重新啟動 server | 老師頁回到登入畫面；重新登入後匯出區塊沒有殘留訊息、按鈕停用（階段回到準備中） | 符合 |

步驟 4 下載的內容（為了不在測試機器存檔，以攔截下載連結的方式讀回；`\r\n` 為 CRLF）：

```text
<BOM>題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位\r\n
1,1,第 1 組,甲,1,是,2026-11-24 06:01:40,否\r\n
1,2,第 1 組,乙,1,是,2026-11-24 06:01:40,否\r\n
1,1,第 2 組,'=1+1,2,否,2026-11-24 06:01:52,否\r\n
1,2,第 2 組,"丙,丁",2,否,2026-11-24 06:01:52,否\r\n
3,1,第 1 組,0,1,是,2026-11-24 06:02:04,否\r\n
```

送出時間為台北本地時間（UTC+8），沒有 `Z` 或時區後綴。

順帶觀察：第 1 組學生頁進入搶答後，第 1 題顯示「草稿」並帶出上一場活動同一題的答案。這是學生端草稿沒有區分活動造成的（PR #13 review 已提出，學生端成員排在 `add-student-results` 修正），與本 change 無關；本次手動改成新答案後送出。

## 5. 未測項目

- 以 Excel、Google 試算表實際開啟：本次以位元組與文字確認 BOM、CRLF、引號與公式前綴；Excel 中單引號前綴不顯示、Google 試算表會顯示單引號，錄 demo 時再以 Excel 開啟確認。
- 作廢與公平順位：兩者尚未實作。作廢的作答不出現、名次遞補，以及公平順位欄的 `是`／`是（改判）`，只在 `results-csv.test.js` 以手寫資料測試。
- 與 SpecKit 組逐字比對：送出時間格式（本組 `YYYY-MM-DD HH:mm:ss`）與「順位」欄在作廢或公平順位時的語意（本組為 `place`）尚待確認。
- 以連結匯入的場次：由 `results-csv-api.test.js` 以假下載涵蓋，未以真實試算表手動操作（csv 與學習單來源無關）。
