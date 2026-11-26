# student-results Specification

## Purpose
提供活動結束後的學生結果查詢與呈現，讓學生查看每題勝者與答案，以及本組的名次、答案和成功狀態；結果僅供有效進場的學生於活動結束後讀取，且不揭露勝者以外的其他組別資料。

## Requirements

### Requirement: Results are available only after the activity ends
server SHALL 提供學生結果端點，僅在階段為「已結束」時回傳結果；「準備中」與「搶答中」SHALL 回傳契約格式錯誤，且不計算、不回傳任何結果內容。

#### Scenario: Read results after the activity ends
- **WHEN** 活動為「已結束」且有效進場的學生讀取結果
- **THEN** server 回 `200` 與每題的結果

#### Scenario: Results are not available during the buzzer phase
- **WHEN** 活動為「搶答中」時學生讀取結果
- **THEN** server 回 `409 RESULTS_NOT_AVAILABLE`，回應不含任何題目的成功組別或答案

#### Scenario: Results are not available during preparation
- **WHEN** 活動為「準備中」時學生讀取結果
- **THEN** server 回 `409 RESULTS_NOT_AVAILABLE`

### Requirement: Only validly entered students can read results
結果端點 SHALL 僅接受具有有效進場紀錄的 `studentId`，有效性判斷 SHALL 與其他學生端點相同並沿用同一個函式；檢查順序 SHALL 為 `studentId` 格式、有效進場、階段。

#### Scenario: Reject malformed student id
- **WHEN** `studentId` 格式不符
- **THEN** server 回 `400 INVALID_STUDENT_ID`

#### Scenario: Reject a student without a valid entry
- **WHEN** `studentId` 沒有有效進場紀錄，包括 server 重啟後進場紀錄消失
- **THEN** server 回 `403 STUDENT_NOT_ENTERED`

#### Scenario: Entry is checked before phase
- **WHEN** 沒有有效進場的 `studentId` 在非「已結束」階段讀取結果
- **THEN** server 回 `403 STUDENT_NOT_ENTERED`，而不是階段錯誤

### Requirement: Results show the winner of each question and the student's own group
每題的結果 SHALL 包含該題搶答成功組別的名稱與答案，以及該學生所屬組別在該題的名次、是否成功與答案；題目 SHALL 依題號由小到大排列；沒有有效作答的題目 `winner` SHALL 為 `null`；所屬組別沒有作答的題目 `own` SHALL 為 `null`。

#### Scenario: Winner and own group are both returned
- **WHEN** 某題有多個組別作答，學生所屬組別名次為第 2
- **THEN** 該題結果包含第 1 名組別的名稱與答案，以及本組名次 2、`isWinner` 為 `false` 與本組答案

#### Scenario: Own group is the winner
- **WHEN** 學生所屬組別是某題的第 1 名
- **THEN** 該題 `own.place` 為 1、`isWinner` 為 `true`，且 `winner` 的名稱與答案是本組的

#### Scenario: Question without any submission
- **WHEN** 某題沒有任何組別提交有效作答
- **THEN** 該題 `winner` 與 `own` 皆為 `null`

#### Scenario: Own group did not answer
- **WHEN** 某題有其他組別作答，但學生所屬組別沒有
- **THEN** 該題 `winner` 有值，`own` 為 `null`

#### Scenario: Question group answers keep blank order
- **WHEN** 某題為題組
- **THEN** `answers` 依空格順序排列，並附上該題的 `blanks`

### Requirement: Results never reveal other groups beyond the winner
結果回應 SHALL NOT 包含任何組別識別碼、任何 `rank` 欄位、他組（勝者除外）的名次或答案，也不得包含題目層 `prompt` 與儲存格位置。

#### Scenario: Other groups are not exposed
- **WHEN** 某題有五個組別作答
- **THEN** 回應中只出現勝者的組名與答案，以及本組的名次與答案，沒有其他三個組別的任何資訊

#### Scenario: No rank or identifier in the response
- **WHEN** 檢查任一成功回應的內容
- **THEN** 內容中不含 `rank`、`groupId`、`placings` 或儲存格位置

### Requirement: Results come from the shared computation
結果 SHALL 由 `computeResults()` 推導，與老師端使用同一份規則；先到先得時，第 1 名為該題 server 接收順序最前的有效作答。

#### Scenario: Winner follows receipt order
- **WHEN** 同題有三個組別依序提交
- **THEN** 先被 server 收到的組別是勝者，名次依接收順序排列

#### Scenario: Voided submissions are ignored
- **WHEN** 某筆作答的狀態不是有效
- **THEN** 該筆不出現在名次與勝者中

