# Spec Delta

## MODIFIED Requirements

### Requirement: Student page shows a question grid during the buzzer phase
學生端 SHALL 在進場有效且階段為「搶答中」時顯示題號格，題數與老師匯入的題目一致；每題 SHALL 以文字標示狀態：未作答、草稿、已送出，或已作廢可重新送出，狀態 SHALL NOT 只靠顏色區分。準備中 SHALL 不顯示任何題目內容。

#### Scenario: Show the grid when the buzzer phase starts
- **WHEN** 已進場的學生所在頁面收到階段變為「搶答中」
- **THEN** 頁面載入題目與本組作答，並顯示題號格，題號為學習單上的題號

#### Scenario: Enter during the buzzer phase
- **WHEN** 學生在階段為「搶答中」時首次進場
- **THEN** 頁面直接顯示題號格

#### Scenario: Question status is shown as text
- **WHEN** 某題尚未作答、有本機草稿、本組已送出，或本組作答已被老師作廢且尚未重送
- **THEN** 題號格以文字分別標示「未作答」、「草稿」、「已送出」、「已作廢，可重新送出」

#### Scenario: No question content during preparation
- **WHEN** 階段為「準備中」
- **THEN** 頁面只顯示等待畫面，不顯示題號格或題目內容

## ADDED Requirements

### Requirement: A voided question is unlocked for resubmission
學生頁收到本組某題的作廢通知，或讀到本組作答狀態中列為已作廢的題目時，SHALL 將該題從已送出改為可作答，並說明作答已被老師作廢、可以重新送出。本機記得的舊作答 SHALL NOT 讓已作廢的題目維持鎖定。作廢提示 SHALL NOT 顯示順位或任何他組資訊。

#### Scenario: Void event while viewing the grid
- **WHEN** 搶答中本組第 1 題已送出，學生停在題號格，頁面收到第 1 題的作廢通知
- **THEN** 2 秒內第 1 題的文字狀態變為「已作廢，可重新送出」

#### Scenario: Void event while viewing the question
- **WHEN** 學生正在看已送出的第 1 題，頁面收到第 1 題的作廢通知
- **THEN** 作答頁立即顯示作答已被老師作廢、可重新送出，輸入框與送出按鈕可以使用

#### Scenario: Voided state survives refresh and resynchronization
- **WHEN** 第 1 題被作廢後學生重新整理頁面，或即時連線中斷後重新同步
- **THEN** 第 1 題顯示「已作廢，可重新送出」且可以作答，即使頁面原本記著第 1 題已送出

#### Scenario: Notice reveals nothing about other groups
- **WHEN** 本組第 1 題被作廢
- **THEN** 頁面不顯示順位、他組是否已送出或第 1 題目前的勝者

### Requirement: Resubmission clears the void notice
已作廢的題目重新送出成功後，學生頁 SHALL 將該題恢復為已送出並鎖定，移除作廢提示。同組其他裝置 SHALL 在收到該題的送出通知後得到相同結果。

#### Scenario: Resubmit from this device
- **WHEN** 學生在已作廢的第 1 題填寫答案並送出成功
- **THEN** 第 1 題顯示「已送出」與重送的答案，作廢提示消失

#### Scenario: Resubmitted from another device of the group
- **WHEN** 同組另一個裝置重送第 1 題成功，本裝置正連著事件
- **THEN** 本裝置在 2 秒內將第 1 題標為「已送出」並顯示重送的答案，作廢提示消失

#### Scenario: A late snapshot does not undo a newer state
- **WHEN** 頁面收到作廢通知後，才收到一份在作廢前就發出請求的本組作答狀態
- **THEN** 第 1 題仍維持已作廢、可重新送出
