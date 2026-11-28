# Proposal

## Why

SpecKit 組已經完成「介面語言切換（繁體中文／English）」，見他們的 `specs/007-i18n/spec.md`。學生端、老師端、投影看板都能切換。課程規定兩組功能要一致，本組目前只有繁體中文，所以要補做。

SpecKit 的 007 明確寫了「不動共用契約」：D1～D25 都不涉及介面語言，伺服器維持回繁體中文。因此本 change 也不改 API、事件與共用契約，只改畫面。

依 AGENTS 規則，學生端與教師端拆成兩個 change：
- 本 change：學生頁，以及三個畫面共用的語言核心；
- `add-teacher-language-switch`：教師控制台與投影看板。

對應 `docs/explore_summary.md`：第 4 節（本組補充）、第 6 節學生端需求。

## What Changes

**可觀察行為**（對齊 SpecKit 007 的 FR-001～FR-009）
- 學生頁右上角有語言切換器，兩個按鈕「中文」「EN」，目前的語言標示為按下狀態。
- **預設語言**：
  - 沒有選過時依瀏覽器語言清單，第一個 `en*` 用英文，第一個 `zh*` 用繁體中文；
  - 其他語言一律用繁體中文。
- **記憶與同步**：
  - 選擇記在瀏覽器（localStorage），重新整理後保留；
  - 同一個瀏覽器的其他分頁也跟著換。
- 切換後整頁文字都換成該語言，包含：標題、按鈕、階段名稱、題號格狀態、提示與錯誤訊息、結果頁、公平順位說明、倒數。
- `<html lang>` 與分頁標題跟著語言改變（英文 `en`、繁中 `zh-TW`），螢幕閱讀器的標籤也會換。
- **伺服器錯誤訊息**：英文版依錯誤代碼在前端顯示英文；沒有對應的代碼就顯示伺服器原文。
- **不翻譯的內容**：組名、題目、空格提示、答案。這些是老師與學生輸入的資料，不是介面。
- 切換語言不改變任何行為：作答、草稿、送出、結果、重連都照舊。

**共用語言核心**
- 新增 `public/shared/i18n.js`，包含：
  - 語言判定、記憶、跨分頁同步；
  - 文字插值、`<html lang>` 更新；
  - 切換器元件。
- server 新增 `/shared` 靜態路徑提供這個檔案。這是本 change 唯一的 server 改動，不涉及 API。

**不在範圍**
- 教師控制台、投影看板：由 `add-teacher-language-switch` 負責。
- 伺服器回應的多語言、CSV 欄名、匯出內容：維持繁體中文，與 SpecKit 一致。

## Capabilities

### New Capabilities

- `interface-language`：介面語言的選擇、預設判定、記憶與跨分頁同步、頁面語言標示、錯誤訊息翻譯，以及「資料不翻譯、行為不變」的約束。本 change 先套用到學生頁，教師端 change 會在同一個 capability 補上控制台與看板。

### Modified Capabilities

（無。學生頁既有 requirement 的行為不變，只是文字可以換成英文。）

## Impact

- **新增**：
  - `public/shared/i18n.js` 與 `public/shared/i18n.test.js`；
  - `public/student/messages.js` 與它的測試。
- **修改**：
  - `public/student/logic.js`：產生文字的函式改為可傳入翻譯函式，預設仍是繁中，既有測試不需改斷言；
  - `public/student/app.js`、`public/student/index.html`；
  - `server/index.js`：新增 `/shared` 靜態路徑。
- **測試**：`package.json` 的 `node --test` 會自動找到新測試。
- **文件**：
  - `docs/explore_summary.md` 第 4 節新增一項，記錄對齊 SpecKit 007；
  - `docs/api-contract.md` 不變。
- **依賴**：本分支從 `feat/projector-board` 開出，需在前面的 PR 合併後再合併。
