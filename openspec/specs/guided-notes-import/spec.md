# guided-notes-import Specification

## Purpose

讓老師提供填空學習單（Guided Notes）後，系統依表頭與合併範圍動態辨識題目、題組與空格，經老師確認後成為本次活動的題目，並保存之後匯出寫回所需的原始檔與空格位置。

## Requirements

### Requirement: Teacher provides Guided Notes by file upload
老師 SHALL 能上傳 xlsx 格式的 Guided Notes；檔案大小上限為 5 MiB。空檔、非 xlsx 或無法讀取的檔案 SHALL 被拒絕並說明原因。

#### Scenario: Upload a valid worksheet
- **WHEN** 老師在準備中上傳 `01-official-single.xlsx`
- **THEN** 系統回傳匯入摘要，顯示 6 題

#### Scenario: Reject a non-xlsx file
- **WHEN** 老師上傳內容不是 xlsx 的檔案
- **THEN** 系統拒絕並說明檔案無法讀取，活動題目不變

#### Scenario: Reject an oversized file
- **WHEN** 老師上傳超過 5 MiB 的檔案
- **THEN** 系統拒絕並說明檔案大小上限，活動題目不變

### Requirement: Teacher provides Guided Notes by Google Sheets link
老師 SHALL 能貼上 Google 試算表連結匯入；試算表只需開放「知道連結者可檢視」，不需要任何帳號授權或金鑰。系統 SHALL 只接受 Google 試算表的連結，且對同一份內容 SHALL 得到與上傳 xlsx 相同的結果。

#### Scenario: Import from a shared link
- **WHEN** 老師貼上已開放「知道連結者可檢視」的 Google 試算表連結
- **THEN** 系統回傳與上傳同一份 xlsx 相同的匯入摘要

#### Scenario: Reject a link that is not a Google Sheets URL
- **WHEN** 老師貼上不是 Google 試算表的網址
- **THEN** 系統拒絕並說明只接受 Google 試算表連結，且不連線到該網址

#### Scenario: Link is not shared or cannot be reached
- **WHEN** 連結的試算表未開放檢視，或下載失敗、逾時
- **THEN** 系統拒絕並提示檢查分享設定或改用上傳 xlsx，活動題目不變

### Requirement: Questions are located by header text, not fixed cells
系統 SHALL 以同一列中內容為「題號」「題目」「作答」的表頭列定位題目區，表頭文字前後空白不影響判斷；SHALL NOT 依賴固定的工作表、列號、欄位或儲存格位置。表頭可位於任一工作表，系統 SHALL 使用第一個有表頭且至少有一題的工作表，並在摘要中顯示其名稱。

#### Scenario: Header in a different position
- **WHEN** 老師匯入表頭在第 6 列、題號在 C 欄、作答在 I:J 欄的 `03-shifted-layout.xlsx`
- **THEN** 系統辨識出 8 題、8 個空格

#### Scenario: Worksheet on the second sheet
- **WHEN** 老師匯入第一張工作表是說明、學習單在第二張的 `05-two-sheets.xlsx`
- **THEN** 系統使用第二張工作表並辨識出 5 題，摘要顯示所用的工作表名稱

### Requirement: Each numeric question number below the header is one question
表頭列以下、題號欄為正整數的每一列 SHALL 被辨識為一題，題號 SHALL 沿用學習單上的數字；題號欄不是正整數的列 SHALL 被略過。辨識出的題數 SHALL 與學習單的題數相同。

#### Scenario: Official single-blank worksheet
- **WHEN** 老師匯入官方單題範本 `01-official-single.xlsx`
- **THEN** 系統辨識出題號 1 到 6 共 6 題，每題 1 個空格

#### Scenario: Non-numeric rows are ignored
- **WHEN** 表頭以下有題號欄為文字說明或空白的列
- **THEN** 該列不成為題目，其他題目照常辨識

### Requirement: Vertically merged question numbers form question groups
題號儲存格向下合併多列時，系統 SHALL 辨識為一個題組：一題，合併範圍內每一列一個空格，空格順序與列的順序相同。空格中「（1）」形式的前綴 SHALL 被保留並在摘要中顯示。

#### Scenario: Official question-group worksheet
- **WHEN** 老師匯入官方題組範本 `02-official-group.xlsx`
- **THEN** 系統辨識出 4 題、6 個空格，第 1、2 題為題組，各有前綴「（1）」「（2）」的 2 個空格

#### Scenario: Group with three blanks
- **WHEN** 老師匯入 `04-mixed-groups.xlsx`
- **THEN** 系統辨識出 7 題、11 個空格，第 2 題為 3 個空格的題組

### Requirement: Blank positions are kept for export and hidden from students
系統 SHALL 保存匯入的原始檔，以及每個空格在原檔中的作答區位置與答案寫入位置，供匯出寫回使用。作答區分成前綴格與右側空白格時，答案寫入位置 SHALL 為右側的空白格；作答區為單一合併格時，答案寫入位置 SHALL 為該格。這些位置與原始檔 SHALL NOT 出現在任何提供給學生的資料中。

