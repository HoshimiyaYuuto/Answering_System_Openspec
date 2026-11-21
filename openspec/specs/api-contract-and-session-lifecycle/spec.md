# api-contract-and-session-lifecycle Specification

## Purpose

定義學生端與教師端共用的 API 外部行為，以及 server 管理活動階段、同步階段變化並回覆一致錯誤的基本能力，讓後續功能可依同一契約獨立開發。

## Requirements

### Requirement: API responses use a consistent JSON envelope
所有 API 回應 SHALL 使用 JSON。錯誤回應 SHALL 包含穩定的錯誤 code 與可供使用者理解的訊息；未知路徑與內部錯誤也 SHALL 回傳相同結構。

#### Scenario: Unknown route
- **WHEN** 用戶端呼叫未定義的 API 路徑
- **THEN** server 回傳 JSON 錯誤，包含 code 與訊息

#### Scenario: Internal failure
- **WHEN** 處理請求時發生未預期錯誤
- **THEN** server 回傳 JSON 錯誤，不洩漏機敏設定或內部堆疊資訊

#### Scenario: Malformed or oversized JSON body
- **WHEN** 用戶端送出格式錯誤或超過契約大小上限的 JSON body
- **THEN** server 回傳契約格式的 JSON 錯誤，包含 code 與訊息

### Requirement: Server provides the authoritative session summary
server SHALL 提供目前活動階段、題數、組數與 server 時間摘要，並以單一權威狀態作為所有連線端查詢結果的來源。

#### Scenario: Read session summary
- **WHEN** 用戶端查詢活動摘要
- **THEN** 回應包含目前階段、題數、組數與 server 時間，且資料來自 server 權威狀態

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

### Requirement: Connected clients receive lifecycle changes promptly
server SHALL 在階段變化後兩秒內通知所有已連線端，且通知內容 SHALL 反映 server 當前階段與 server 時間；SSE 串流 SHALL 定期傳送心跳以維持連線。

#### Scenario: Broadcast phase change
- **WHEN** 活動階段發生有效變化
- **THEN** 所有已連線端在兩秒內收到新的階段

#### Scenario: SSE heartbeat
- **WHEN** SSE 連線期間沒有階段變化
- **THEN** server 定期傳送心跳以維持連線

#### Scenario: Reconnect reads current phase
- **WHEN** 用戶端在階段變化後重新連線並查詢活動摘要
- **THEN** 回應包含 server 目前的階段

### Requirement: Server is reachable on the local network
server SHALL 可由同網段的手機或電腦連線；在 100 個 SSE 連線及至少 50 題的負載下，階段變化 SHALL 於 2 秒內送達所有連線。

#### Scenario: Local network client connects
- **WHEN** 同網段裝置使用 server 主機的網路位址連線
- **THEN** 裝置可取得 JSON 活動摘要

#### Scenario: Measured SSE capacity baseline
- **WHEN** 100 個 SSE client 已連線，活動包含至少 50 題，且 server 發出階段變化
- **THEN** 自發出時起 2 秒內 100 個 client 全部收到該事件

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
