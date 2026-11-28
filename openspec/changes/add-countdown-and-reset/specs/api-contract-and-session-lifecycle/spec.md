# Spec Delta

## MODIFIED Requirements

### Requirement: Server provides the authoritative session summary
server SHALL 提供目前活動階段、題數、組數、倒數結束時間與 server 時間摘要，並以單一權威狀態作為所有連線端查詢結果的來源。沒有進行中的倒數時，倒數結束時間 SHALL 為空值。

#### Scenario: Read session summary
- **WHEN** 用戶端查詢活動摘要
- **THEN** 回應包含目前階段、題數、組數與 server 時間，且資料來自 server 權威狀態

#### Scenario: Summary during a countdown
- **WHEN** 老師以 60 秒倒數開始搶答後，用戶端查詢活動摘要
- **THEN** 回應的倒數結束時間為開始時的 server 時間加 60 秒

#### Scenario: Summary without a countdown
- **WHEN** 活動在準備中、已結束，或搶答中但開始時沒有設定倒數
- **THEN** 回應的倒數結束時間為空值

### Requirement: Session lifecycle moves forward only
活動階段 SHALL 僅能由準備中進入搶答中，再進入已結束；唯一的例外是老師在已結束後重設活動回到準備中（見「Teacher resets the activity after it ends」）。任何寫入端點 SHALL 在 server 檢查階段是否允許該操作。階段控制端點 SHALL 只接受已登入老師的請求（見 `teacher-auth`），不再以 loopback 來源判定權限。

#### Scenario: Start session
- **WHEN** 已登入老師在準備中要求開啟活動，且已有組別與題目
- **THEN** 活動進入搶答中並發布階段變化

#### Scenario: Reject backward transition
- **WHEN** 用戶端要求將搶答中或已結束活動退回較早階段，且不是透過重設端點
- **THEN** server 拒絕要求並回傳一致格式的 JSON 錯誤

#### Scenario: Reject non-loopback control request
- **WHEN** 非 loopback 來源呼叫階段控制端點
- **THEN** server 依老師登入判斷權限：未登入回傳 `401 TEACHER_AUTH_REQUIRED` 且階段不變，已登入則照常檢查階段

#### Scenario: Reject control request without teacher login
- **WHEN** 未登入的請求呼叫階段控制端點，即使來源是 loopback
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，階段不變

## ADDED Requirements

### Requirement: Starting accepts an optional countdown
開始搶答 SHALL 可選擇帶倒數秒數（D15）。沒有帶時活動不倒數，只在老師結束時結束。有帶時 SHALL 為 10 至 3600 的整數（D20）；不符合時 server SHALL 回傳 `400 COUNTDOWN_OUT_OF_RANGE`，說明允許範圍，階段維持準備中且不發布階段變化。倒數檢查 SHALL 在階段、組別與題目檢查之後進行。

#### Scenario: Start with a countdown
- **WHEN** 已登入老師在準備中以 `countdownSeconds: 60` 開始搶答，且已有組別與題目
- **THEN** 活動進入搶答中，階段事件與活動摘要都帶有倒數結束時間

#### Scenario: Start without a countdown
- **WHEN** 已登入老師開始搶答時沒有帶倒數秒數
- **THEN** 活動進入搶答中，倒數結束時間為空值

#### Scenario: Countdown out of range
- **WHEN** 老師以 `countdownSeconds: 5`、`3601` 或 `30.5` 開始搶答
- **THEN** server 回傳 `400 COUNTDOWN_OUT_OF_RANGE`，訊息說明需介於 10 秒到 60 分鐘，階段維持準備中

### Requirement: The countdown ends the session automatically
倒數歸零時，server SHALL 自動讓活動進入已結束，效果與老師結束搶答相同：發布階段變化，且之後的送出被拒絕。老師在歸零前結束時，倒數 SHALL 停止。倒數歸零與老師結束同時發生時，活動 SHALL 只結束一次，老師的結束請求 SHALL 得到與重複結束相同的結果。階段事件 SHALL 帶有倒數結束時間與 server 時間，讓各端顯示的剩餘時間相差不超過 1 秒。

#### Scenario: Countdown reaches zero
- **WHEN** 老師以 10 秒倒數開始搶答，期間沒有人結束
- **THEN** 開始後約 10 秒，活動進入已結束，所有已連線端在 2 秒內收到階段變化

#### Scenario: Teacher ends before zero
- **WHEN** 倒數進行中老師結束搶答
- **THEN** 活動立即進入已結束，倒數結束時間變為空值，之後倒數時間到也不再發布階段變化

#### Scenario: Submission after the countdown ends
- **WHEN** 倒數歸零後學生送出答案
- **THEN** server 以 `409 SUBMISSION_NOT_ALLOWED` 拒絕

#### Scenario: Countdown and manual end at the same time
- **WHEN** 倒數歸零的同時老師送出結束請求
- **THEN** 階段只變成已結束一次，只發布一次階段變化

### Requirement: Teacher resets the activity after it ends
已登入老師 SHALL 能在已結束時重設活動（D19）。重設後階段 SHALL 回到準備中並發布階段變化。server SHALL 清空本場作答（含已作廢）、所有學生進場紀錄、倒數與本場活動識別；SHALL 保留組別、已匯入的題目與學習單來源，以及老師登入狀態。準備中或搶答中呼叫重設時，server SHALL 回傳 `409 INVALID_PHASE_TRANSITION`，資料不變。

#### Scenario: Reset after the activity ends
- **WHEN** 已登入老師在已結束時重設活動
- **THEN** 階段變為準備中，組別與題目數量不變，老師端監看沒有任何作答，老師不需要重新登入

#### Scenario: Reset outside the ended phase
- **WHEN** 已登入老師在準備中或搶答中呼叫重設
- **THEN** server 回傳 `409 INVALID_PHASE_TRANSITION`，階段與資料不變

#### Scenario: Reset without login
- **WHEN** 未登入的請求呼叫重設
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，階段與資料不變

#### Scenario: Start again after a reset
- **WHEN** 重設後老師再次開始搶答
- **THEN** 新一場活動有新的活動識別，各題從第一個送出重新排順位，前一場的作答不會出現在監看或結果中

### Requirement: Connected students are told about a reset
重設時，server SHALL 對每個以學生身分連線的事件串流送出 `reset` 事件，然後關閉該串流；`reset` 事件 SHALL NOT 包含任何作答或組別資訊。老師與尚未進場的連線 SHALL 只收到一般的階段變化，連線保持開啟。

#### Scenario: Connected student receives reset
- **WHEN** 已進場學生的事件串流開啟中，老師重設活動
- **THEN** 該串流在 2 秒內收到 `reset` 事件，隨後被 server 關閉

#### Scenario: Reconnect after reset
- **WHEN** 被關閉的學生串流以原學生識別碼重新連線
- **THEN** server 以「學生沒有有效進場紀錄」拒絕，學生需重新選組

#### Scenario: Teacher connection stays open
- **WHEN** 老師的事件串流開啟中，老師重設活動
- **THEN** 老師串流收到階段變為準備中，連線不被關閉
