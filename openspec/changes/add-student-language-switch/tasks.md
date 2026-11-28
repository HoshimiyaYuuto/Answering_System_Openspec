# Tasks

## 1. 共用核心與訊息表

- [x] 1.1 新增 `public/shared/i18n.js`（design 第 1 節），並在 `server/index.js` 加 `/shared` 靜態路徑。

  驗證：新增 `public/shared/i18n.test.js`，涵蓋：
  - `detectLanguage`：
    - 已選 `en`／`zh-TW` 優先；
    - `['en-US','zh-TW']` 為 `en`，`['zh-TW','en']` 為 `zh-TW`；
    - `['ja-JP']` 與空清單為 `zh-TW`；
    - 已存的值不合法時忽略；
  - `readStoredLanguage`／`storeLanguage`：localStorage 丟例外時不丟出，讀取回 `null`；
  - `createTranslator`：
    - 插值 `{name}`；
    - 英文缺 key 時回繁中，兩者都缺時回 key；
  - `translateError`：有對應用翻譯，沒有用原文。

  另在 `server/` 新增測試確認 `GET /shared/i18n.js` 回 200 與 JavaScript 內容型別。既有測試全部通過。

  手動：`node --test public/shared/i18n.test.js`

- [x] 1.2 新增 `public/student/messages.js`（design 第 2 節），並讓 `public/student/logic.js` 產生文字的函式接受 `t`，預設為繁中（design 第 3 節）。

  驗證：在 `public/student/logic.test.js`（或新的 `messages.test.js`）新增測試，涵蓋：
  - 兩種語言 key 相同、值都不是空字串、同一個 key 的插值參數相同；
  - 繁中 translator 下，`buildResultsRows`、`getPhaseDisplay`、`getEntryNextStep`、`getResultsLoadNextStep` 的輸出與現在逐字相同（既有測試不改斷言即通過）；
  - 英文 translator 下：
    - 結果摘要、名次、「No answer」類文字、公平順位說明與改判加註為英文；
    - 組名與答案原樣保留。
  - 所有學生端會遇到的錯誤代碼（design Context 所列）都有英文訊息。

  手動：`node --test public/student/logic.test.js`

## 2. 學生頁

- [x] 2.1 在 `public/student/index.html` 與 `app.js` 接上語言（design 第 4、5 節）：
  - 右上角切換器；
  - `data-i18n` 靜態文字與 `<html lang>`、標題；
  - 動態文字改用 `t()`；
  - 伺服器錯誤經 `translateError`；
  - 切換與其他分頁變更時存草稿後重新載入。

  驗證：`npm test` 全部通過。

  手動（瀏覽器）：
  1. 用 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動 server。
  2. 開 `http://localhost:3000/student/`（瀏覽器語言為繁中）：
     - 介面為繁中；
     - 右上角「中文」為按下狀態；
     - `<html lang>` 為 `zh-TW`。
  3. 按「EN」：
     - 選組畫面變英文，`<html lang>` 為 `en`，分頁標題為英文；
     - 重新整理後仍是英文。
  4. 另開 `http://localhost:3000/student/` 分頁（同一個瀏覽器）：直接是英文。在其中一個按「中文」，另一個也變回中文。
  5. 切成英文後選第 1 組；從 `http://127.0.0.1:3000/student/` 另開一個繁中的第 2 組。老師在 `http://localhost:3000/teacher/` 開始：
     - 第 1 組的題號格、題目頁、提示為英文；
     - 輸入第 2 題草稿後切換語言，草稿仍在。
  6. 第 1 組送出第 1 題後老師結束：結果頁摘要、名次與「No answer」類文字為英文，答案與組名照原樣。
  7. 英文介面下，在搶答中按「更換組別」或以已失效的進場重連：錯誤或說明以英文顯示。

- [x] 2.2 更新 `docs/explore_summary.md` 第 4 節：新增一項記錄介面語言切換對齊 SpecKit 007（學生端已實作，教師端由 `add-teacher-language-switch` 補上；server 與共用契約不變）。

  驗證：`openspec validate --all --strict` 通過。

  手動：無（文件 task）。
