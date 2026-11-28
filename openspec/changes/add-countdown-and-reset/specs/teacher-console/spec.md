# Spec Delta

## MODIFIED Requirements

### Requirement: Teacher starts the session from the console
控制台 SHALL 只在「準備中」提供可用的「開始搶答」按鈕，並提供「設定倒數」選項與分、秒輸入；不勾選時開始搶答不帶倒數。server 因沒有組別、沒有題目或倒數時間不在範圍內而拒絕時，控制台 SHALL 顯示原因並維持「準備中」。開始成功後控制台 SHALL 顯示「搶答中」。

#### Scenario: Start with groups and questions
- **WHEN** 已有組別與題目，老師按「開始搶答」
- **THEN** 控制台顯示「搶答中」，已進場學生在 2 秒內看到「搶答中」

#### Scenario: Start without questions
- **WHEN** 已有組別但沒有匯入題目，老師按「開始搶答」
- **THEN** 控制台顯示需要先匯入題目，階段維持「準備中」

#### Scenario: Start with a countdown
- **WHEN** 老師勾選「設定倒數」、輸入 1 分 30 秒並按「開始搶答」
- **THEN** 開始請求帶 90 秒倒數，控制台顯示「搶答中」與剩餘時間

#### Scenario: Countdown out of range
- **WHEN** 老師勾選「設定倒數」、輸入 0 分 5 秒並按「開始搶答」
- **THEN** 控制台顯示倒數時間需介於 10 秒到 60 分鐘，階段維持「準備中」

## ADDED Requirements

### Requirement: Console shows the remaining countdown time
搶答中且有倒數時，控制台 SHALL 以「剩餘 分:秒」顯示剩餘時間並每秒更新。剩餘時間 SHALL 依 server 的倒數結束時間與 server 時間計算，不依老師電腦的時鐘。剩餘時間歸零時 SHALL 顯示 0:00，並在收到階段變化後顯示「已結束」。沒有倒數或不在搶答中時 SHALL NOT 顯示剩餘時間。

#### Scenario: Remaining time follows the server
- **WHEN** 老師電腦的時鐘比 server 快 30 秒，活動以 60 秒倒數進行中
- **THEN** 控制台顯示的剩餘時間與依 server 時間計算的剩餘時間相差不超過 1 秒

#### Scenario: Countdown ends the session on the console
- **WHEN** 倒數歸零
- **THEN** 控制台在 2 秒內顯示「已結束」，剩餘時間不再顯示，匯出區塊變為可用

#### Scenario: No countdown is shown
- **WHEN** 搶答中但開始時沒有設定倒數
- **THEN** 控制台不顯示剩餘時間

### Requirement: Resetting the activity requires confirmation
控制台 SHALL 只在「已結束」提供「重設活動」按鈕，按下後 SHALL 先要求老師再確認一次，並說明作答與學生進場會被清空、組別與題目保留。取消時 SHALL 不送出請求、資料不變。確認後控制台 SHALL 顯示「準備中」，監看與匯出結果清空，組別設定與匯入恢復可操作，老師維持登入。同一重設被重複送出時，控制台 SHALL NOT 顯示錯誤，最後顯示「準備中」。

#### Scenario: Confirm reset
- **WHEN** 老師在「已結束」按「重設活動」後選擇確認
- **THEN** 控制台顯示「準備中」，組數與題數不變，可以再次開始搶答

#### Scenario: Cancel reset
- **WHEN** 老師按「重設活動」後選擇取消
- **THEN** 階段維持「已結束」，結果與匯出仍可使用

#### Scenario: Reset is not offered outside the ended phase
- **WHEN** 活動在「準備中」或「搶答中」
- **THEN** 「重設活動」按鈕停用

#### Scenario: Reset twice
- **WHEN** 兩個分頁幾乎同時確認重設
- **THEN** 階段只回到「準備中」一次，兩個分頁都顯示「準備中」且沒有錯誤訊息
