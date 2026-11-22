# Spec Delta: student-answering-ui

## ADDED Requirements

### Requirement: Student page shows a question grid during the buzzer phase
學生端 SHALL 在進場有效且階段為「搶答中」時顯示題號格，題數與老師匯入的題目一致；每題 SHALL 以文字標示狀態：未作答、草稿或已送出，狀態 SHALL NOT 只靠顏色區分。準備中 SHALL 不顯示任何題目內容。

#### Scenario: Show the grid when the buzzer phase starts
- **WHEN** 已進場的學生所在頁面收到階段變為「搶答中」
- **THEN** 頁面載入題目與本組作答，並顯示題號格，題號為學習單上的題號

#### Scenario: Enter during the buzzer phase
- **WHEN** 學生在階段為「搶答中」時首次進場
- **THEN** 頁面直接顯示題號格

#### Scenario: Question status is shown as text
- **WHEN** 某題尚未作答、有本機草稿，或本組已送出
- **THEN** 題號格以文字分別標示「未作答」、「草稿」、「已送出」

#### Scenario: No question content during preparation
- **WHEN** 階段為「準備中」
- **THEN** 頁面只顯示等待畫面，不顯示題號格或題目內容

### Requirement: Student fills the blanks of one question
點選題號 SHALL 進入該題作答頁，顯示該題每個空格的前綴與提示並各提供一個輸入框；題組 SHALL 依空格順序全部顯示。

#### Scenario: Open a single question
- **WHEN** 學生點選單題的題號
- **THEN** 作答頁顯示一個輸入框與該空格的提示

#### Scenario: Open a question group
- **WHEN** 學生點選題組的題號
- **THEN** 作答頁依 `index` 順序顯示每個空格的前綴、提示與輸入框

#### Scenario: Go back to the grid
- **WHEN** 學生從作答頁返回
- **THEN** 頁面回到題號格，且該題的草稿狀態被保留

### Requirement: Student submits a validated answer
送出前 SHALL 在前端去除每個答案前後空白，並驗證每格長度為 1 至 200 字元，題組 SHALL 所有空格都有內容才能送出；不通過驗證時 SHALL 顯示原因且不呼叫 API。送出請求進行中 SHALL 停用輸入與按鈕。

#### Scenario: Submit a valid answer
- **WHEN** 學生填寫所有空格並送出
- **THEN** 頁面送出去除前後空白的答案，請求期間輸入與按鈕停用

#### Scenario: Reject blank or too long answers
- **WHEN** 任一空格去除前後空白後為空，或超過 200 字元
- **THEN** 頁面在該空格旁顯示原因，不呼叫 API，並保留輸入內容

#### Scenario: Reject an incomplete question group
- **WHEN** 題組有任一空格沒有填寫就送出
- **THEN** 頁面顯示需填寫所有空格，且不呼叫 API

### Requirement: A submitted question is locked and synchronized across the group
送出成功後該題 SHALL 鎖定並顯示「已送出」與送出的答案；同組其他裝置 SHALL 在 2 秒內收到 `submission` 事件並將該題同步鎖定。已鎖定的題目 SHALL NOT 提供修改或再次送出。

#### Scenario: Lock after a successful submission
- **WHEN** 送出請求回傳成功
- **THEN** 該題顯示「已送出」與送出的答案，輸入框與送出按鈕不可用，草稿被清除

#### Scenario: Same group device is updated
- **WHEN** 同組另一個裝置成功送出某題，且本裝置正連著事件
- **THEN** 本裝置在 2 秒內將該題標為「已送出」並顯示該答案；若正在作答該題，輸入框鎖定

#### Scenario: Duplicate submission by the same group
- **WHEN** 送出被伺服器以「本組已提交」拒絕
- **THEN** 頁面重新讀取本組作答，顯示本組已送出的答案並說明由其他裝置送出

#### Scenario: Events are applied idempotently
- **WHEN** 同一題的 `submission` 事件重複抵達，或自己的送出成功後又收到同一事件
- **THEN** 題目狀態與顯示內容不變

