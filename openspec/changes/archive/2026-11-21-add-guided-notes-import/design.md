# Design: add-guided-notes-import

## Context

動機見 proposal.md。目前狀態：

- `server/index.js` 的 `createApplication()` 以記憶體物件 `session = { phase, questions, groups }` 作為唯一權威狀態；`questions` 只有 development 模式會放入 `{ id, prompt }` 假題目。
- 全域 `express.json({ limit: '16kb' })` 只解析 `application/json`，裝不下 xlsx 檔。
- 寫入端點的慣例：先檢查 loopback，再檢查階段，最後驗證內容；錯誤一律為 `{"error":{"code","message"}}`。
- `public/teacher/` 是只能設定組別的臨時頁，沒有 SSE 連線。
- 測試使用 Node 內建 `node --test`，以 `createApplication()` 起本機 server 後用 `fetch` 呼叫。
- 測試學習單在 `fixtures/guided-notes/`，`expected.json` 記錄每份的工作表、表頭列、題號、每個空格的 `cell` 與 `prefix`。

實際檢查 8 份學習單的結構後，發現作答區有兩種寫法：

```text
 01 單題（官方）    G5:H5 合併、空白                  -> 一格，空白
 02 題組（官方）    G5=（1）  H5=空白   G、H 未合併    -> 前綴一格，右邊另有空白答案格
 03 位移版          表頭在第 6 列，題號 C 欄，作答 I:J  -> 一格，空白
 04 題組（自製）    G7:I7 合併、內容是（1）             -> 前綴與答案共用一格
```

## Goals / Non-Goals

**Goals:**

- 解析規則只依表頭文字與合併範圍，8 份學習單全部符合 `expected.json`。
- 每個空格同時記下「作答區起始格」與「答案寫入格」，讓之後的匯出不必再解析一次。
- 學生可能讀到的題目資料中不含任何儲存格位置或原始檔內容。

**Non-Goals:**

- 不實作匯出寫回；只保證匯出所需的資料已保存。
- 不支援 `.xls`、`.csv`、`.ods`，只接受 `.xlsx`。
- 不做持久化：server 重啟後匯入結果與其他記憶體狀態一樣清空。

## Decisions

### 1. 讀取 xlsx 使用 `exceljs`

| 選項 | 取捨 |
| --- | --- |
| **`exceljs` 4.4.0（採用）** | MIT；可讀合併範圍與儲存格顯示文字；之後匯出寫回時能保留合併、欄寬、框線，同一套件涵蓋匯入與匯出 |
| `xlsx`（npm 上的 SheetJS 0.18.5） | npm 版本已停止更新且有已知漏洞；社群版寫出時會遺失格式，匯出無法使用 |
| 自己解壓 zip 讀 XML | 不需相依套件，但要自行處理 shared strings、inline strings、合併與數值格式，錯誤風險高 |

只引入這一個套件，符合「不引入重型框架」的專案慣例。

### 2. 模組切分

- `server/guided-notes-import.js`（新增）：
  - `parseGuidedNotes(buffer)`：純函式，輸入 xlsx 內容，回傳解析結果或丟出帶 `code` 的錯誤，不碰 HTTP 與 session。
  - `createGuidedNotesImport()`：保存「待確認的預覽」與「已確認的匯入結果」（含原始檔 buffer 與每個空格的位置）。
  - `toGoogleSheetsExportUrl(url)` 與 `fetchGuidedNotesFromLink(url, fetchImpl)`：連結驗證與下載。
- `server/index.js`：只新增路由，沿用既有的 loopback 檢查與錯誤 envelope。

替代方案是把解析寫在 `index.js` 內；拆出模組可直接對 fixtures 做單元測試，也讓之後的匯出 change 重用空格位置。

### 3. 題目資料分成公開與私有兩份

```text
 session.questions（公開，之後學生端與老師端共用）
   [{ id: 3, prompt: "題目敘述", blanks: [{ index: 1, prefix: "（1）", prompt: "子題敘述" }] }]

 guidedNotes（私有，只在 server 的匯入模組內）
   { source: { type: "file" | "link", name }, fileBuffer, sheetName, headerRow,
     questions: [{ id, blanks: [{ index, prefix, anchorCell: "G5", answerCell: "H5" }] }] }
```

