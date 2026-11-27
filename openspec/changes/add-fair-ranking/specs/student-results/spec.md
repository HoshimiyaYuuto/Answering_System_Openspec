# Spec Delta

## ADDED Requirements

### Requirement: Results tell whether fair ranking decided a winner
學生結果回應 SHALL 包含本場是否啟用公平順位（`fairRankingEnabled`）；每題有勝者時，`winner` SHALL 包含該勝者是否因公平順位改判（`byFairRanking`）。這兩個欄位 SHALL NOT 帶出任何組別識別碼、原始接收順位或他組資訊。名次與 `isWinner` SHALL 為公平順位判定後的結果。

#### Scenario: Fair ranking re-judged a question
- **WHEN** 啟用公平順位的活動結束，第 3 題勝者因公平順位改判
- **THEN** 回應的 `fairRankingEnabled` 為 `true`，第 3 題 `winner.byFairRanking` 為 `true`

#### Scenario: Winner is the first arrival
- **WHEN** 啟用公平順位，第 1 題勝者是最先送達者
- **THEN** 第 1 題 `winner.byFairRanking` 為 `false`

#### Scenario: Fair ranking disabled
- **WHEN** 未啟用公平順位的活動結束
- **THEN** 回應的 `fairRankingEnabled` 為 `false`，每題 `winner.byFairRanking` 為 `false`

#### Scenario: Own place follows fair ranking
- **WHEN** 本組最先送出第 3 題，但因公平順位排第 2
- **THEN** 第 3 題 `own.place` 為 2，`isWinner` 為 `false`
