# Spec Delta: buzz-in-submission

## Purpose

學生在搶答中與結束後讀取公開題目、以組別送出整題答案並取得本組的送出狀態；server 以原子方式給出每題唯一的接收順位，且不向學生或公開通道洩露他組的作答進度或順位。

## ADDED Requirements

### Requirement: Students read public question blanks after the session starts
server SHALL 提供學生題目端點，僅在「搶答中」與「已結束」回傳每題的 `id` 與 `blanks`；回應 SHALL NOT 包含題目層 `prompt`、儲存格位置、原始檔內容或其他內部匯入資料。「準備中」SHALL 拒絕並回傳契約格式錯誤，不回傳任何題目。

#### Scenario: Read questions while buzzing
- **WHEN** 活動為「搶答中」且有效進場學生讀取公開題目
- **THEN** 每題只包含 `id` 與 `blanks`，題目層敘述及儲存格位置不出現在回應

#### Scenario: Read questions after the session ends
- **WHEN** 活動為「已結束」且有效進場學生讀取公開題目
- **THEN** server 回傳與搶答中相同形狀的題目

#### Scenario: Questions are unavailable during preparation
- **WHEN** 活動為「準備中」時學生讀取公開題目
- **THEN** server 回 `409 QUESTIONS_NOT_AVAILABLE`，且不回傳題目

#### Scenario: No imported questions
- **WHEN** 活動為「搶答中」但尚無題目
- **THEN** server 回傳空的題目清單

### Requirement: Only validly entered students can use student submission APIs
題目、提交及本人組別狀態 API SHALL 僅接受具有有效進場紀錄的 `studentId`；有效性判斷 SHALL 與 `GET /api/student/entry` 回傳 `valid:true` 的條件相同，並沿用同一判斷函式。各端點 SHALL 依「`studentId` 格式、有效進場、階段、內容」的順序檢查。

#### Scenario: Accept a valid entry
- **WHEN** 請求所帶 `studentId` 的進場紀錄有效
- **THEN** server 依其目前所屬組別處理請求

#### Scenario: Reject an entry that is missing or removed
- **WHEN** `studentId` 沒有有效進場紀錄，包括所屬組別已移除或 server 重啟後進場紀錄消失
- **THEN** server 回 `403 STUDENT_NOT_ENTERED` 並拒絕題目、提交及組別狀態請求

#### Scenario: Reject malformed student id
- **WHEN** `studentId` 格式不符
- **THEN** server 回 `400 INVALID_STUDENT_ID`

#### Scenario: Entry is checked before phase
- **WHEN** 沒有有效進場的 `studentId` 在非「搶答中」階段提交
- **THEN** server 回 `403 STUDENT_NOT_ENTERED`，而不是階段錯誤

### Requirement: Students submit a complete answer for one question
學生 SHALL 能為一題提交整題答案；`answers` 須為該題所有空格各一個字串，依 `blanks` 的 `index` 順序排列。每個答案去除前後空白後長度 SHALL 為 1 至 200 字元，server 不判斷答案正確性。提交只能在「搶答中」進行。

#### Scenario: Submit a single-blank question
- **WHEN** 有效進場學生於「搶答中」提交單題（一個空格）的非空答案
- **THEN** server 記錄去除前後空白後的答案與 server 產生的 UTC 送出時間，並回傳成功 envelope

#### Scenario: Submit a question group
- **WHEN** 有效進場學生於「搶答中」提交題組所有空格的非空答案
- **THEN** 整題視為一筆作答並一起取得順位

#### Scenario: Reject an incomplete question group
- **WHEN** 題組提交缺少任一空格的答案
- **THEN** server 回 `400 INVALID_ANSWER` 且不建立作答紀錄

#### Scenario: Reject invalid answer content
- **WHEN** 答案不是陣列、含非字串、去除前後空白後為空，或超過 200 字元
- **THEN** server 回 `400 INVALID_ANSWER` 且不建立作答紀錄

#### Scenario: Reject an unknown question
- **WHEN** `questionId` 不是任何題目的 `id`
- **THEN** server 回 `404 QUESTION_NOT_FOUND`

#### Scenario: Reject submission outside the buzzer phase
- **WHEN** 活動為「準備中」或「已結束」時提交答案
- **THEN** server 回 `409 SUBMISSION_NOT_ALLOWED` 且不記錄答案

### Requirement: Each group submits at most once per question
每組每題 SHALL 僅有一筆有效作答；同組任一裝置成功提交後，同組再次提交同題 SHALL 被拒絕，已提交的答案不得被學生修改。

#### Scenario: Lock a submitted question for the group
- **WHEN** 同組任一有效進場學生已成功提交某題，同組另一位學生再次提交該題
- **THEN** server 回 `409 ALREADY_SUBMITTED`，原答案與送出時間不變

