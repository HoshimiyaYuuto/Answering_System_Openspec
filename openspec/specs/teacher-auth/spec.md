# teacher-auth Specification

## Purpose
讓老師以部署時設定的單一密碼登入，並以登入狀態取代來源位址，判斷誰可以執行組別設定、匯入與階段控制等老師操作。

## Requirements

### Requirement: Teacher logs in with the configured password
server SHALL 以環境變數 `TEACHER_PASSWORD` 作為唯一的老師密碼。老師送出正確密碼時，server SHALL 建立登入狀態並交給瀏覽器保存；之後同一瀏覽器重新整理頁面 SHALL 維持登入，不需再次輸入密碼。登入狀態 SHALL 無法被頁面上的 JavaScript 讀取。

#### Scenario: Correct password
- **WHEN** 已設定老師密碼，老師送出正確密碼
- **THEN** server 回應登入成功，之後的老師端點請求被視為已登入

#### Scenario: Refresh keeps the login
- **WHEN** 老師登入後重新整理教師頁
- **THEN** 頁面直接顯示控制台，不要求再次輸入密碼

#### Scenario: Login from another device on the local network
- **WHEN** 老師從同網段的另一台裝置以 server 的區網位址開啟教師頁並輸入正確密碼
- **THEN** 登入成功，且可執行老師操作

### Requirement: Login is refused when no password is configured
`TEACHER_PASSWORD` 未設定或為空字串時，server SHALL 拒絕所有老師登入，回傳 `503 TEACHER_PASSWORD_NOT_SET`，並說明需要先設定老師密碼。server SHALL NOT 提供預設密碼。

#### Scenario: Password not configured
- **WHEN** server 啟動時沒有設定 `TEACHER_PASSWORD`，有人嘗試登入
- **THEN** server 回傳 `503 TEACHER_PASSWORD_NOT_SET`，且任何密碼都無法登入

### Requirement: Wrong password is rejected without revealing information
密碼錯誤時，server SHALL 回傳 `401 WRONG_PASSWORD`，不建立登入狀態。回應內容與所需時間 SHALL NOT 透露正確密碼的長度、內容或與輸入的相似程度。缺少密碼欄位或欄位不是字串時，server SHALL 回傳 `400 INVALID_LOGIN_REQUEST`。

#### Scenario: Wrong password
- **WHEN** 老師送出錯誤密碼
- **THEN** server 回傳 `401 WRONG_PASSWORD`，訊息只說明密碼錯誤，且之後的老師端點請求仍被視為未登入

#### Scenario: Malformed login request
- **WHEN** 登入請求沒有 `password` 欄位，或 `password` 不是字串
- **THEN** server 回傳 `400 INVALID_LOGIN_REQUEST`

### Requirement: Repeated failed logins are throttled per source
同一來源位址在 60 秒內累計 10 次密碼錯誤後，server SHALL 對該來源的登入請求回傳 `429 TOO_MANY_ATTEMPTS`，直到最早一次失敗超過 60 秒為止；限制期間即使密碼正確也 SHALL 拒絕。來源位址 SHALL 依實際連線判定，不採信轉發標頭。其他來源不受影響。

#### Scenario: Too many wrong passwords
- **WHEN** 同一來源在 60 秒內送出 10 次錯誤密碼後再次登入
- **THEN** server 回傳 `429 TOO_MANY_ATTEMPTS`，即使這次密碼正確

#### Scenario: Other sources are unaffected
- **WHEN** 某一來源已被限制，另一來源送出正確密碼
- **THEN** 另一來源登入成功

#### Scenario: Throttle expires
- **WHEN** 被限制的來源等到最早一次失敗超過 60 秒後送出正確密碼
- **THEN** 登入成功

### Requirement: Teacher can log out
已登入老師 SHALL 可以登出；登出後該登入狀態 SHALL 立即失效。server 重新啟動後所有登入狀態 SHALL 失效，老師須重新登入。

#### Scenario: Log out
- **WHEN** 老師登出後再呼叫老師端點
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`

#### Scenario: Server restart
- **WHEN** server 重新啟動後，老師以重啟前的登入狀態呼叫老師端點
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`

### Requirement: Teacher endpoints require login
組別設定、Guided Notes 匯入與查詢、開始與結束搶答等老師端點 SHALL 在檢查階段與請求內容之前先檢查登入，未登入時回傳 `401 TEACHER_AUTH_REQUIRED`，且不改變任何狀態。請求來源是否為 loopback 或帶有任何轉發標頭 SHALL NOT 影響此判斷。學生端點與公開的查詢端點 SHALL NOT 要求老師登入。

#### Scenario: Not logged in from localhost
- **WHEN** 未登入的請求從 localhost 呼叫開始搶答
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，階段不變

#### Scenario: Login checked before phase
- **WHEN** 未登入的請求在「搶答中」提出組別設定
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，而不是階段錯誤

#### Scenario: Student endpoints stay open
- **WHEN** 未登入的學生查詢組別清單、活動摘要或選組進場
- **THEN** server 照常處理，不要求老師登入

### Requirement: Teacher page can query login status
server SHALL 提供不需登入即可呼叫的登入狀態查詢，回傳目前請求是否已登入，以及 server 是否已設定老師密碼，讓教師頁決定要顯示登入畫面、未設定密碼的說明或控制台。

#### Scenario: Not logged in and password configured
- **WHEN** 未登入的瀏覽器查詢登入狀態，且 server 已設定密碼
- **THEN** 回應表示未登入、已設定密碼

#### Scenario: Password not configured
- **WHEN** server 沒有設定密碼時查詢登入狀態
- **THEN** 回應表示未登入、未設定密碼

### Requirement: Password and login state are never exposed
server SHALL NOT 在任何 API 回應內容、錯誤訊息或 log 中包含老師密碼或登入憑證的值。repository SHALL 只包含不含真實密碼的 `.env.example`。

#### Scenario: Responses do not echo secrets
- **WHEN** 老師登入成功、登入失敗或查詢登入狀態
- **THEN** 回應的 JSON 內容不包含密碼，也不包含登入憑證的值
