# Spec Delta

## Purpose

讓已登入老師在搶答中即時看到每題各組的送出狀態、答案與名次，並在活動結束後看到每題的搶答成功組別與答案，名次與勝者與其他功能使用同一份判定結果。

## ADDED Requirements

### Requirement: Teacher reads per-question submission status for every group
系統 SHALL 提供需老師登入的監看查詢，任何階段都可使用。回應 SHALL 依題號列出每一題的題目內容，以及每一組在該題的狀態（未送出、已送出、已作廢）；已送出與已作廢的組別 SHALL 附上答案與送出時間。未登入時 SHALL 回 401 `TEACHER_AUTH_REQUIRED`。

#### Scenario: Groups that have not submitted
- **WHEN** 搶答中有 3 組，只有第 1 組送出第 1 題，老師查詢監看
- **THEN** 第 1 題中第 1 組為已送出並附答案與送出時間，第 2、3 組為未送出

#### Scenario: Monitoring before the session starts
- **WHEN** 準備中老師查詢監看
- **THEN** 每題每組都是未送出，查詢成功

#### Scenario: Not logged in
- **WHEN** 未登入時查詢監看
- **THEN** server 回 401 `TEACHER_AUTH_REQUIRED`

### Requirement: Places and winners come from the shared judged result
監看中每題的名次、勝者、勝者來源與是否判定中 SHALL 與系統共用的判定結果完全相同，監看 SHALL NOT 另行推導。已作廢的作答 SHALL 沒有名次。

#### Scenario: Arrival order
- **WHEN** 第 1 題 A 組先送出、B 組後送出
- **THEN** 監看中 A 組為第 1 名且為勝者，B 組為第 2 名

#### Scenario: Voided submission has no place
- **WHEN** 第 1 題 A 組（順位 1）的作答已作廢，B 組（順位 2）有效
- **THEN** 監看中 A 組為已作廢且沒有名次，B 組為第 1 名且為勝者

#### Scenario: Question without valid submissions
- **WHEN** 第 3 題沒有任何有效作答
- **THEN** 監看中第 3 題沒有勝者

### Requirement: Teacher is notified of submissions in real time
老師以登入身分連線即時事件時，任何一組成功送出後，系統 SHALL 在 2 秒內通知該連線監看資料已改變。通知 SHALL 只送給已登入老師的連線。以老師身分連線但未登入時，SHALL 以 401 `TEACHER_AUTH_REQUIRED` 拒絕且不建立連線。

#### Scenario: Teacher connection receives a change notice
- **WHEN** 老師以登入身分連線即時事件，第 2 組送出第 1 題
- **THEN** 老師連線在 2 秒內收到監看資料已改變的通知

#### Scenario: Unauthenticated teacher connection
- **WHEN** 未登入者以老師身分連線即時事件
- **THEN** server 回 401 `TEACHER_AUTH_REQUIRED`，不建立連線

### Requirement: Students and public channels learn nothing from teacher monitoring
新增老師監看 SHALL NOT 讓學生或未登入者得到任何新資訊：學生端連線、未以老師身分連線的即時事件與 `GET /api/session` SHALL NOT 收到監看通知、送出數量或他組作答資訊。

#### Scenario: Student connection receives no monitoring notice
- **WHEN** 第 1 組學生與未帶參數的公開連線都在監聽即時事件，第 2 組送出答案
- **THEN** 兩條連線都沒有收到任何與該次送出有關的事件

### Requirement: Console shows the monitoring panel while buzzing
老師控制台 SHALL 顯示「作答監看」區塊，依題號每題一列，顯示已送出組數與總組數、第 1 名的組別與答案，並可展開看各組的狀態、答案、送出時間與名次。收到監看通知或活動階段改變時 SHALL 重新讀取並取代畫面內容，且 SHALL 丟棄過期的回應。

#### Scenario: Two groups submit
- **WHEN** 搶答中第 1 組先、第 2 組後送出第 1 題
- **THEN** 2 秒內第 1 題顯示已送出 2 組，第 1 名為第 1 組，展開後第 1 組第 1 名、第 2 組第 2 名

#### Scenario: Out-of-order responses
- **WHEN** 連續兩次重新讀取監看資料，較早的請求比較晚的請求更晚回應
- **THEN** 畫面顯示較晚請求的資料

### Requirement: Console shows results after the session ends
活動為「已結束」時，同一區塊 SHALL 改為「搶答結果」，每題顯示勝者組別與答案；沒有勝者的題目 SHALL 標示「無人作答」。尚在判定中的題目 SHALL 標示「判定中」，不顯示勝者。

#### Scenario: Results shown after ending
- **WHEN** 第 1 題由第 1 組搶答成功，老師結束搶答
- **THEN** 2 秒內區塊標題為「搶答結果」，第 1 題顯示第 1 組與其答案

#### Scenario: Unanswered question in results
- **WHEN** 活動已結束，第 3 題無人作答
- **THEN** 第 3 題顯示「無人作答」

#### Scenario: Question still being judged
- **WHEN** 判定結果中某題尚在判定中
- **THEN** 該題標示「判定中」且不顯示勝者
