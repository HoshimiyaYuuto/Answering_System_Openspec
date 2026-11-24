# Proposal: add-results-csv-export

## Why

活動結束後，老師目前只能把每題的成功答案寫回 Guided Notes，看不到「每一組在每一題送了什麼、排第幾」的完整紀錄。課程規定的 D13 要求可以匯出 8 欄的 csv，供老師留存、評分或之後在試算表中整理；驗收 AC-000-09 也要求 csv 與老師端看到的順位一致。這是教師端在核心功能之外最後一項 P1 匯出功能，且 SpecKit 組的 004 已實作，兩組須一致。

## What Changes

- 新增老師端點 `GET /api/teacher/results/csv`：活動「已結束」後下載整場的作答紀錄 csv；未結束回 `409 EXPORT_NOT_ALLOWED`，未登入回 `401 TEACHER_AUTH_REQUIRED`。
- csv 內容依 `docs/submission-record.md` v0.4 第 3 節「CSV 對應」：
  - 每筆**有效**作答 × 每個空格一列，依題號、名次（`place`）、空格序排序；表頭固定為 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位`。
  - 名次、勝者與公平順位一律取自 `computeResults()`，與老師監看、結果、xlsx 匯出與寫回使用同一份判定結果。
  - 組別輸出組名；送出時間以 server 本地時間輸出，不帶 `Z` 或時區後綴。
  - UTF-8 含 BOM、CRLF 換行；欄位依 RFC 4180 加引號；以 `=`、`+`、`-`、`@` 開頭的值前面加單引號。
- 老師控制台的「匯出結果」區塊新增「下載 CSV」按鈕，活動結束後可用，與學習單來源（上傳或連結）無關。
- `docs/api-contract.md` 新增 csv 匯出章節，並把老師監看章節 `winnerSource` 的可能值中已不採用的 `override` 移除（O3 已確定不做，與 `docs/submission-record.md` v0.4 一致）。
- 對應 `docs/explore_summary.md`：第 3 節 D13、第 5 節能力表的 `csv-export`、第 9 節 AC-000-09；格式細節依 `docs/submission-record.md` v0.4 第 3 節。

## Capabilities

### New Capabilities

- `results-csv-export`：活動結束後由老師下載的整場作答紀錄 csv，包含欄位、排序、編碼、公式防護與控制台的下載操作。

### Modified Capabilities

無。老師控制台只是在既有的「匯出結果」區塊多一個按鈕，按鈕行為由本 change 的新能力描述；`guided-notes-export` 與 `teacher-monitoring` 的需求不變（契約文件中 `override` 的移除只是文件與既有決定對齊，沒有改變任何程式行為）。

## Impact

- **負責人**：教師端成員。
- **程式**：新增 `server/results-csv.js`（純函式，把判定結果與作答紀錄轉成 csv 字串）與測試；修改 `server/index.js`（新端點）、`public/teacher/export-logic.js`（下載 CSV 的狀態與文字）、`public/teacher/app.js`、`public/teacher/index.html`。
- **文件**：`docs/api-contract.md`。
- **依賴**：
  - `add-results-computation`（已合併）的 `computeResults()`。
  - `add-guided-notes-export`（PR #16，未合併）的「匯出結果」區塊、`EXPORT_NOT_ALLOWED` 與下載流程；本 change 的分支建立在它之上，須等它合併後再合併。
  - `docs/submission-record.md` v0.4（分支 `docs/submission-record-o3`，已併入本 change 的分支）。
- **不在範圍**：作廢與公平順位本身（目前沒有作廢，`公平順位` 欄恆為 `否`，啟用後的 `是`／`是（改判）` 由公平順位 change 補上測試）、學生端、xlsx 匯出與寫回的行為。
