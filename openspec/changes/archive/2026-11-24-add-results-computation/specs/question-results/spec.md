# Spec Delta

## Purpose

由 server 保存的作答紀錄推導每題的判定結果（勝者、勝者來源、名次與是否已判定），讓結果頁、老師監看、CSV、xlsx 匯出與試算表寫回都讀同一份結果。

## ADDED Requirements

### Requirement: Results are derived per question from submissions
server SHALL 由題目清單與作答紀錄推導每題一筆判定結果，依題號由小到大排列，每題都有結果（包含無人作答的題目）。結果 SHALL NOT 被儲存，每次都由當下的作答紀錄重新推導。題目清單中沒有的題號，其作答 SHALL 被忽略。推導 SHALL NOT 修改傳入的題目或作答紀錄。

#### Scenario: One result per question in question-number order
- **WHEN** 題目為第 5、1、3 題，只有第 1 題有作答
- **THEN** 結果依序為第 1、3、5 題，共三筆

#### Scenario: Submission for an unknown question is ignored
- **WHEN** 作答紀錄中有一筆題號 99 的作答，但題目清單沒有第 99 題
- **THEN** 結果中沒有第 99 題，其他題目的結果不受影響

#### Scenario: Inputs are left unchanged
- **WHEN** 推導完成後檢查傳入的作答紀錄
- **THEN** 每筆作答的內容與順序都與推導前相同

### Requirement: Without fair ranking the earliest valid submission wins
未啟用公平順位時，每題的有效作答 SHALL 依原始接收順位由小到大排出從 1 起連續的名次，第 1 名為該題勝者，勝者來源為「先到先得」，該題 SHALL 視為已判定。勝者 SHALL 以組別與原始接收順位指定是哪一筆作答。

#### Scenario: Lowest rank wins
- **WHEN** 第 1 題有第 2 組（順位 1）與第 5 組（順位 2）的有效作答
- **THEN** 第 1 題勝者為第 2 組、順位 1，勝者來源為先到先得，名次依序為第 2 組第 1 名、第 5 組第 2 名，且已判定

#### Scenario: Submissions out of order in the input
- **WHEN** 傳入的作答紀錄中順位 3 的作答排在順位 1 之前
- **THEN** 名次仍依順位由小到大排列

### Requirement: Voided submissions are excluded from results
狀態不是有效的作答（例如已作廢）SHALL NOT 計入名次與勝者。名次 SHALL 只在有效作答之間連續編號，作廢造成的空號不影響名次。

#### Scenario: Voided first submission
- **WHEN** 第 1 題順位 1 的作答已作廢，順位 2、3 為有效
- **THEN** 勝者為順位 2 的作答，名次只有兩筆，分別為第 1、2 名

#### Scenario: Resubmission after void
- **WHEN** 第 2 組順位 1 的作答已作廢，第 3 組順位 2 有效，第 2 組重送後為順位 4 且有效
- **THEN** 勝者為第 3 組，第 2 組為第 2 名

### Requirement: Questions without valid submissions have no winner
沒有任何有效作答的題目，其結果 SHALL 為已判定、沒有勝者、沒有勝者來源，且名次為空。

#### Scenario: No submissions at all
- **WHEN** 第 3 題沒有任何作答
- **THEN** 第 3 題已判定，勝者與勝者來源皆為空，名次為空清單

#### Scenario: Only voided submissions
- **WHEN** 第 4 題只有一筆已作廢的作答
- **THEN** 第 4 題已判定，勝者與勝者來源皆為空，名次為空清單

### Requirement: Results are deterministic
相同的題目、作答紀錄與設定 SHALL 推導出相同的結果，與推導時刻無關。

#### Scenario: Same input at different times
- **WHEN** 以相同的資料在兩個不同時刻推導
- **THEN** 兩次結果完全相同

### Requirement: Unsupported settings are rejected
在公平順位與老師改選尚未實作前，要求啟用公平順位或提供任何老師改選時，推導 SHALL 失敗並說明該設定尚未支援，SHALL NOT 回傳忽略該設定的結果。

#### Scenario: Fair ranking requested
- **WHEN** 以啟用公平順位的設定推導
- **THEN** 推導失敗，錯誤說明公平順位尚未支援

#### Scenario: Override provided
- **WHEN** 以包含第 1 題老師改選的設定推導
- **THEN** 推導失敗，錯誤說明老師改選尚未支援

#### Scenario: Empty overrides are accepted
- **WHEN** 未啟用公平順位，老師改選為空
- **THEN** 推導正常回傳先到先得的結果
