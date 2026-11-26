# Design: add-results-csv-export

## Context

動機見 proposal。目前狀態：

- 判定結果由 `server/results.js` 的 `computeResults({ questions, submissions, now })` 即時推導，回傳每題 `winner`、`winnerSource`、`placings`（含 `place`）；不含答案，答案以 `questionId` + `rank` 到 `submissions.listSubmissions()` 查回。老師監看（`server/teacher-monitor.js`）與 xlsx 匯出、寫回都用它。
- `session.questions` 為匯入後的題目，每題 `blanks[i].index` 從 1 起；`session.groups.list()` 回傳 `{ id, name }`。組別只能在「準備中」設定，所以活動結束後組名不會再變，但組別可能在作答之後被刪除的情況不存在（搶答中與已結束都不能改組別）。老師監看對找不到的組別顯示 `組 <id>`，本 change 沿用。
- `add-guided-notes-export`（PR #16，本分支的基底）已有：`exportGuard`（未結束回 `409 EXPORT_NOT_ALLOWED`）、`exportFileName()`、控制台「匯出結果」區塊與 `public/teacher/export-logic.js` 的狀態（`reduceExport`／`getExportView`），以及以 `fetch` 取得檔案、失敗時讀 JSON 錯誤再觸發下載的流程。
- 規格來源：`docs/submission-record.md` v0.4 第 3 節「CSV 對應」與檔案格式（2026-11-23 由 SpecKit 組依其 004 提供）。

## Goals / Non-Goals

**Goals:**

- csv 的名次與勝者和老師監看完全一致（同一次 `computeResults()`）。
- 產生 csv 的邏輯為純函式，可用 `node --test` 直接檢查位元組（BOM、CRLF、引號、公式前綴、時區）。
- 與 xlsx 下載共用控制台的按鈕狀態與下載流程，不另開一套。

**Non-Goals:**

- 不實作作廢與公平順位；只保證它們出現時 csv 的處理方式（排除作廢、公平順位欄的值）已就緒並有測試。
- 不提供欄位、分隔符號或編碼的選項。
- 不在搶答中提供 csv（D13 只要求結束後匯出）。

## Decisions

### 1. 端點：`GET /api/teacher/results/csv`

- `requireTeacher` → 階段不是「已結束」回 `409 EXPORT_NOT_ALLOWED`（訊息「活動結束後才能匯出。」，與 xlsx 相同）。
- 不檢查 `NO_GUIDED_NOTES`：能進入「已結束」就一定開始過搶答，而開始搶答需要已匯入題目（`QUESTIONS_REQUIRED`），所以結束後 `session.questions` 必有內容。csv 也只需要題目的空格序，不需要原匯入檔。
- 成功：`200`，`Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="results.csv"; filename*=UTF-8''<原檔名去掉 .xlsx>（搶答結果）.csv`（沒有匯入名稱時為 `Guided Notes（搶答結果）.csv`）。檔名規則與 xlsx 共用一個函式，只換副檔名。
- 放在 `/api/teacher/results/` 而不是 `/api/teacher/guided-notes/`：csv 是整場作答紀錄，不屬於學習單，也與學習單來源無關。

替代方案：放在 `GET /api/teacher/guided-notes/export?format=csv`。可少一個路徑，但會讓 csv 看起來依賴學習單、並與 xlsx 的 `NO_GUIDED_NOTES` 檢查糾纏，不採用。

### 2. 產生 csv 的純函式：`server/results-csv.js`

```js
buildResultsCsv({ questions, groups, submissions, results, fairRankingEnabled = false, timeZone })
// 回傳含 BOM 的字串；server 以 Buffer.from(csv, 'utf8') 送出
```

步驟：

1. 以 `results`（`computeResults()` 的結果）逐題處理，題目依 `questions` 的順序（即題號順序）。
2. 每題依 `placings` 的順序（`place` 由小到大）取出作答，以 `questionId` + `rank` 到 `submissions` 查回 `answers` 與 `submittedAt`；`placings` 只含有效作答，所以作廢自然被排除。
3. 每筆作答依 `blanks` 的順序輸出每個空格一列：`[questionId, blank.index, groupName, answers[i], place, isWinner ? '是' : '否', localTime, fairColumn]`。
4. 公平順位欄：`fairRankingEnabled` 為 `false` 時 `否`；為 `true` 時該題 `winnerSource === 'fair'` 為 `是（改判）`，其餘 `是`。目前 `computeResults()` 在啟用時會丟出 `FAIR_RANKING_NOT_SUPPORTED`，server 永遠傳 `false`；純函式仍接受 `true` 以便測試欄位規則，公平順位 change 只需改 server 呼叫端。
5. 每個欄位先做公式防護（首字元為 `=`、`+`、`-`、`@` 時前面加 `'`），再做 RFC 4180 引號（含 `,`、`"`、`\r`、`\n` 時包雙引號、內部 `"` 變 `""`）。順序是先加單引號再判斷引號，所以 `=a,b` 輸出 `"'=a,b"`。數字欄（題號、空格序、順位）轉字串後同樣經過這兩步，不會受影響。
6. 以 `\r\n` 連接每列（最後一列後也有 `\r\n`），開頭加 `﻿`。

