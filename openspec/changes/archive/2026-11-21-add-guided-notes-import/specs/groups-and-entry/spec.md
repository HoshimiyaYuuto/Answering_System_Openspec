# Spec Delta: groups-and-entry

## MODIFIED Requirements

### Requirement: Temporary teacher page only configures groups
臨時教師頁面 SHALL 只提供組數/組名設定、預設名稱產生功能，以及 Guided Notes 匯入（上傳 xlsx 或貼上 Google 試算表連結、核對摘要、確認或取消）；設定與匯入 API 仍 SHALL 僅接受 loopback，正式教師端介面與密碼驗證由後續 change 處理。

#### Scenario: Configure groups from localhost
- **WHEN** 教師在 localhost 使用臨時頁面提交合法組別設定
- **THEN** 頁面顯示設定成功且 server 的組別清單與摘要數量更新

#### Scenario: Import Guided Notes from localhost
- **WHEN** 教師在 localhost 使用臨時頁面匯入合法的 Guided Notes 並確認摘要
- **THEN** 頁面顯示已匯入的工作表與題數，且 server 的活動摘要題數更新

#### Scenario: Import controls disabled outside preparation
- **WHEN** 活動不是「準備中」時開啟臨時頁面
- **THEN** 匯入操作被停用，並說明只能在準備中匯入

#### Scenario: No quiz management on temporary page
- **WHEN** 教師開啟臨時組別設定頁
- **THEN** 頁面不提供作答、送出、監看或正式教師控制功能