### Requirement: Drafts stay on the student's device
學生輸入 SHALL 在本機保存為草稿並於重新整理後恢復，送出成功或該題被標為已送出後 SHALL 清除；草稿 SHALL NOT 送到 server，也不跨裝置。草稿的空格數與題目不符時 SHALL 丟棄。`localStorage` 不可用時 SHALL 降級為只在記憶體保存且不顯示錯誤。

#### Scenario: Restore a draft after refresh
- **WHEN** 學生輸入部分答案後重新整理頁面並再次進入該題
- **THEN** 輸入框恢復先前的內容，題號格標示「草稿」

#### Scenario: Clear the draft after submission
- **WHEN** 該題送出成功
- **THEN** 該題的草稿被刪除

#### Scenario: Discard a mismatched draft
- **WHEN** 儲存的草稿長度與該題目前的空格數不同
- **THEN** 頁面不使用該草稿

#### Scenario: Storage is unavailable
- **WHEN** 瀏覽器不允許使用 `localStorage`
- **THEN** 作答仍可進行，草稿只在本次頁面存在，且不顯示錯誤

### Requirement: The page never reveals other groups or ranks
搶答中學生端的畫面與前端狀態 SHALL 只包含本組資料；SHALL NOT 顯示順位、他組是否已送出或題目是否已被搶走。

#### Scenario: Other groups submit
- **WHEN** 其他組別提交答案
- **THEN** 本組畫面沒有任何變化

#### Scenario: Own submission shows no rank
- **WHEN** 本組送出成功或讀取本組作答
- **THEN** 畫面不顯示順位或任何與他組比較的資訊

### Requirement: The page recovers after refresh or reconnection
重新整理或即時連線中斷後恢復 SHALL 回到原組別、目前階段與本組已送出的答案；連線超過 40 秒沒有事件 SHALL 顯示「重新連線中…」；伺服器 10 秒內沒有回應的送出 SHALL 顯示「伺服器沒有回應」並允許重試。

#### Scenario: Refresh during the buzzer phase
- **WHEN** 學生在搶答中重新整理頁面
- **THEN** 頁面回到原組別的題號格，本組已送出的題目顯示為「已送出」

#### Scenario: Reconnect after a network interruption
- **WHEN** 即時連線中斷後恢復
- **THEN** 頁面重新讀取階段與本組作答，補上中斷期間遺漏的同組送出

#### Scenario: Server does not respond to a submission
- **WHEN** 送出請求 10 秒內沒有回應
- **THEN** 頁面顯示「伺服器沒有回應」，保留輸入並允許重試

#### Scenario: Retry finds the answer already recorded
- **WHEN** 重試送出得到「本組已提交」
- **THEN** 頁面視為已送出並顯示伺服器記錄的答案

### Requirement: The student connection carries the student identity
學生進場成功後 SHALL 以帶有 `studentId` 的即時連線接收階段與同組作答事件；換組或進場失效時 SHALL 關閉該連線。連線被伺服器以進場失效拒絕時 SHALL 重新確認進場狀態，無效則回到選組畫面。

#### Scenario: Connect after entry
- **WHEN** 學生進場成功或重新整理後恢復進場
- **THEN** 頁面建立帶 `studentId` 的即時連線，並仍然收到階段事件

#### Scenario: Connection rejected because the entry is invalid
- **WHEN** 即時連線因進場無效被拒絕
- **THEN** 頁面重新確認進場，無效時回到選組畫面並說明原因，有效時重新建立連線

#### Scenario: Server restart invalidates entries
- **WHEN** 伺服器重新啟動使進場紀錄失效
- **THEN** 學生頁面回到選組畫面並說明進場狀態已失效，既有草稿不被刪除

### Requirement: Answering is closed when the activity ends
階段變為「已結束」時學生端 SHALL 顯示「活動已結束」，並停用所有輸入與送出；進行中的輸入 SHALL NOT 被送出。

#### Scenario: Phase becomes ended while answering
- **WHEN** 學生正在作答時收到階段變為「已結束」
- **THEN** 頁面顯示「活動已結束」，輸入與送出按鈕停用，未送出的輸入保留為草稿

#### Scenario: Submission rejected because the activity ended
- **WHEN** 送出被伺服器以「目前階段不允許提交」拒絕
- **THEN** 頁面重新確認階段，並在已結束時顯示「活動已結束」
