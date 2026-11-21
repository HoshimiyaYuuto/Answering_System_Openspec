# Spec Delta: guided-notes-import

## MODIFIED Requirements

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
