## MODIFIED Requirements

### Requirement: Student page synchronizes phase and connection health
學生端 SHALL 以 `GET /api/session` 取得初始階段，並以 `GET /api/events` 同步後續階段；超過 40 秒未收到 phase 或 heartbeat 事件 SHALL 顯示「重新連線中」。學生端 SHALL 丟棄過期的階段：請求送出後若已收到新的 phase 事件，該請求回應中的階段（進場回應或 session 摘要）SHALL NOT 覆蓋事件的階段。

#### Scenario: No groups configured
- **WHEN** 尚未設定任何組別
- **THEN** 學生頁面顯示「老師尚未設定組別」而非空白清單

#### Scenario: Synchronize phase updates
- **WHEN** server 推送 phase 事件
- **THEN** 已進場學生頁面更新為事件中的階段

#### Scenario: Older response does not revert a newer phase event
- **WHEN** 學生進場後送出的進場或 session 請求尚未回應時，老師開始搶答且學生先收到 phase 事件「搶答中」，之後才收到帶著「準備中」的回應
- **THEN** 學生頁面維持「搶答中」並停留在作答區，不回到等待畫面

#### Scenario: Show reconnecting after missed events
- **WHEN** 連線超過 40 秒未收到任何 phase 或 heartbeat 事件
- **THEN** 學生頁面顯示「重新連線中」並依 SSE 重連及 session 摘要恢復
