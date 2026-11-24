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

日期 2026/11/24。分支 `feat/guided-notes-export` 已合併最新 main（PR #10～#14，`7ca51f1`），環境同第 1 節。教師端成員依 README 建立服務帳號，在 `.env` 寫入 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`（金鑰檔放在 repository 外，金鑰內容未經手驗證者）；server 以 `NODE_ENV=production`、`TEACHER_PASSWORD=test-password` 環境變數啟動，`.env` 只提供金鑰路徑。

`02`、`04` 由教師端成員上傳到 Google 雲端硬碟並「儲存為 Google 試算表」，設為「知道連結者可檢視」並共用給服務帳號為編輯者。組別、匯入（以連結）、學生進場與送出以 Node `fetch` 呼叫 API；寫回一律在老師頁按「寫回 Google 試算表」，畫面文字取自 `#export-message`。線上試算表的內容以公開連結匯出 xlsx 後用 exceljs 讀回確認。

| 步驟 | 操作 | 結果 |
| --- | --- | --- |
| 5.1 | 依 README 設定後啟動，`GET /api/teacher/guided-notes/writeback` | 符合：`configured: true`、顯示服務帳號信箱；老師頁匯出區塊提示「寫回前請把線上試算表共用給 <服務帳號信箱> 並設為『編輯者』」 |
| 5.2-1 | 以連結匯入 `02`（4 題、6 格），2 組進場；第 1 組送出第 1 題「CPU」「作業系統」、第 3 題「0」、第 4 題「=1+1」，第 2 組後送第 1 題；結束後寫回 | 符合：顯示「已寫回 4 格到線上試算表。」；H5「CPU」、H6「作業系統」、G11「0」、G13「=1+1」，G5「（1）」、G6「（2）」不變。寫入 4 格而非 tasks 寫的 2 格，是因為把步驟 8 併在同一場送出 |
| 5.2-2 | 再按一次寫回 | 符合：仍為 4 格，H5、H6、G11、G13 內容不變 |
| 5.2-3 | 重啟 server，以連結匯入 `04`（7 題、11 格）；第 1 組送出第 1 題「光合作用」、第 2 題「甲」「乙」「丙」，第 2 組後送第 2 題；結束後寫回 | 符合：顯示寫回 4 格；G5「光合作用」，G7「（1）甲」、G8「（2）乙」、G9「（3）丙」 |
| 5.2-4 | 回到 `02` 的場次，教師端成員在線上試算表第 3 列上方插入一列後寫回 | 符合：顯示「已寫回 4 格到線上試算表。線上試算表的版面在匯入後有變動，已依題號重新對位。」；答案在 H6、H7、G12、G14，前綴 G6、G7 不變（AC-S-05） |
| 5.2-5 | 把第 3 題題號改成 9，並清空 H6 後寫回 | 符合：顯示「線上試算表的題目與匯入時不同：線上試算表找不到第 3 題。請重新匯入學習單後再寫回，或改用下載 xlsx。」；H6 仍為空白，未寫入 |
| 5.2-6 | 題號改回 3，取消共用服務帳號（公開檢視保留）後寫回 | 符合：顯示「服務帳號沒有這份試算表的編輯權限，請把試算表共用給 <服務帳號信箱> 並設為『編輯者』。也可以改用『下載 xlsx』。」；H6 仍為空白 |
| 5.2-7 | 另上傳未轉換的 `02` xlsx（公開檢視並共用給服務帳號），重啟 server 後以連結匯入、送出一題、結束後寫回 | 符合：連結可以匯入（4 題、6 格）；寫回顯示「這份檔案在雲端上仍是 xlsx，無法直接寫回。請在 Google 雲端硬碟中『儲存為 Google 試算表』後重新匯入。也可以改用『下載 xlsx』。」 |
| 5.2-8 | 與 5.2-1 同一場，第 4 題答案「=1+1」 | 符合：讀回 G13 為字串「=1+1」，不是公式 |

server log 在這段期間只有以下格式的紀錄，不含答案、試算表 ID 或金鑰：`Google 試算表寫回成功：寫入 4 格`、`寫入 4 格（已重新對位）`、`寫回失敗：SHEET_MODIFIED`、`SHEET_NOT_EDITABLE`、`SHEET_NOT_NATIVE`。

### 5.3 review 後補充（PR #16）

日期 2026/11/24，分支已含 PR #10～#14 的 main（`#15` 只有文件與歸檔）。

| 項目 | 結果 |
| --- | --- |
| `npm test` | 通過：`tests 230`、`pass 230`、`fail 0`（含本次新增的 GET 寫回設定未登入測試） |
| `GET /api/teacher/guided-notes/writeback` 未登入 | `401 TEACHER_AUTH_REQUIRED`；登入後只回 `configured`、`serviceAccountEmail`、`target`，不含金鑰檔路徑（`guided-notes-writeback-api.test.js`） |
| 老師頁登入（活動已結束、已上傳 `01`、第 1 組送出 1 題） | 監看顯示 6 題，匯出區塊「下載 xlsx」可用；下載後顯示「已下載含答案的 xlsx。」 |
| 按「登出」 | 回到登入畫面；監看清單清空、匯出區塊回到「活動結束後才能匯出。」且按鈕停用，下載訊息清除 |
| 重新登入 | 監看重新讀取 6 題、匯出區塊重新讀取設定，按鈕可用，沒有上一次的下載訊息 |

## 6. 未測項目

- 以學生頁實際送出：待 `add-student-answering-ui` 完成後重跑第 4 節步驟 2～4。
- 真實 Google 環境下的其他錯誤分類：`SHEET_MODIFIED`、`SHEET_NOT_EDITABLE`、`SHEET_NOT_NATIVE` 已在第 5 節以真實試算表確認；`SHEET_AUTH_FAILED`、`SHEET_API_DISABLED`、`SHEET_NOT_FOUND`、`SHEET_TAB_NOT_FOUND`、`SHEET_UNAVAILABLE` 只以假回應測試，實際錯誤字串若有不同會落到 `SHEET_UNAVAILABLE`，畫面仍提示改用下載 xlsx。
- 以連結匯入時的「下載 xlsx」：第 5 節只操作寫回；下載以上傳來源在第 3、4 節驗證，兩種來源共用同一個匯出函式。