#### Scenario: Two devices of one group submit the same question at the same time
- **WHEN** 同組兩個裝置同時提交同一題
- **THEN** 只有一筆成為有效作答，另一筆回 `409 ALREADY_SUBMITTED`

#### Scenario: Different groups submit independently
- **WHEN** 不同組別各自提交同一題
- **THEN** 每組各有一筆有效作答，互不影響

### Requirement: Server assigns unique per-question receipt ranks atomically
server SHALL 依收到順序為每題的有效作答指定從 1 開始、不重複、不重用的順位，各題順位獨立。查重、寫入與取得順位 SHALL 在同一個同步區段完成，其間不得有 `await`。順位 SHALL 只保存在 server 內部，本能力的任何學生端回應與事件都 SHALL NOT 包含順位。

#### Scenario: Concurrent submissions receive distinct ranks
- **WHEN** 100 組同時提交同一題
- **THEN** 100 筆作答的順位恰為 1 至 100，沒有重複或缺號

#### Scenario: Ranks are independent per question
- **WHEN** 同一組依序提交兩個不同題目
- **THEN** 兩題各自的順位計數互不影響

#### Scenario: Submission success reveals no rank
- **WHEN** 提交成功
- **THEN** 成功回應只含 `questionId` 與 `submittedAt`，不含順位、他組提交狀態或任何可推出他組狀況的資訊

#### Scenario: Server-internal read of submissions
- **WHEN** server 內部程式讀取提交清單
- **THEN** 每筆作答含題目、組別、答案、送出時間、順位與狀態，供測試與之後的教師端使用，不經由學生端 API 提供

### Requirement: Students can read only their own group submission state
server SHALL 提供以有效 `studentId` 查詢所屬組別作答狀態的端點，任何階段皆可查詢；回應 SHALL 只包含該組已提交題目的 `questionId`、答案與送出時間，SHALL NOT 包含順位或任何他組資訊。

#### Scenario: Read own group state after reload
- **WHEN** 有效進場學生重新整理後查詢組別狀態
- **THEN** 回應包含其所屬組別已提交的題目與答案，包括由同組其他裝置提交的題目

#### Scenario: No submissions exist for the group
- **WHEN** 有效進場學生所屬組尚未提交任何題目
- **THEN** server 回傳空的作答清單

#### Scenario: State reveals nothing about other groups
- **WHEN** 其他組別已提交同一題
- **THEN** 本組狀態回應中不出現他組作答、順位、數量或某題已被搶走的任何線索

### Requirement: Submission updates are delivered only to the submitting group
`GET /api/events` SHALL 接受可選的 `studentId` 參數；帶有有效進場 `studentId` 的連線除了階段與心跳事件外，SHALL 額外收到其所屬組別的 `submission` 事件，事件內容為 `{ questionId, answers, submittedAt }`，不含順位。組別 SHALL 在送出事件時依該學生目前的進場狀態查詢。公開階段事件、未帶 `studentId` 的連線與 `GET /api/session` SHALL NOT 包含作答資料、提交數量或可推出他組狀況的資訊。帶了 `studentId` 但沒有有效進場的連線 SHALL 以契約格式錯誤拒絕。

#### Scenario: Notify the same group about a submission
- **WHEN** 某組成功提交答案，且同組另一裝置以有效 `studentId` 訂閱事件
- **THEN** 該裝置在 2 秒內收到含該題答案與送出時間的 `submission` 事件

#### Scenario: Other groups receive nothing
- **WHEN** 某組成功提交答案
- **THEN** 其他組的連線與未帶 `studentId` 的連線都不會收到任何與該次提交有關的事件

#### Scenario: Public events and summary disclose nothing
- **WHEN** 其他組學生監聽公開階段事件或查詢 `GET /api/session`
- **THEN** 內容不揭露該組是否提交、答案或提交數量

#### Scenario: Reject an events connection with an invalid entry
- **WHEN** 連線帶了沒有有效進場的 `studentId`
- **THEN** server 以契約格式 JSON 錯誤回應，不建立連線

#### Scenario: Closed connections are released
- **WHEN** 訂閱連線關閉
- **THEN** server 移除該連線，之後的提交不再嘗試送給它

### Requirement: Development question seed includes blanks
僅在 `NODE_ENV` 為 `development` 時，server 的 50 題開發種子 SHALL 每題提供題目識別碼、題目層敘述及符合匯入格式的 `blanks`；其他環境 SHALL 不啟用此種子。

#### Scenario: Development seed supports the public question shape
- **WHEN** server 以 development 環境啟動
- **THEN** 50 題種子每題均含 `id`、`prompt` 與 `blanks`，其中至少一題為多空格題組

#### Scenario: Other environments do not seed questions
- **WHEN** server 以非 development 環境啟動
- **THEN** 開發題目種子未啟用，題數為 0
