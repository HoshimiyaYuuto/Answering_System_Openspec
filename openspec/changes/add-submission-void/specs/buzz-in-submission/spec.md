# Spec Delta

## MODIFIED Requirements

### Requirement: Each group submits at most once per question
每組每題 SHALL 同時最多只有一筆有效作答；同組任一裝置成功提交後，同組再次提交同題 SHALL 被拒絕，已提交的答案不得被學生修改。只有在該組該題的有效作答被老師作廢後，該組 SHALL 能再次提交該題，重送為新的一筆作答。

#### Scenario: Lock a submitted question for the group
- **WHEN** 同組任一有效進場學生已成功提交某題，同組另一位學生再次提交該題
- **THEN** server 回 `409 ALREADY_SUBMITTED`，原答案與送出時間不變

#### Scenario: Two devices of one group submit the same question at the same time
- **WHEN** 同組兩個裝置同時提交同一題
- **THEN** 只有一筆成為有效作答，另一筆回 `409 ALREADY_SUBMITTED`

#### Scenario: Different groups submit independently
- **WHEN** 不同組別各自提交同一題
- **THEN** 每組各有一筆有效作答，互不影響

#### Scenario: Resubmit after the teacher voids
- **WHEN** 老師作廢第 2 組第 1 題的有效作答後，第 2 組再次提交第 1 題
- **THEN** server 接受並建立新的一筆有效作答，被作廢的作答仍保留為已作廢

#### Scenario: Two devices resubmit at the same time after a void
- **WHEN** 作廢後同組兩個裝置同時重送同一題
- **THEN** 只有一筆成為有效作答，另一筆回 `409 ALREADY_SUBMITTED`

### Requirement: Students can read only their own group submission state
server SHALL 提供以有效 `studentId` 查詢所屬組別作答狀態的端點，任何階段皆可查詢；回應 SHALL 包含該組目前有效作答的 `questionId`、答案與送出時間，以及該組作答已被作廢且尚未重送的題目（題號與作廢時間）。回應 SHALL NOT 包含順位或任何他組資訊。

#### Scenario: Read own group state after reload
- **WHEN** 有效進場學生重新整理後查詢組別狀態
- **THEN** 回應包含其所屬組別已提交的題目與答案，包括由同組其他裝置提交的題目

#### Scenario: No submissions exist for the group
- **WHEN** 有效進場學生所屬組尚未提交任何題目
- **THEN** server 回傳空的作答清單與空的已作廢清單

#### Scenario: State reveals nothing about other groups
- **WHEN** 其他組別已提交同一題
- **THEN** 本組狀態回應中不出現他組作答、順位、數量或某題已被搶走的任何線索

#### Scenario: Voided question waiting for resubmission
- **WHEN** 老師作廢本組第 1 題後，本組學生查詢組別狀態
- **THEN** 作答清單不含第 1 題，已作廢清單含第 1 題與作廢時間

#### Scenario: Resubmitted question leaves the voided list
- **WHEN** 本組第 1 題被作廢後已重送成功
- **THEN** 作答清單含重送的答案，已作廢清單不含第 1 題

### Requirement: Submission updates are delivered only to the submitting group
`GET /api/events` SHALL 接受可選的 `studentId` 參數；帶有有效進場 `studentId` 的連線除了階段與心跳事件外，SHALL 額外收到其所屬組別的 `submission` 事件與 `void` 事件。`submission` 事件內容為 `{ questionId, answers, submittedAt }`，`void` 事件內容為 `{ questionId, voidedAt }`，兩者都不含順位。組別 SHALL 在送出事件時依該學生目前的進場狀態查詢。公開階段事件、未帶 `studentId` 的連線與 `GET /api/session` SHALL NOT 包含作答資料、提交數量或可推出他組狀況的資訊。帶了 `studentId` 但沒有有效進場的連線 SHALL 以契約格式錯誤拒絕。

#### Scenario: Notify the same group about a submission
- **WHEN** 某組成功提交答案，且同組另一裝置以有效 `studentId` 訂閱事件
- **THEN** 該裝置在 2 秒內收到含該題答案與送出時間的 `submission` 事件

#### Scenario: Notify the group about a void
- **WHEN** 老師作廢某組第 1 題，且該組裝置以有效 `studentId` 訂閱事件
- **THEN** 該裝置在 2 秒內收到 `questionId` 為 1 且含作廢時間的 `void` 事件，內容不含順位

#### Scenario: Other groups receive nothing
- **WHEN** 某組成功提交答案或某組作答被作廢
- **THEN** 其他組的連線與未帶 `studentId` 的連線都不會收到任何與該次提交或作廢有關的事件

#### Scenario: Public events and summary disclose nothing
- **WHEN** 其他組學生監聽公開階段事件或查詢 `GET /api/session`
- **THEN** 內容不揭露該組是否提交、答案或提交數量

#### Scenario: Reject an events connection with an invalid entry
- **WHEN** 連線帶了沒有有效進場的 `studentId`
- **THEN** server 以契約格式 JSON 錯誤回應，不建立連線

#### Scenario: Closed connections are released
- **WHEN** 訂閱連線關閉
- **THEN** server 移除該連線，之後的提交不再嘗試送給它