替代方案：用 npm 的 csv 套件。規則只有上述幾條，自己寫十幾行且可完整測試，不值得多一個依賴。

### 3. 本地時間

`submittedAt` 為 ISO 8601 UTC（專案慣例）。csv 以 `Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year, month, day, hour, minute, second })` 的 `formatToParts` 組成 `YYYY-MM-DD HH:mm:ss`。`timeZone` 未指定時為 `undefined`，即 server 所在的系統時區（老師的電腦）；測試傳入 `Asia/Taipei` 與 `UTC` 以固定結果，不依賴執行測試的機器時區。

- 不輸出毫秒：D13 只要求本地時間，名次已有獨立的「順位」欄；秒以下的先後看順位即可。
- 格式選 `YYYY-MM-DD HH:mm:ss`：Excel 與 Google 試算表都能辨識為日期時間，且排序與字串順序一致。SpecKit 組的實際格式尚未比對，列入待確認（見 Risks）。

替代方案：在前端轉時間。csv 由 server 產生，前端只負責下載，轉換放在前端需要先回 JSON 再組 csv，與 xlsx 下載流程不一致，不採用。

### 4. 順位欄用 `place`

依 `docs/submission-record.md` v0.4，「順位」為判定結果的 `place`（有效作答之間連續編號，與老師監看的名次相同），滿足 AC-000-09「csv 與老師端順位一致」。目前沒有作廢與公平順位，`place` 等於送達順序，與 SpecKit 說明的「送達順位」在可觀察行為上相同；兩者只在作廢或公平順位出現後才可能不同，列入待確認。

### 5. 控制台

在「匯出結果」區塊新增 `#export-csv` 按鈕（`secondary` 樣式，放在「下載 xlsx」之後）。狀態沿用 `export-logic.js`：

- 新事件：`requestCsv`（`action: 'downloadingCsv'`）、`csvDone`（結果「已下載 CSV。」）、`csvFailed`（結果為 server 訊息）。
- `getExportView` 新增 `canDownloadCsv`（`action` 為 `idle` 且階段為「已結束」）與 `csvLabel`（下載中為「下載中…」）。與 xlsx 不同，不看 `importSource`（理由同第 1 節）。
- 任一動作進行中時三個按鈕都停用（沿用 `action` 單一狀態），避免同時下載與寫回。
- `app.js` 把 xlsx 的「fetch → 檢查 → blob → 觸發下載」抽成 `downloadFile(url, fallbackName)`，xlsx 與 csv 共用；`fileNameFromDisposition` 新增 fallback 參數已存在，直接傳 `results.csv`。

畫面狀態機（只列本區塊與 csv 相關的部分；xlsx 與寫回的狀態不變，見 `add-guided-notes-export` design 第 8 節）：

| 狀態 | 由什麼決定 | 「下載 CSV」 | 訊息 |
| --- | --- | --- | --- |
| 未結束 | `phase !== '已結束'` | 停用 | 區塊說明「活動結束後才能匯出。」 |
| 可下載 | `phase === '已結束'` 且 `action === 'idle'` | 可用、「下載 CSV」 | 上一次動作的結果或空白 |
| 下載中 | `action === 'downloadingCsv'` | 停用、「下載中…」 | 空白 |
| 寫回中／xlsx 下載中 | `action` 為其他進行中值 | 停用 | 空白 |

切換事件：`phase` 事件或摘要重新讀取（`phaseChanged`，只有階段真的改變才清除結果）、按下按鈕（`requestCsv`）、下載完成或失敗（`csvDone`／`csvFailed`）、登出或登入失效（`reset`）。

### 6. 與 docs/api-contract.md 的一致性

- 新增「結果 csv 匯出」章節：端點、檢查順序、回應標頭、8 欄定義、排序、編碼與 PowerShell 範例。錯誤代碼沿用既有的 `TEACHER_AUTH_REQUIRED` 與 `EXPORT_NOT_ALLOWED`，不新增代碼。
- 老師監看章節的 `winnerSource` 可能值由 `arrival`／`fair`／`override` 改為 `arrival`／`fair`。這只是把契約文件對齊 v0.4 已移除的 O3（`computeResults()` 從未產生 `override`），不改變任何回應。
- 與 SpecKit 004 的差異：端點路徑不同（兩組 API 本來就不同，只比可觀察行為）；欄位、編碼、公式防護一致。

## Risks / Trade-offs

- [SpecKit 的送出時間格式與「順位」語意未逐字比對] → 本 change 依 v0.4 實作並在 PR 說明列出；若 SpecKit 不同，只需改 `server/results-csv.js` 的格式化或來源欄位與對應測試。
- [server 時區與老師期待不同（例如 server 跑在 UTC 的雲端主機）] → 本專案在老師電腦本機執行，系統時區即課堂時區；README 註明時間以 server 電腦的時區輸出。
- [公式防護會改變以 `-` 開頭的正常答案（例如負數 `-3` 變 `'-3`）] → 這是兩組約定的安全做法；Excel 顯示時單引號不可見，Google 試算表會顯示單引號。驗證紀錄記錄實際外觀。
- [作答很多時 csv 很大] → 100 組 × 50 題 × 每題最多數個空格約數萬列、數 MB，以字串一次產生即可；`npm run check:capacity` 的規模下另做一次產生時間檢查。
