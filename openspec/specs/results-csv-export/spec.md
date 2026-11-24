# results-csv-export Specification

## Purpose
活動結束後，讓老師下載整場活動的作答紀錄 csv（每筆有效作答的每個空格一列），欄位與順位和老師端看到的判定結果一致，可直接用 Excel 或 Google 試算表開啟。

## Requirements

### Requirement: Teacher downloads the results csv after the session ends
已登入老師 SHALL 能在活動「已結束」後下載整場的作答紀錄 csv。未登入 SHALL 回 `401 TEACHER_AUTH_REQUIRED`；活動不是「已結束」時 SHALL 回 `409 EXPORT_NOT_ALLOWED` 且不產生檔案。下載 SHALL NOT 改變作答、順位、題目或活動階段，且與學習單是上傳或以連結匯入無關。

#### Scenario: Download after the session ends
- **WHEN** 已登入老師在「已結束」階段下載 csv
- **THEN** 回應為 csv 檔案下載，檔名包含匯入的學習單名稱與「搶答結果」

#### Scenario: Not yet ended
- **WHEN** 已登入老師在「搶答中」下載 csv
- **THEN** 回應為 `409 EXPORT_NOT_ALLOWED`

#### Scenario: Not logged in
- **WHEN** 未登入的請求下載 csv
- **THEN** 回應為 `401 TEACHER_AUTH_REQUIRED`

#### Scenario: Download leaves session data unchanged
- **WHEN** 老師下載 csv 後查詢活動摘要與老師監看
- **THEN** 階段、題數、組數、各題名次與勝者與下載前相同

### Requirement: Each valid submission's blanks become rows with the eight agreed columns
csv 第一列 SHALL 為表頭 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位`。之後每筆**有效**作答的每個空格 SHALL 各佔一列，依題號、順位、空格序由小到大排序。已作廢的作答 SHALL NOT 出現；沒有任何有效作答的題目 SHALL NOT 產生資料列；沒有任何有效作答時 csv 只有表頭。

各欄 SHALL 為：

- 題號：學習單上的題號。
- 空格序：該空格在題內的序號，從 1 起。
- 組別：組別名稱，不輸出組別 id。
- 答案：該空格的答案（送出時已去除前後空白）。
- 順位：該作答在該題判定結果中的名次，與老師監看顯示的名次相同。
- 是否搶答成功：該作答是該題判定結果的勝者時為 `是`，否則為 `否`；同一筆作答的所有空格相同。
- 送出時間：server 收到作答的時間，以 server 所在時區的本地時間 `YYYY-MM-DD HH:mm:ss` 輸出，不帶 `Z` 或時區後綴。
- 公平順位：未啟用公平順位時為 `否`；啟用時為 `是`，該題勝者因公平順位改判時為 `是（改判）`。

#### Scenario: Group question with two submissions
- **WHEN** 第 1 題有 2 個空格，第 1 組先送出「甲」「乙」、第 2 組後送出「丙」「丁」，活動結束
- **THEN** 第 1 題依序輸出 4 列：`1,1,第 1 組,甲,1,是,…,否`、`1,2,第 1 組,乙,1,是,…,否`、`1,1,第 2 組,丙,2,否,…,否`、`1,2,第 2 組,丁,2,否,…,否`

#### Scenario: Question without submissions
- **WHEN** 第 2 題沒有任何作答
- **THEN** csv 中沒有題號為 2 的資料列

#### Scenario: Voided submission is excluded
- **WHEN** 第 3 題第 1 組（送達第 1）的作答已作廢，第 2 組（送達第 2）的作答有效
- **THEN** csv 中第 3 題只有第 2 組的列，順位為 1，是否搶答成功為 `是`

#### Scenario: Local time without zone suffix
- **WHEN** server 時區為 UTC+8，作答於 `2026-11-24T01:02:03.456Z` 送達
- **THEN** 送出時間欄為 `2026-11-24 09:02:03`

#### Scenario: Ranking matches teacher monitoring
- **WHEN** 老師在監看看到第 1 題第 1 名為第 2 組、第 2 名為第 1 組後下載 csv
- **THEN** csv 第 1 題第 2 組的順位為 1 且是否搶答成功為 `是`，第 1 組的順位為 2 且為 `否`

### Requirement: The csv opens safely in spreadsheet software
csv SHALL 以 UTF-8 編碼並以 BOM 開頭，每列 SHALL 以 CRLF 結尾，以便 Excel 直接開啟不出現亂碼。欄位值以 `=`、`+`、`-`、`@` 開頭時 SHALL 在前面加上單引號 `'`，避免被試算表當成公式。欄位含逗號、雙引號、CR 或 LF 時 SHALL 依 RFC 4180 以雙引號包住，內部雙引號改為兩個；其他欄位 SHALL NOT 加引號。

#### Scenario: BOM and line endings
- **WHEN** 老師下載 csv
- **THEN** 檔案前 3 個位元組為 `EF BB BF`，每列以 `\r\n` 結尾

#### Scenario: Formula-like answer
- **WHEN** 某組答案為 `=1+1`
- **THEN** 答案欄為 `'=1+1`

#### Scenario: Answer containing comma and quotes
- **WHEN** 某組答案為 `甲,"乙"`
- **THEN** 答案欄為 `"甲,""乙"""`

#### Scenario: Group name needing protection
- **WHEN** 組別名稱為 `-第一組`
- **THEN** 組別欄為 `'-第一組`

### Requirement: Console offers a csv download in the export panel
老師控制台的「匯出結果」區塊 SHALL 提供「下載 CSV」按鈕。活動不是「已結束」時按鈕 SHALL 停用；已結束後 SHALL 可用，不論學習單是上傳或以連結匯入，也不論是否設定 Google 服務帳號。下載進行中按鈕 SHALL 停用並顯示進行中文字；成功 SHALL 顯示已下載的訊息，失敗 SHALL 顯示 server 回傳的原因。

#### Scenario: Disabled before the session ends
- **WHEN** 老師在「搶答中」開啟控制台
- **THEN** 「下載 CSV」按鈕停用

#### Scenario: Enabled for an uploaded workbook
- **WHEN** 學習單為上傳的 xlsx、server 未設定服務帳號，活動已結束
- **THEN** 「下載 CSV」按鈕可用，按下後瀏覽器下載 csv 並顯示「已下載 CSV。」
