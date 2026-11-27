# Spec Delta

## ADDED Requirements

### Requirement: Starting accepts an optional fair ranking setting
開始搶答 SHALL 可選擇帶 `fairRankingEnabled`（D14）。沒有帶或為 `false` 時本場不啟用公平順位。有帶時 SHALL 為布林值，否則 server SHALL 回傳 `400 INVALID_FAIR_RANKING`，階段維持準備中、不發布階段變化。設定 SHALL 在開始時決定並維持到本場結束，搶答中與已結束 SHALL 沒有任何方式變更；重設活動後 SHALL 回到不啟用。活動摘要與階段事件 SHALL 帶出本場的設定。

#### Scenario: Start with fair ranking
- **WHEN** 已登入老師在準備中以 `fairRankingEnabled: true` 開始搶答
- **THEN** 活動進入搶答中，活動摘要與階段事件的 `fairRankingEnabled` 為 `true`

#### Scenario: Default is off
- **WHEN** 開始搶答時沒有帶 `fairRankingEnabled`
- **THEN** 活動摘要的 `fairRankingEnabled` 為 `false`，結果依先到先得判定

#### Scenario: Invalid value
- **WHEN** 老師以 `fairRankingEnabled: "yes"` 開始搶答
- **THEN** server 回傳 `400 INVALID_FAIR_RANKING`，階段維持準備中

#### Scenario: Reset turns it off
- **WHEN** 以啟用公平順位進行的活動結束後被重設
- **THEN** 活動摘要的 `fairRankingEnabled` 為 `false`

### Requirement: Every result consumer uses the session setting and judging time
老師監看、結果 csv、xlsx 下載、Google 試算表寫回與學生結果 SHALL 以本場的公平順位設定推導判定結果。搶答中 SHALL 以 server 目前時間為判定時刻；已結束 SHALL 視為所有題目都已判定。因此同一時刻各處看到的勝者與名次 SHALL 一致。

#### Scenario: Monitor and csv agree under fair ranking
- **WHEN** 以啟用公平順位進行的活動結束後，老師查看搶答結果並下載 csv
- **THEN** 每題的勝者與名次在兩處相同，csv 第 8 欄依該題是否改判標為 `是` 或 `是（改判）`

#### Scenario: Export after ending inside a batch
- **WHEN** 某題第一個作答送達 1 秒後老師結束搶答，接著下載 xlsx
- **THEN** 該題以結束當下已送達的作答判定勝者，並寫入勝者的答案
