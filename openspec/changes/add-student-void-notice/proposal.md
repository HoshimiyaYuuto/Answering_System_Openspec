# Proposal

## Why

`add-submission-void` 讓老師在搶答中作廢作答，server 會送 `void` 事件給該組，本組作答狀態也多了 `voided` 欄位。但學生頁還不認得它們：

- 被作廢的題目在學生頁仍顯示「已送出」並鎖住，學生不知道要重送；
- 連線中斷後重新同步也解不開，因為合併快照時會保留本機已有的作答。

只有整頁重新整理才看得到題目被解開，而且頁面不會說明原因。共同契約 D24 要求「該組即可重新送出」，所以 Demo 前必須補上學生頁的處理。

對應 `docs/explore_summary.md`：
- 第 2 節 D5（已送出不能修改，只有老師作廢後能重送）、D24；
- 第 3 節模組表 `void-submission`；
- 第 4 節「隱私與推送」。

## What Changes

- 學生頁收到本組的 `void` 事件時：
  - 該題從「已送出」改為可作答，題號格以文字顯示「已作廢，可重新送出」；
  - 正在看該題時，作答頁立即解鎖，並說明作答已被老師作廢。
- 讀取本組作答狀態（進入作答、重新同步、送出被拒後重讀）時，依 `voided` 欄位得到同樣的結果。即使本機還記著舊的作答，被作廢的題目也會解鎖。
- 重送成功（本裝置送出成功，或收到同組其他裝置的 `submission` 事件）後，作廢提示消失，該題回到「已送出」。
- 作廢不顯示順位或任何他組資訊；被作廢的答案不會自動填回輸入框。

不在範圍：
- 老師端作廢操作與 server 行為：已由 `add-submission-void` 完成；
- 學生結果頁（結束後）顯示已作廢：D24 只要求老師監看顯示，結果頁已排除被作廢的作答；
- 公平順位相關的重判。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `student-answering-ui`：
  - 題號格的文字狀態新增「已作廢，可重新送出」；
  - 新增學生頁處理作廢通知與作廢快照的要求：解鎖、提示、重送後恢復、重新同步後仍正確。

## Impact

- **程式**：
  - `public/student/logic.js`：新增作廢狀態的純函式，題目狀態加入作廢；
  - `public/student/app.js`：處理 `void` 事件、快照中的 `voided`、重送成功後清除提示；
  - 需要時修改 `public/student/index.html` 的提示樣式。
- **API**：不新增端點，只讀取 `add-submission-void` 加入的 `void` 事件與 `voided` 欄位，不修改 `docs/api-contract.md`。
- **依賴**：依賴 `add-submission-void`（PR 審核中）。本分支從 `feat/submission-void` 開出，要等該 PR 合併進 `main` 後才能合併。
- **負責人**：學生端 change。學生端成員目前無法開發，由教師端成員代為完成。這個 change 從頭到尾只有一位負責人，所以符合「每個 change 只屬於一位負責人」的規則。
