# Proposal

## Why

活動結束後，老師要把每題搶答成功組別的答案放回原本的 Guided Notes。目前系統只能匯入，沒有任何匯出。依 Feature Contract D12（v0.6，助教 2026-11-17 說明），老師的學習單放在自己雲端的 Google Sheets，系統須直接寫回那份線上試算表；上傳 xlsx 匯入的情況沒有雲端目標，改為下載寫好答案的 xlsx。這是驗收 AC-000-08 與本組 AC-S-05 的前提，也是與 SpecKit 組（006）功能一致所缺的最大一塊。

## What Changes

- 新增「下載含答案的 xlsx」：老師在「已結束」階段可下載一份以原匯入檔為底、成功答案寫進各填空格的 xlsx。兩種匯入來源都可用，也作為寫回失敗時的備援。
- 新增「寫回 Google 試算表」：以連結匯入時，老師在「已結束」階段可把成功答案直接寫進原線上試算表。server 以服務帳號認證，只寫入答案儲存格的值，且一律寫成純文字。
- 寫回前 server 重新讀取線上試算表，用匯入時同一套表頭與題號規則重新定位。老師在匯入後插列時，答案仍寫到正確題目；題號或空格數對不上時拒絕寫入並說明原因（O6、AC-S-05）。
- 寫回失敗依原因回傳可行動的錯誤代碼與中文訊息（未設定服務帳號、沒有編輯權限、找不到試算表、不是原生試算表、Sheets API 未啟用、金鑰有誤、暫時無法連線等），並提示可改用下載 xlsx。
- 新增查詢寫回設定的端點，讓老師端顯示「要把試算表共用給哪個服務帳號信箱」。
- 填空格寫入規則：前綴與答案分離時答案寫右側獨立格；前綴位於合併填答區時寫「前綴＋答案」；單題寫原格；無人作答的題目不動。
- 修改匯入：以連結匯入時另外保存試算表 ID（只在 server 內部，不給學生）；前綴右側的答案格已有內容時，仍以該格為答案寫入位置並提出警告，避免寫回第二次時把答案寫到前綴格。
- 老師控制台新增「匯出結果」區塊：顯示寫回目標與服務帳號信箱，提供「寫回 Google 試算表」與「下載 xlsx」，並顯示寫入格數或失敗原因。
- `.env.example` 新增 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`：只寫金鑰檔在 repo 外的路徑，金鑰內容不進 repo。

不在本 change 範圍：

- CSV 匯出（D13）另開 change。
- 公平順位（D14）、作廢（D24）、老師改選（O3）的規則與操作。勝者一律讀 `computeResults()` 的 `winner`（`add-results-computation`）；第一版只有先到先得與作廢過濾，之後公平順位、老師改選加入時，匯出不需要修改。

對應 `docs/explore_summary.md`：第 2 節（資料進出）、第 3 節 D11、D12、第 4 節 O6、第 5 節 `export-guided-notes`、第 8 節（對外連線 Google、不寫死儲存格）、第 9 節 AC-000-08、AC-S-05、第 10 節 Q6。

## Capabilities

### New Capabilities

- `guided-notes-export`：把各題成功答案寫回 Guided Notes，包括下載含答案的 xlsx、以服務帳號寫回線上 Google 試算表、寫回前重新定位與比對、錯誤回報，以及老師控制台的匯出區塊。

### Modified Capabilities

- `guided-notes-import`：「Blank positions are kept for export and hidden from students」改為也保存連結匯入的試算表 ID，並調整前綴右側已有內容時的答案寫入位置。

## Impact

- 程式：新增 `server/guided-notes-export.js`（填空格內容、xlsx 產生、重新定位與比對）、`server/google-sheets.js`（服務帳號 token 與 `values.batchUpdate`）、`public/teacher/export-logic.js`。修改 `server/guided-notes-import.js`、`server/index.js`、`public/teacher/index.html`、`public/teacher/app.js`。
- API：新增 `GET /api/teacher/guided-notes/export`、`POST /api/teacher/guided-notes/writeback`、`GET /api/teacher/guided-notes/writeback`。須同步更新 `docs/api-contract.md`。
- 相依套件：不新增。xlsx 沿用 `exceljs`，Google 認證以 `node:crypto` 自行簽 JWT，HTTP 用內建 `fetch`。
- 外部系統：server 需能連線 `oauth2.googleapis.com`、`sheets.googleapis.com` 與 `docs.google.com`。需要一組 Google Cloud 服務帳號（由教師端成員建立，金鑰放在 repo 外）。
- 依賴的其他 change：學生端成員的 `add-buzz-in-submission`（PR #8）提供作答紀錄 `submissions.listSubmissions()`；教師端成員的 `add-results-computation`（PR #9）提供判定結果 `computeResults()`。兩個 PR 都合併到 main 後才 apply 本 change。
- 文件：`README.md`（服務帳號設定與共用步驟）、`.env.example`、`docs/verification/add-guided-notes-export.md`。
