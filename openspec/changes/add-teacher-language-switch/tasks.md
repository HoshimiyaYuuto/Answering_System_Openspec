# Tasks

## 1. server 與文件

- [x] 1.1 在 `server/guided-notes-import.js` 依 design 第 5 節新增 `warningDetails`，預覽與目前學習單的摘要都帶出。

  驗證：在 `server/guided-notes-import.test.js` 與 `server/guided-notes-api.test.js` 新增測試，涵蓋：
  - 作答格已有內容時，`warningDetails` 包含正確的 `code`、`questionId`、`blankIndex`、`cell`，順序與 `warnings` 相同；
  - 沒有提醒時兩者都是空陣列；
  - 確認匯入後 `GET /api/teacher/guided-notes` 的摘要仍有相同的 `warningDetails`；
  - `warnings` 的文字與現在相同。

  既有測試全部通過。

  手動：`node --test server/guided-notes-import.test.js server/guided-notes-api.test.js`

- [x] 1.2 更新文件：
  - `docs/api-contract.md`：匯入預覽與摘要的範例與說明加上 `warningDetails`；
  - `docs/explore_summary.md`：第 4 節介面語言項目註明教師端由本 change 完成。

  驗證：`openspec validate --all --strict` 通過；人工比對契約與 1.1 的測試欄位一致。

  手動：無（文件 task）。

## 2. 訊息表與 logic 檔

- [x] 2.1 新增 `public/teacher/messages.js`（design 第 4 節），並讓 `console-logic.js`、`import-logic.js`、`export-logic.js`、`board-logic.js` 產生文字的函式接受 `t`，預設為繁中（design 第 2、3 節）。

  驗證：新增 `public/teacher/messages.test.js`，並在各 logic 測試新增英文案例，涵蓋：
  - 兩種語言 key 相同、值不是空字串、插值參數相同；
  - design 第 4 節列出的錯誤代碼都有英文訊息；
  - 英文 translator 下，下列文字為英文：
    - 控制台：摘要、公平順位、倒數錯誤；
    - 匯入：摘要、題型、提醒（`ANSWER_CELL_NOT_EMPTY` 組句，含儲存格位置）；
    - 匯出：按鈕與結果；
    - 看板：階段、在線、「尚未揭曉」、「無人作答」、公平順位改判；
  - 英文下組名、答案、學習單名稱、工作表名稱原樣保留；
  - `renderMessage` 對字串、`{ key }`、`{ code, fallback }` 三種輸入的輸出。

  既有測試的斷言不改且全部通過。

  手動：`node --test public/teacher`

## 3. 頁面接線

- [x] 3.1 在 `public/teacher/index.html` 與 `app.js` 接上語言（design 第 1、2、6 節）：
  - 切換器；
  - `data-i18n` 靜態文字；
  - 所有動態文字與伺服器錯誤改走 `t` 或 `renderMessage`；
  - `setLanguage` 原地重畫；
  - `relabelGroups`；
  - `watchLanguage`。

  驗證：
  - `npm test` 全部通過；
  - 以指令掃描 `public/teacher/app.js` 與 `index.html` 的中文字元：除了註解與 `lang` 屬性以外沒有殘留。

  手動（瀏覽器，啟動方式同學生端 change）：
  1. 開 `http://localhost:3000/teacher/`：登入畫面右上角有切換器。按「EN」後登入畫面為英文；輸入錯誤密碼時，錯誤訊息為英文。
  2. 以 `test-password` 登入：活動狀態、組別、匯入、監看、匯出都是英文，`<html lang>` 為 `en`。
  3. 在組別名稱輸入框改字但不儲存，切回「中文」：輸入框內容仍在，label 變中文。
  4. 上傳官方範本取得預覽、不確認，切換語言：預覽仍在，題型與提醒換語言，按確認仍可套用。
  5. 開始搶答、按「結束搶答」出現確認後切換語言：確認仍在，按確認後結束；搶答結果與匯出區為目前語言。
  6. 另開 `http://localhost:3000/student/` 分頁：與控制台同一種語言；在控制台切換時，學生頁也跟著換。

- [x] 3.2 在 `public/teacher/board.html` 與 `board.js` 接上語言（design 第 1、6 節）：右上角切換器、靜態文字、`setLanguage` 後呼叫 `render()`。

  驗證：`npm test` 全部通過；以指令掃描 `board.js` 與 `board.html` 的中文字元，除了註解以外沒有殘留。

  手動（瀏覽器）：
  1. 未登入的英文介面開 `http://localhost:3000/teacher/board.html`：說明與連結為英文。
  2. 登入後開看板：準備中、搶答中（含倒數與在線）都可以切換語言。
  3. 結束後揭曉 3 題，按「EN」：仍是已揭曉 3 題，文字為英文；再按「全部揭曉」後切回中文，按鈕仍停用。
