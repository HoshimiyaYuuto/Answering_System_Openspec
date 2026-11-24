# Spec Delta

## MODIFIED Requirements

### Requirement: Blank positions are kept for export and hidden from students
系統 SHALL 保存匯入的原始檔，以及每個空格在原檔中的作答區位置與答案寫入位置，供匯出寫回使用。作答區分成前綴格與右側格時，答案寫入位置 SHALL 為前綴右側第一個格子；右側格已有內容時仍以該格為答案寫入位置，並提出「匯出時會被取代」的警告。作答區為單一合併格時，答案寫入位置 SHALL 為該格。以 Google 試算表連結匯入時，系統 SHALL 另外保存該試算表的 ID 作為寫回目標；以上傳檔案匯入時 SHALL 沒有寫回目標。這些位置、原始檔與試算表 ID SHALL NOT 出現在任何提供給學生的資料中。

#### Scenario: Prefix and answer in separate cells
- **WHEN** 匯入 `02-official-group.xlsx`，第 1 題第 1 個空格的前綴在 G5、H5 為空白
- **THEN** 系統記錄作答區位置 G5、答案寫入位置 H5

#### Scenario: Single merged answer cell
- **WHEN** 匯入 `01-official-single.xlsx`，第 1 題的作答區 G5:H5 為合併格
- **THEN** 系統記錄作答區與答案寫入位置皆為 G5

#### Scenario: Answer cell beside the prefix already has content
- **WHEN** 匯入一份第 1 題前綴在 G5、H5 已有文字的學習單
- **THEN** 系統記錄答案寫入位置 H5，並在摘要警告中指出 H5 已有內容、匯出時會被取代

#### Scenario: Linked import keeps the write-back target
- **WHEN** 以 Google 試算表連結匯入並確認
- **THEN** 系統保存該試算表 ID 作為寫回目標

#### Scenario: Uploaded import has no write-back target
- **WHEN** 以上傳 xlsx 匯入並確認，取代先前以連結匯入的學習單
- **THEN** 系統不再有寫回目標

#### Scenario: Student data contains no cell positions
- **WHEN** 匯入完成後查看學生可取得的任何資料
- **THEN** 其中不包含儲存格位置、原始檔內容或試算表 ID