### Requirement: The student page shows results after the activity ends
學生頁 SHALL 在階段為「已結束」時讀取並顯示結果：摘要顯示本組成功題數與總題數，每題一列顯示題號、成功組別與答案、本組名次與是否成功；沒有人作答 SHALL 顯示「無人作答」，本組沒有作答 SHALL 顯示「本組未作答」。答案、組名與提示 SHALL 以純文字顯示。搶答中與準備中 SHALL NOT 顯示結果區塊。

#### Scenario: Results appear when the activity ends
- **WHEN** 學生頁正在搶答中，老師結束活動
- **THEN** 頁面顯示「活動已結束」與結果區塊，摘要與每題列依規格顯示

#### Scenario: Refresh after the activity ended
- **WHEN** 學生在已結束後重新整理頁面
- **THEN** 頁面回到原組別並顯示結果

#### Scenario: Question group answers are readable
- **WHEN** 某題為題組
- **THEN** 該題成功答案依空格顯示，並帶有前綴

#### Scenario: Answers are shown as plain text
- **WHEN** 某個答案含有 HTML 標籤字元
- **THEN** 頁面將它當成文字顯示，不執行

#### Scenario: Results are hidden before the end
- **WHEN** 階段為搶答中或準備中
- **THEN** 頁面沒有結果區塊

### Requirement: The results view handles failures and invalid entries
結果讀取失敗 SHALL 顯示「無法載入結果，請稍後再試」並提供重試；進場失效 SHALL 回到選組畫面並說明原因；階段不是已結束 SHALL 重新確認階段並移除結果區塊；已載入的結果 SHALL NOT 因為重複的階段事件而重複讀取。

#### Scenario: Network error while loading results
- **WHEN** 結果請求失敗或逾時
- **THEN** 頁面顯示錯誤訊息與重試按鈕，重試成功後顯示結果

#### Scenario: Entry no longer valid
- **WHEN** 結果請求被以進場失效拒絕
- **THEN** 頁面回到選組畫面並說明進場狀態已失效

#### Scenario: Phase is no longer ended
- **WHEN** 結果請求被以階段不符拒絕
- **THEN** 頁面重新確認階段，並移除結果區塊

#### Scenario: Repeated end events do not reload results
- **WHEN** 已載入結果後又收到階段為已結束的事件
- **THEN** 頁面不重新讀取，也不重複畫出結果

### Requirement: The student view preserves group submissions across snapshots and reconnects
搶答期間，學生頁 SHALL 保留同一有效進場組別已由 POST 回應或 SSE 事件確認的本組作答；讀取到的較舊伺服器快照 SHALL NOT 移除這些作答。studentId SSE 連線第一次成功開啟及後續重新連線成功時，學生頁 SHALL 同步階段與本組作答。EventSource CLOSED 後重新確認進場若遇到暫時網路錯誤，學生頁 SHALL 延遲重試；確認進場失效時仍 SHALL 回到選組畫面。

#### Scenario: A stale snapshot does not erase a received submission
- **WHEN** 伺服器作答快照請求進行期間收到同組 `submission` 事件，且較舊快照之後才回覆
- **THEN** 學生頁保留該題已送出的作答狀態，不退回「未作答」

#### Scenario: First student-scoped connection synchronizes missed updates
- **WHEN** 有效進場後 studentId SSE 連線第一次成功觸發 `open`，且連線建立前有同組作答
- **THEN** 學生頁同步伺服器狀態並顯示該作答

#### Scenario: Reconnect synchronizes updates missed while disconnected
- **WHEN** studentId SSE 連線重新開啟，且中斷期間有階段或同組作答更新
- **THEN** 學生頁重新讀取階段與本組作答並呈現最新狀態

#### Scenario: Transient entry-check failure after a closed event stream is retried
- **WHEN** CLOSED 連線後的進場確認因暫時網路錯誤失敗
- **THEN** 學生頁保留目前畫面並延遲重試進場確認；確認結果為 `STUDENT_NOT_ENTERED` 時回到選組畫面

### Requirement: Student drafts are scoped to one activity
學生端 SHALL 以 server 提供的 `activityId` 隔離草稿。重新整理或重連同一場活動時 SHALL 能恢復本場草稿；新一場活動 SHALL NOT 顯示或回填前一場的草稿。

#### Scenario: A draft is restored within the same activity
- **WHEN** 學生在同一場搶答輸入部分答案後重新整理並恢復進場
- **THEN** 該題回填本場草稿

#### Scenario: A previous activity draft is not reused
- **WHEN** 同一瀏覽器與 `studentId` 進入新一場活動並開啟相同題號
- **THEN** 題號格不標示前一場的「草稿」，輸入框也不回填前一場答案
