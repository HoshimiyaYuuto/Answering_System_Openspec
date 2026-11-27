# Spec Delta

## Purpose

讓已登入老師在搶答中作廢某組某題的作答（共同契約 D24），被作廢的作答保留紀錄但不再計入結果，該組可重新送出，且作廢只通知老師與該組。

## ADDED Requirements

### Requirement: Teacher voids a valid submission while buzzing
系統 SHALL 提供需老師登入的作廢端點，以題號與該筆作答的接收順位指定要作廢的作答。只有「搶答中」可以作廢，且只能作廢目前有效的作答。未登入 SHALL 回 401 `TEACHER_AUTH_REQUIRED`。被拒絕的請求 SHALL NOT 改變任何作答紀錄，也 SHALL NOT 發出任何事件。

#### Scenario: Void a submission
- **WHEN** 搶答中第 1 題第 2 組的作答順位為 1，老師作廢第 1 題順位 1
- **THEN** server 回傳成功，內容含題號、組別、順位與作廢時間，該筆作答變為已作廢

#### Scenario: Not logged in
- **WHEN** 未登入者呼叫作廢端點
- **THEN** server 回 401 `TEACHER_AUTH_REQUIRED`，作答紀錄不變

#### Scenario: Outside the buzzing phase
- **WHEN** 活動為「準備中」或「已結束」時老師呼叫作廢
- **THEN** server 回 409 `VOID_NOT_ALLOWED`，作答紀錄不變

#### Scenario: Malformed request
- **WHEN** 題號或順位不是正整數
- **THEN** server 回 400 `INVALID_VOID_REQUEST`

#### Scenario: Unknown question
- **WHEN** 題號不是任何題目的題號
- **THEN** server 回 404 `QUESTION_NOT_FOUND`

#### Scenario: No submission with that rank
- **WHEN** 該題沒有指定順位的作答
- **THEN** server 回 404 `SUBMISSION_NOT_FOUND`

#### Scenario: Already voided
- **WHEN** 老師作廢一筆已作廢的作答，例如連按兩次作廢
- **THEN** server 回 409 `ALREADY_VOIDED`，該組之後重送的作答不受影響

### Requirement: Voided submissions are kept and stop counting
作廢 SHALL 只把該筆作答改為已作廢並記錄 server 產生的 UTC 作廢時間，SHALL NOT 刪除紀錄或改變其答案、送出時間與順位。已作廢的作答 SHALL NOT 計入搶答成功、送出組數、判定結果、學生結果、CSV、xlsx 匯出與寫回。老師監看 SHALL 繼續列出它並標示已作廢。

#### Scenario: Winner moves to the next valid submission
- **WHEN** 第 1 題第 2 組（順位 1）與第 5 組（順位 2）都已送出，老師作廢順位 1
- **THEN** 判定結果的勝者變為第 5 組，老師監看中第 2 組顯示已作廢且沒有名次，已送出組數為 1

#### Scenario: Voided record remains visible to the teacher
- **WHEN** 作廢後老師查詢監看
- **THEN** 該筆作答仍列出，保留原答案與送出時間，狀態為已作廢

### Requirement: The voided group may resubmit
作廢後被作廢的組別 SHALL 能再次送出同一題。重送是新的一筆有效作答，其順位 SHALL 為該題目前最大順位加 1，其他組的順位 SHALL NOT 改變，被作廢的順位號碼 SHALL NOT 重用。

#### Scenario: Resubmission ranks after existing submissions
- **WHEN** 第 1 題已有順位 1 到 3，老師作廢第 2 組的順位 1，第 2 組重送
- **THEN** 重送成功且順位為 4，原順位 2、3 的作答不變

#### Scenario: Other groups are still locked
- **WHEN** 老師作廢第 2 組第 1 題後，已送出第 1 題的第 3 組再次送出第 1 題
- **THEN** server 回 409 `ALREADY_SUBMITTED`

### Requirement: Void notifications reach only the teacher and the voided group
作廢成功後，系統 SHALL 在 2 秒內通知已登入老師的連線「監看資料已改變」，並通知被作廢組別的學生連線該題已作廢。給學生的通知 SHALL 只含題號與作廢時間，不含順位。其他組的連線、未帶 `studentId` 的連線與 `GET /api/session` SHALL NOT 收到任何與該次作廢有關的資訊。

#### Scenario: Teacher and voided group are notified
- **WHEN** 老師作廢第 2 組第 1 題，老師與第 2 組學生都已連線即時事件
- **THEN** 2 秒內老師連線收到監看通知，第 2 組連線收到第 1 題的作廢通知

#### Scenario: Other groups learn nothing
- **WHEN** 老師作廢第 2 組第 1 題
- **THEN** 第 3 組學生連線與未帶參數的公開連線都沒有收到任何與該次作廢有關的事件

### Requirement: Console offers void during buzzing
老師控制台的作答監看在「搶答中」SHALL 於每筆有效作答旁提供「作廢」操作。按下後 SHALL 先顯示包含組別與題號的確認，老師取消時 SHALL NOT 送出請求。作廢失敗時 SHALL 顯示錯誤訊息。非「搶答中」與已作廢的作答 SHALL NOT 顯示作廢操作。

#### Scenario: Confirm and void
- **WHEN** 搶答中老師展開第 1 題，按下第 2 組的「作廢」並確認
- **THEN** 2 秒內第 2 組在第 1 題顯示已作廢，已送出組數減 1

#### Scenario: Cancel the confirmation
- **WHEN** 老師按下「作廢」後在確認時取消
- **THEN** 不送出作廢請求，畫面不變

#### Scenario: No void action after the session ends
- **WHEN** 活動為「已結束」
- **THEN** 監看畫面沒有任何「作廢」操作
