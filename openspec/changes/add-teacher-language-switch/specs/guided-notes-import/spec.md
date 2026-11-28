# Spec Delta

## ADDED Requirements

### Requirement: Import warnings are also provided as structured details
匯入預覽與目前學習單的摘要，除了既有的提醒文字 `warnings` 之外，SHALL 另外提供 `warningDetails`：每一則提醒對應一筆，依相同順序，包含提醒代碼 `code`、題號 `questionId`、空格序 `blankIndex` 與儲存格位置 `cell`。作答格已有內容的提醒代碼 SHALL 為 `ANSWER_CELL_NOT_EMPTY`。既有的 `warnings` 文字與順序 SHALL 不變。

#### Scenario: Answer cell already has content
- **WHEN** 匯入的學習單第 2 題第 1 格的作答格 `C7` 已有內容
- **THEN** 預覽的 `warnings` 照舊包含該中文提醒，`warningDetails` 包含 `{ "code": "ANSWER_CELL_NOT_EMPTY", "questionId": 2, "blankIndex": 1, "cell": "C7" }`

#### Scenario: No warnings
- **WHEN** 匯入的學習單沒有任何提醒
- **THEN** `warnings` 與 `warningDetails` 都是空陣列

#### Scenario: Confirmed summary keeps the details
- **WHEN** 老師確認匯入後讀取目前學習單
- **THEN** 摘要的 `warningDetails` 與預覽時相同
