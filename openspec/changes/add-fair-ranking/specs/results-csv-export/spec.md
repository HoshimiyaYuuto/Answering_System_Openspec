# Spec Delta

## ADDED Requirements

### Requirement: The fair ranking column follows the session setting
csv 第 8 欄「公平順位」SHALL 依本場活動的設定輸出：未啟用為 `否`；啟用時每一列為 `是`，該題勝者因公平順位改判時，該題所有列為 `是（改判）`。「順位」與「是否搶答成功」SHALL 為公平順位判定後的名次與勝者。

#### Scenario: Fair ranking re-judged a question
- **WHEN** 啟用公平順位，第 3 題第 1 組先送達、第 2 組 1 秒後送達且因成功題數較少而勝出
- **THEN** csv 第 3 題第 2 組的順位為 1、是否搶答成功為 `是`，第 1 組的順位為 2，兩組的公平順位欄都是 `是（改判）`

#### Scenario: Fair ranking enabled without re-judgement
- **WHEN** 啟用公平順位，第 1 題的勝者是最先送達者
- **THEN** 第 1 題每一列的公平順位欄為 `是`

#### Scenario: Fair ranking disabled
- **WHEN** 未啟用公平順位
- **THEN** 每一列的公平順位欄為 `否`
