# Spec Delta

## ADDED Requirements

### Requirement: The answering area shows the remaining countdown time
搶答中且 server 提供倒數結束時間時，學生頁作答區 SHALL 以「剩餘時間 m:ss」顯示剩餘時間並每秒更新（D15）。剩餘時間 SHALL 依 server 的倒數結束時間與 server 時間計算，不依學生裝置的時鐘；與老師控制台顯示的剩餘時間相差 SHALL 不超過 1 秒。歸零後 SHALL 顯示 0:00，直到收到階段變化。沒有倒數或不在搶答中時 SHALL NOT 顯示剩餘時間。

#### Scenario: Countdown is shown while buzzing
- **WHEN** 老師以 60 秒倒數開始搶答，學生停在題號格或作答頁
- **THEN** 作答區顯示「剩餘時間 1:00」並每秒遞減

#### Scenario: Device clock is wrong
- **WHEN** 學生手機的時鐘比 server 慢 2 分鐘，活動以 60 秒倒數進行中
- **THEN** 學生頁顯示的剩餘時間與老師控制台相差不超過 1 秒

#### Scenario: Joining or reconnecting mid-countdown
- **WHEN** 學生在倒數進行中才進場、重新整理頁面，或即時連線中斷後恢復
- **THEN** 頁面依 server 目前的倒數結束時間顯示剩餘時間，不從頭開始計算

#### Scenario: Countdown reaches zero
- **WHEN** 剩餘時間歸零
- **THEN** 頁面顯示 0:00，收到階段變為「已結束」後顯示活動已結束，不再顯示剩餘時間

#### Scenario: No countdown
- **WHEN** 老師開始搶答時沒有設定倒數
- **THEN** 作答區不顯示剩餘時間