- `id` 直接使用學習單上的題號，不重新編號，讓畫面、匯出與 CSV 的題號一致（題號可能不連續）。
- `prompt`：每個空格的 `prompt` 是該列「題目」欄的文字；題目的 `prompt` 是各空格文字以換行相接，沒有敘述時為空字串。
- `id` 與 `prompt` 沿用 server 現有假題目的欄位名稱；`blanks` 是新增欄位。此格式需與學生端成員的 `add-buzz-in-submission` 對齊。

替代方案是把儲存格位置直接放進 `session.questions`，較簡單，但之後任何把題目送給學生的 API 都得記得過濾，容易洩漏。

### 4. 解析規則

```text
 1. 依工作表順序掃描每一列，找同一列中去除前後空白後恰為「題號」「題目」「作答」的儲存格 -> 表頭列
 2. 題號欄 = 「題號」表頭所在欄；題目欄同理；
    作答區 = 「作答」表頭儲存格的合併範圍所涵蓋的欄（未合併則只有一欄）
 3. 表頭列以下，題號欄（取合併範圍的左上格）為正整數（數值 1、1.0 或文字 "1"）的列 = 一題；
    其他列略過
 4. 題號儲存格向下合併多列 = 題組，合併範圍內每一列一個空格；否則為單題，一個空格
 5. 使用第一個「有表頭且至少有一題」的工作表
```

每個空格的位置（`anchorCell` 對應 `expected.json` 的 `cell`）：

```text
 該列的作答區是否為同一個合併範圍？
   是 -> anchorCell = answerCell = 合併範圍左上格
   否 -> anchorCell = 作答區最左格
         若最左格有前綴，answerCell = 同列作答區內右邊第一個空白格；
         沒有空白格時 answerCell = anchorCell
         若最左格是空白，answerCell = anchorCell
 前綴：anchorCell 的文字去除空白後符合「（數字）」或「(數字)」時記為 prefix；
       其他非空內容不視為前綴，改列入摘要提醒「作答格已有內容，匯出時會被取代」
```

### 5. 兩步驟匯入與 API

| 端點 | 用途 |
| --- | --- |
| `POST /api/teacher/guided-notes/preview/file` | body 為 xlsx 原始位元組（`application/octet-stream`），檔名以 `X-File-Name` 標頭傳送（URL 編碼）；回傳摘要 |
| `POST /api/teacher/guided-notes/preview/link` | JSON `{ "url": "..." }`；server 下載後回傳摘要 |
| `POST /api/teacher/guided-notes/confirm` | JSON `{ "previewId": "..." }`；套用預覽，取代 `session.questions` |
| `GET /api/teacher/guided-notes` | 目前已確認的匯入摘要，沒有時為 `null` |

- 預覽回傳 `previewId`、來源、工作表、表頭列、題數、空格數、每題（題號、類型、空格數、前綴）、提醒事項，以及 `replacesExisting`（目前是否已有題目）。
- server 只保留最新一份預覽；新的預覽會取代舊的，用舊 `previewId` 確認時回 `409 IMPORT_PREVIEW_EXPIRED`。取消只需前端丟棄預覽，server 的題目不受影響。
- 上傳路由個別掛 `express.raw({ type: 'application/octet-stream', limit: '5mb' })`，不影響全域 16 KiB 的 JSON 上限。

替代方案：

- 一步驟匯入（上傳即生效）：較簡單，但 D11 要求匯入後讓老師確認題數，且無法在套用前取消。
- `multipart/form-data`：需要額外套件（例如 multer）；原始位元組加標頭已足夠。
- base64 放進 JSON：體積增加約三分之一，還要另外放寬 JSON 上限。

與 `docs/api-contract.md` 的一致性：沿用 `/api` 前綴、`{"data"}`／`{"error"}` envelope、loopback 以實際 socket 位址判定、檢查順序「loopback → 階段 → 內容」。實作時在契約新增「Guided Notes 匯入」一節與下列錯誤代碼。