#### Scenario: Prefix and answer in separate cells
- **WHEN** 匯入 `02-official-group.xlsx`，第 1 題第 1 個空格的前綴在 G5、H5 為空白
- **THEN** 系統記錄作答區位置 G5、答案寫入位置 H5

#### Scenario: Single merged answer cell
- **WHEN** 匯入 `01-official-single.xlsx`，第 1 題的作答區 G5:H5 為合併格
- **THEN** 系統記錄作答區與答案寫入位置皆為 G5

#### Scenario: Student data contains no cell positions
- **WHEN** 匯入完成後查看學生可取得的任何資料
- **THEN** 其中不包含儲存格位置或原始檔內容

### Requirement: Question text is read when present
學習單的「題目」欄有內容時，系統 SHALL 將其作為題目敘述保存；題組的每個空格 SHALL 保存該列的敘述。題目欄為空時 SHALL 仍匯入該題，敘述為空。

#### Scenario: Question without text
- **WHEN** 某題的題目欄是空白
- **THEN** 該題仍被匯入，題目敘述為空

### Requirement: Teacher confirms the summary before questions take effect
系統 SHALL 先回傳匯入摘要供老師核對：來源、工作表名稱、題數、空格數、每題的題號、類型（單題或題組）、空格數與前綴，以及提醒事項。只有在老師確認後，題目才 SHALL 成為本次活動的題目；取消時活動題目 SHALL 不變。

#### Scenario: Confirm an import
- **WHEN** 老師核對摘要後按確認
- **THEN** 活動題目變為匯入的題目，活動摘要的題數同步更新

#### Scenario: Cancel an import
- **WHEN** 老師看到摘要後按取消
- **THEN** 活動題目與題數維持匯入前的狀態

#### Scenario: Confirm an outdated summary
- **WHEN** 老師在取得新摘要後，才對較早的摘要按確認
- **THEN** 系統拒絕並請老師以最新摘要確認，活動題目不變

#### Scenario: Existing answer cell content is reported
- **WHEN** 某個作答格已有不是前綴的內容
- **THEN** 摘要提醒該格已有內容，匯出時會被取代

### Requirement: Re-import replaces existing questions
活動已有題目時，老師 SHALL 能再次匯入；確認前系統 SHALL 提示會取代目前的題目，確認後新題目 SHALL 完全取代舊題目。

#### Scenario: Replace previous questions
- **WHEN** 活動已有 6 題，老師匯入官方題組範本並確認
- **THEN** 活動題目變為 4 題，舊題目不再存在

### Requirement: Import is restricted to the teacher during preparation
匯入與確認 SHALL 只在活動為「準備中」時接受，且 SHALL 只接受已登入老師的請求；查詢目前匯入摘要也 SHALL 要求老師登入。server SHALL 依序檢查登入、階段與內容。

#### Scenario: Reject import during buzzer phase
- **WHEN** 已登入老師在活動為「搶答中」或「已結束」時要求匯入或確認
- **THEN** 系統拒絕並說明只能在準備中匯入，活動題目不變

#### Scenario: Reject import without teacher login
- **WHEN** 未登入的請求要求匯入、確認或查詢匯入摘要，即使來源是 loopback
- **THEN** 系統回傳 `401 TEACHER_AUTH_REQUIRED`，活動題目不變

#### Scenario: Reject import from a non-loopback source
- **WHEN** 非 loopback 來源要求匯入
- **THEN** 系統依老師登入判斷權限：未登入回傳 `401 TEACHER_AUTH_REQUIRED` 且題目不變；已登入老師在「準備中」上傳合法學習單並確認時，活動題目更新為匯入結果

### Requirement: Invalid worksheets are rejected with location details
下列情況系統 SHALL 拒絕匯入，錯誤訊息 SHALL 說明原因，並在可判斷時指出位置與修正方式：找不到表頭列、有表頭但沒有任何題目、題號重複。任何匯入失敗 SHALL NOT 改變活動原有的題目。

#### Scenario: Missing header row
- **WHEN** 老師匯入欄位名稱不是「題號」「題目」「作答」的 `90-invalid-no-header.xlsx`
- **THEN** 系統拒絕並說明找不到「題號／題目／作答」表頭列

#### Scenario: Duplicate question number
- **WHEN** 老師匯入題號 3 出現兩次的 `91-invalid-duplicate-number.xlsx`
- **THEN** 系統拒絕並指出題號 3 重複及其所在的列

#### Scenario: Header without questions
- **WHEN** 老師匯入只有表頭、沒有任何數字題號的 `92-invalid-empty.xlsx`
- **THEN** 系統拒絕並說明沒有找到題目

#### Scenario: Failed import keeps existing questions
- **WHEN** 活動已有題目時，老師匯入一份無效的學習單
- **THEN** 活動題目與題數維持不變
