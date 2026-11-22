# add-guided-notes-export 驗證紀錄

不記錄試算表 ID、金鑰路徑以外的金鑰資訊或答案以外的個資。

## 1. 驗證環境

| 欄位 | 填寫 |
| --- | --- |
| 作業系統 | Windows 11 家用版 |
| Node.js 版本 | v24.22.0 |
| PowerShell 版本 | 5.1.26100 |
| 瀏覽器 | Claude 桌面版內建瀏覽器 |
| 日期 | 2026/11/22 |

server 以 `NODE_ENV=production`、測試用密碼 `test-password`（環境變數，非 `.env` 的真實密碼）啟動於 port 3000；task 4.3 時未設定服務帳號。

## 2. 自動測試（tasks 6.1）

| 指令 | 結果 | 數字 |
| --- | --- | --- |
| `npm test` | 通過 | `tests 187`、`pass 187`、`fail 0`、`duration_ms 16546` |
| `npm run check:capacity` | 通過 | SSE：clients 100、maxLatencyMs 7；提交：5000 筆、totalMs 1082、slowestQuestionMs 62 |
| `openspec validate add-guided-notes-export --strict` | 通過 | |
| `git grep -nE "BEGIN [P]RIVATE KEY"` | 沒有結果 | |

本 change 新增或修改的測試：`server/guided-notes-import.test.js`（+2）、`server/guided-notes-api.test.js`（+2）、`server/guided-notes-export.test.js`（12）、`server/google-sheets.test.js`（19，金鑰於測試中即時產生）、`server/guided-notes-export-api.test.js`（4）、`server/guided-notes-writeback-api.test.js`（9）、`public/teacher/export-logic.test.js`（9）。所有 Google 呼叫（token、寫入、重新讀取）都以注入的假 `fetch`／假 client／假 `downloadGuidedNotesImpl` 取代，測試不連網路。

## 3. 下載 xlsx 與契約範例（tasks 2.2、3.4）

依 `docs/api-contract.md` 的 PowerShell 範例操作：老師登入、設定 1 組、上傳 `01-official-single.xlsx`、學生進場、開始、第 1 組送出「光合作用」、結束。中文答案以 UTF-8 位元組送出（PowerShell 5.1 的字串 body 不是 UTF-8）。

| 操作 | 預期 | 結果 |
| --- | --- | --- |
| `GET /api/teacher/guided-notes/writeback` | `configured: false`、`serviceAccountEmail: null`、`target: "file"` | 符合 |
| `POST /api/teacher/guided-notes/writeback` | 上傳來源先於設定檢查，回 `409 GUIDED_NOTES_NOT_LINK` | 符合 |
| `Invoke-WebRequest .../export -OutFile answers.xlsx` | G5 為「光合作用」 | 符合 |

未設定金鑰且以連結匯入時的 `503 SHEET_NOT_CONFIGURED` 需要一份公開的 Google 試算表連結，手動操作留待 5.2；由 `guided-notes-writeback-api.test.js` 以假下載涵蓋。

## 4. 控制台匯出區塊（tasks 4.3）

學生作答畫面（`add-student-answering-ui`）尚未完成，學生進場以 API、送出以 Node `fetch` 代替；匯入以 API 上傳 `01-official-single.xlsx`（瀏覽器的檔案選擇視窗無法自動操作）。

| 步驟 | 預期 | 結果 |
| --- | --- | --- |
| 1. 登入，已上傳 `01` | 匯出區塊「活動結束後才能匯出。」，兩個按鈕停用 | 符合 |
| 2. 第 1、2 組進場 | 進場成功 | 符合 |
| 3. 開始搶答（未結束） | 仍顯示「活動結束後才能匯出。」 | 符合 |
| 3. 結束後 | 只有「下載 xlsx」可用，說明「這份學習單是上傳的 xlsx，沒有線上試算表可寫回，只能下載 xlsx。」 | 符合 |
| 4. 第 1 組送出第 1 題後結束，按「下載 xlsx」 | 觸發下載，檔名「01-official-single（搶答結果）.xlsx」，顯示「已下載含答案的 xlsx。」；同一份匯出的 G5 為「光合作用」 | 符合（為了不在測試機器存檔，瀏覽器中以攔截下載連結確認檔名；內容另以 server 匯出讀回 G5 確認） |
| 5. `http://192.168.0.156:3000/teacher/` 另開老師頁登入 | 畫面與 localhost 相同 | 符合 |
| 6. 重新啟動 server | 老師頁回到登入畫面；重新登入後匯出區塊回到初始狀態，沒有先前的訊息 | 符合 |

## 5. 真實 Google 試算表（tasks 5.1、5.2）

待完成：需要教師端成員在 `.env` 設定 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`，並準備已「儲存為 Google 試算表」、設為「知道連結者可檢視」且共用給服務帳號為編輯者的 `02`、`04` 學習單。

| 步驟 | 結果 |
| --- | --- |
| 5.1 依 README 設定後 `configured: true` 且顯示服務帳號信箱 | 待驗證 |
| 5.2-1 以連結匯入 `02`，寫回後 H5、H6 有答案，G5、G6 不變，畫面顯示寫入 2 格 | 待驗證 |
| 5.2-2 再寫回一次，答案仍在 H5、H6 | 待驗證 |
| 5.2-3 以 `04` 重做，G7 等格為「（1）甲」形式 | 待驗證 |
| 5.2-4 匯入後在第 3 列上方插入一列再寫回，畫面顯示已重新對位（AC-S-05） | 待驗證 |
| 5.2-5 改掉題號後寫回，顯示 `SHEET_MODIFIED` 原因且未寫入 | 待驗證 |
| 5.2-6 取消共用服務帳號後寫回，顯示沒有編輯權限與服務帳號信箱 | 待驗證 |
| 5.2-7 未轉成 Google 試算表的 xlsx 以連結匯入後寫回 | 待驗證 |
| 5.2-8 寫入「=1+1」，線上顯示文字 | 待驗證 |

## 6. 未測項目

- 以學生頁實際送出：待 `add-student-answering-ui` 完成後重跑第 4 節步驟 2～4。
- 真實 Google 環境下的所有錯誤分類：依 Google 文件與 SpecKit 006 的經驗以假回應測試，實際錯誤字串若有不同，會落到 `SHEET_UNAVAILABLE`，畫面仍提示改用下載 xlsx。