| HTTP | Code | 情況 |
| --- | --- | --- |
| 400 | `IMPORT_INVALID_FILE` | 空檔、不是 xlsx、檔案損壞無法讀取 |
| 413 | `IMPORT_FILE_TOO_LARGE` | 檔案超過 5 MiB |
| 400 | `IMPORT_NO_HEADER` | 所有工作表都找不到表頭列 |
| 400 | `IMPORT_NO_QUESTIONS` | 有表頭但沒有任何數字題號 |
| 400 | `IMPORT_DUPLICATE_NUMBER` | 同一工作表題號重複（訊息含題號與兩個列號） |
| 400 | `IMPORT_INVALID_LINK` | 不是 `https://docs.google.com/spreadsheets/d/<id>` 形式的連結 |
| 502 | `IMPORT_LINK_UNREACHABLE` | 下載失敗、逾時，或下載內容不是 xlsx（通常是未開放「知道連結者可檢視」） |
| 409 | `IMPORT_NOT_ALLOWED` | 非「準備中」 |
| 409 | `IMPORT_PREVIEW_EXPIRED` | `previewId` 不是最新的預覽 |
| 403 | `LOOPBACK_ONLY` | 沿用既有代碼 |

### 6. Google 試算表連結

- 只接受 `https://docs.google.com/spreadsheets/d/<id>/...`，取出 `<id>` 後由 server 自行組成 `https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx`，不會連到使用者指定的其他主機。
- 使用 Node 內建 `fetch`，逾時 10 秒，讀取超過 5 MiB 即中止。
- 下載內容開頭不是 zip 標記（`PK`）時，視為未開放權限，回 `IMPORT_LINK_UNREACHABLE` 並提示檢查分享設定。
- `createApplication()` 新增可注入的下載函式選項，讓自動測試不需連網。

### 7. 臨時教師頁的畫面狀態機

在既有「組別設定」下方新增「匯入學習單」區塊。

```text
            載入頁面：GET /api/session + GET /api/teacher/guided-notes
                                 |
              +------------------+------------------+
              v                                     v
        [未匯入] 顯示「尚未匯入」            [已匯入] 顯示工作表、題數、來源
              |                                     |
              +--------- 選檔或貼連結並送出 ---------+
                                 v
                           [讀取中] 按鈕停用
                       失敗 /          \ 成功
                          v              v
              回到原狀態並顯示錯誤     [待確認] 顯示摘要表格；
                                       replacesExisting 時提示「會取代目前的題目」
                                    確認 /        \ 取消
                                       v            v
                                 [確認中]      回到原狀態，題目不變
                               成功 /   \ 失敗
                                   v      v
                             [已匯入]   回到 [待確認] 並顯示錯誤
```

- 畫面依 `GET /api/session` 的 `phase` 與 `GET /api/teacher/guided-notes` 決定；非「準備中」時停用選檔、送出與確認，並說明原因。
- 以區網 IP 開啟時沿用既有警告並停用操作。
- 每次繪製一律取代內容；同時發出多個請求時以遞增序號丟棄過期回應。

## Risks / Trade-offs

- [助教的學習單作答區寫法與 fixtures 都不同] → 答案位置規則只依合併範圍與前綴文字；手動驗證時另做一份欄位位置不同的學習單測試。
- [`exceljs` 對少見格式（條件式格式、圖片）處理不完整] → 匯入只讀文字與合併範圍，不受影響；匯出時的格式保留在 `add-export-guided-notes` 驗證。
- [Google 匯出網址行為改變或需要登入] → 失敗時回明確錯誤並提示改用上傳 xlsx，上傳是主要路徑。
- [惡意或超大 xlsx 讓解析變慢] → 只接受 loopback 的老師請求，加上 5 MiB 上限。
- [server 重啟後匯入結果消失] → 與現有記憶體狀態一致；老師重新匯入即可，已列入已知限制。
- [`npm audit` 回報 `exceljs` 依賴的 `uuid` 有中度風險（GHSA-w5hq-g745-h8pq，只在 v3/v5/v6 傳入 buffer 時發生）] → `exceljs` 只使用 `uuid` 的 v4，不受影響；`npm audit fix --force` 會降級成 `exceljs` 3.4.0，反而失去功能，因此不採用。
- [題目格式與學生端成員的期待不同] → 格式集中在 `session.questions` 一處，若需調整只動匯入模組的輸出。

## Open Questions

- 學生端成員確認 `session.questions` 的欄位名稱（`id`、`prompt`、`blanks[].index`、`blanks[].prefix`、`blanks[].prompt`）後，若需改名，只影響匯入模組的輸出與對應測試。
