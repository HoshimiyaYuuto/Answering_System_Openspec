# Spec Delta: api-contract-and-session-lifecycle

## MODIFIED Requirements

### Requirement: Session lifecycle moves forward only
活動階段 SHALL 僅能由準備中進入搶答中，再進入已結束；任何寫入端點 SHALL 在 server 檢查階段是否允許該操作。階段控制端點 SHALL 只接受已登入老師的請求（見 `teacher-auth`），不再以 loopback 來源判定權限。活動重設不在本 change 範圍，後續加入時 SHALL 以 MODIFIED 更新此單向階段要求。

#### Scenario: Start session
- **WHEN** 已登入老師在準備中要求開啟活動，且已有組別與題目
- **THEN** 活動進入搶答中並發布階段變化

#### Scenario: Reject backward transition
- **WHEN** 用戶端要求將搶答中或已結束活動退回較早階段
- **THEN** server 拒絕要求並回傳一致格式的 JSON 錯誤

#### Scenario: Reject non-loopback control request
- **WHEN** 非 loopback 來源呼叫階段控制端點
- **THEN** server 依老師登入判斷權限：未登入回傳 `401 TEACHER_AUTH_REQUIRED` 且階段不變，已登入則照常檢查階段

#### Scenario: Reject control request without teacher login
- **WHEN** 未登入的請求呼叫階段控制端點，即使來源是 loopback
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，階段不變

## ADDED Requirements

### Requirement: Starting requires groups and questions
開始搶答時，server SHALL 依序檢查：目前階段為準備中、至少有一個組別、至少有一題。沒有組別時 SHALL 回傳 `409 NO_GROUPS`，沒有題目時 SHALL 回傳 `409 QUESTIONS_REQUIRED`，訊息說明需要先完成的設定，且階段維持準備中、不發布階段變化。

#### Scenario: Start without groups
- **WHEN** 已登入老師在準備中開始搶答，但沒有任何組別
- **THEN** server 回傳 `409 NO_GROUPS`，階段維持準備中

#### Scenario: Start without questions
- **WHEN** 已登入老師在準備中開始搶答，已有組別但沒有題目
- **THEN** server 回傳 `409 QUESTIONS_REQUIRED`，階段維持準備中

#### Scenario: Phase checked before setup
- **WHEN** 已登入老師在搶答中再次要求開始，且沒有題目
- **THEN** server 回傳 `409 INVALID_PHASE_TRANSITION`
