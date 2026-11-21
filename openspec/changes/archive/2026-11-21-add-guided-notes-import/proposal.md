# Proposal: add-guided-notes-import

## Why

目前系統沒有任何正式的題目來源：`session.questions` 只有在 `NODE_ENV=development` 時才會放入 50 題假題目，一般模式下題數永遠是 0。課程核心需求要求老師匯入 Guided Notes，且題數要與學習單一致；之後的搶答送出、監看與匯出寫回都建立在「已匯入的題目」上，所以匯入必須先完成。

助教會用另一份 Guided Notes 測試，因此匯入不能寫死儲存格位置，必須依表頭與合併範圍辨識題目與空格。

對應 `docs/explore_summary.md`：第 2 節（資料進出由教師端負責）、第 3 節 D10（題組算一題）、D11（匯入方式與動態辨識）、D22（題目敘述）、第 5 節 `guided-notes-import` 與 `question-groups` 的匯入部分、第 8 節（不得寫死儲存格位置）、第 9 節 AC-000-01～03、第 10 節 Q4（測試用學習單）。

## What Changes

- 老師可用兩種方式提供 Guided Notes：上傳 xlsx 檔，或貼上「知道連結者可檢視」的 Google 試算表連結。
- server 依「題號／題目／作答」表頭列定位題目區，可位於任一工作表、任一列、任一欄；題號欄的每個數字題號為一題。
- 題號儲存格垂直合併時辨識為題組：合併範圍內每一列是一個空格，並保留「（1）」等前綴。
- 每個空格記錄兩個位置：作答區在該列的起始格，以及之後匯出時答案要寫入的格子。這些位置只存在 server，不提供給學生。
- 匯入分兩步：先回傳摘要（工作表、題數、空格數、每題類型與空格數、提醒事項）讓老師核對，老師確認後題目才生效並取代舊題目；取消或失敗時原有題目不變。
- 匯入只限老師在「準備中」操作；在老師密碼功能完成前，沿用現有的 loopback 限制。
- 找不到表頭、沒有題目、題號重複、檔案無法讀取、檔案過大、連結無效或無法存取時，拒絕匯入並說明原因與位置。
- 現有的 `/teacher/` 臨時頁加入「匯入學習單」區塊。
- 新增 `exceljs` 套件以讀取 xlsx（含合併範圍），之後匯出寫回也沿用同一套件。
- 更新 `docs/api-contract.md`，加入匯入相關端點與錯誤代碼。

不在範圍：

- 匯出寫回 Guided Notes 與 CSV（`add-export-guided-notes`、`csv-export`）。
- 老師密碼登入與正式教師端畫面。
- 學生端讀取題目與作答畫面（`add-buzz-in-submission`、`student-ui`）。
- 「沒有題目時不能開始搶答」的檢查：屬於階段控制，待與學生端成員確認後另行處理。
- 直接修改雲端上的 Google 試算表。

## Capabilities

### New Capabilities

- `guided-notes-import`：老師提供 Guided Notes 後，server 動態辨識題目、題組與空格，經老師確認後成為活動題目；包含來源（上傳與連結）、辨識規則、確認流程、權限與錯誤處理。

### Modified Capabilities

- `groups-and-entry`：「Temporary teacher page only configures groups」原本規定臨時教師頁只能設定組別、不提供題目功能；改為臨時教師頁可設定組別並匯入 Guided Notes，仍不提供作答、送出與正式教師控制功能。

## Impact

- **負責人**：教師端成員。
- **程式**：新增 `server/guided-notes-import.js`（解析與匯入狀態）及其測試；修改 `server/index.js`（新增匯入路由）、`public/teacher/index.html` 與 `public/teacher/app.js`（匯入區塊）。
- **API**：新增 `/api/teacher/guided-notes` 系列端點；`GET /api/session` 的 `questionCount` 改為反映匯入結果。
- **相依套件**：新增 `exceljs`（MIT 授權）。
- **測試資料**：使用 `fixtures/guided-notes/` 的 8 份學習單與 `expected.json`。
- **依賴其他 change**：
  - `add-buzz-in-submission`（學生端成員）：本 change 寫入 `session.questions` 的題目格式需與其一致，格式提案見 design.md，待學生端成員確認。
  - `add-export-guided-notes`（教師端成員，之後）：依賴本 change 保存的原始檔與空格位置。
