# Proposal

## Why

SpecKit 組的 007（介面語言切換）涵蓋學生端、老師端與投影看板三個畫面。`add-student-language-switch` 已規劃學生頁與共用語言核心，本 change 補上教師控制台與投影看板，讓兩組功能一致。

教師端與學生端有兩個關鍵差異，所以要另外設計：

- **控制台不能用重新載入切換**：重新載入會讓尚未確認的匯入預覽、正在編輯的組別、倒數設定都消失。
- **投影看板也不能重新載入**：揭曉進度只存在頁面上（`add-projector-board` 的設計），重新載入會回到全部未揭曉。

此外，SpecKit 的 AC-007-07 要求英文版的匯入警告也是英文。本組的匯入警告目前是 server 組好的中文句子，前端無法翻譯。

對應 `docs/explore_summary.md`：第 4 節（本組補充）、第 5 節模組表 `teacher-console`、`projection-board`。

## What Changes

**教師控制台與投影看板的語言切換**
- 兩個畫面右上角都有「中文／EN」切換器，規則與學生頁相同：
  - 預設依瀏覽器語言；
  - 選擇記在瀏覽器，同一個瀏覽器的其他分頁跟著改，包含學生頁；
  - `<html lang>` 與分頁標題跟著改。
- 切換後**不重新載入**，就在原頁面重畫。以下狀態都會保留：
  - 匯入預覽、組別編輯中的內容、倒數設定、公平順位勾選；
  - 結束確認或重設確認的對話框；
  - 看板的揭曉進度。
- 翻譯的範圍：
  - 控制台：登入、活動狀態、開始／結束／重設、倒數與公平順位設定、組別設定、學習單匯入（摘要表格、題型、警告）、作答監看與搶答結果（含作廢按鈕與確認）、匯出（寫回、下載 xlsx／CSV）。
  - 看板：階段、倒數、在線狀態、搶答結果與揭曉按鈕。
- 伺服器錯誤依錯誤代碼顯示英文，涵蓋教師端會遇到的代碼：登入、組別、匯入、匯出與寫回、作廢、階段控制。沒有對應的代碼顯示原文。
- 組名、題目、答案、學習單名稱與工作表名稱不翻譯。

**匯入警告改成可翻譯**
- 匯入預覽與目前學習單的回應新增 `warningDetails`，每筆包含 `code`、`questionId`、`blankIndex`、`cell`。
- 原本的 `warnings` 中文字串完全不變，只新增欄位，不影響既有用戶端。
- 英文版依 `warningDetails` 組成英文警告；繁中版維持顯示 `warnings` 原文。

**不在範圍**
- 學生頁與共用核心：由 `add-student-language-switch` 負責，本 change 依賴它。
- CSV 欄名、匯出的 xlsx 內容、伺服器錯誤原文：維持繁中，與 SpecKit 一致。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `interface-language`：新增教師控制台與投影看板的語言切換，包括原地重畫並保留畫面狀態、匯入警告的翻譯。這個 capability 由 `add-student-language-switch` 新增；本 change 只用 ADDED，不修改它的 requirement。
- `guided-notes-import`：匯入預覽與目前學習單的回應新增結構化警告 `warningDetails`。

## Impact

- **前端**：
  - `public/teacher/index.html`、`app.js`；
  - `console-logic.js`、`import-logic.js`、`export-logic.js`、`monitor-logic.js`：產生文字的函式改為可傳入翻譯函式，預設為繁中，既有測試的斷言不變；
  - `board.html`、`board.js`、`board-logic.js`；
  - 新增 `public/teacher/messages.js` 與它的測試。
- **server**：`server/guided-notes-import.js` 新增 `warningDetails`。
- **文件**：
  - `docs/api-contract.md`：匯入回應新增 `warningDetails`；
  - `docs/explore_summary.md`：第 4 節的介面語言項目標示教師端完成。
- **依賴**：需要 `add-student-language-switch` 的 `public/shared/i18n.js`，本分支從學生端分支開出，需在它合併後再合併。
