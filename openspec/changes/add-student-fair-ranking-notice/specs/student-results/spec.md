# Spec Delta

## ADDED Requirements

### Requirement: The student page explains fair ranking in results
學生頁顯示結果時，本場啟用公平順位（D14）SHALL 在摘要下方顯示「本場使用公平順位」；未啟用時 SHALL NOT 顯示這段說明。某題勝者因公平順位改判時，該題列 SHALL 在成功組別與答案後加註「（本題因公平順位改判）」；勝者為最先送達者的題目 SHALL NOT 加註。說明 SHALL 以純文字顯示，且 SHALL NOT 帶出原始接收順位或他組資訊。結果回應缺少公平順位欄位時，SHALL 視為未啟用、未改判。搶答中與準備中 SHALL NOT 顯示這些說明。

#### Scenario: Fair ranking session
- **WHEN** 啟用公平順位的活動結束，學生頁顯示結果
- **THEN** 摘要下方顯示「本場使用公平順位」

#### Scenario: Re-judged question
- **WHEN** 啟用公平順位，第 3 題第 1 組最先送出，但勝者因公平順位改判為第 2 組，第 1 組學生查看結果
- **THEN** 第 3 題列顯示第 2 組與其答案並加註「（本題因公平順位改判）」，本組顯示第 2 名

#### Scenario: Question won by the first arrival
- **WHEN** 啟用公平順位，第 1 題的勝者是最先送達者
- **THEN** 第 1 題列不加註

#### Scenario: Fair ranking disabled
- **WHEN** 未啟用公平順位的活動結束
- **THEN** 結果頁不顯示「本場使用公平順位」，任何題目都不加註，畫面與未加入公平順位前相同

#### Scenario: Fields missing from the response
- **WHEN** 結果回應沒有 `fairRankingEnabled`，勝者也沒有 `byFairRanking`
- **THEN** 結果頁照常顯示，不顯示任何公平順位說明
