# Spec Delta

## ADDED Requirements

### Requirement: Teacher chooses fair ranking before starting
控制台 SHALL 在「開始搶答」旁提供「啟用公平順位」勾選框，預設不勾選，並以一句話說明規則：「某題第一個答案送達後 3 秒內送出的組別中，搶答成功題數最少的優先。」勾選框 SHALL 只在準備中可操作。開始搶答時 SHALL 依勾選狀態帶出設定。活動狀態 SHALL 在搶答中與已結束顯示本場是否使用公平順位。

#### Scenario: Default is unchecked
- **WHEN** 老師在準備中開啟控制台
- **THEN** 「啟用公平順位」未勾選，旁邊有規則說明

#### Scenario: Start with fair ranking
- **WHEN** 老師勾選「啟用公平順位」並開始搶答
- **THEN** 活動狀態顯示「公平順位：啟用」，勾選框停用

#### Scenario: Start without fair ranking
- **WHEN** 老師沒有勾選就開始搶答
- **THEN** 活動狀態顯示「公平順位：不啟用」

#### Scenario: Setting cannot change after starting
- **WHEN** 活動在搶答中或已結束
- **THEN** 勾選框停用，無法改變本場設定
