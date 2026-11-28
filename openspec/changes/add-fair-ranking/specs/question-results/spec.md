# Spec Delta

## MODIFIED Requirements

### Requirement: Results are deterministic
相同的題目、作答紀錄、設定與判定時刻 SHALL 推導出相同的結果。未啟用公平順位時，結果 SHALL 與判定時刻無關；啟用公平順位時，所有題目的 3 秒批次都結束後，結果 SHALL 不再隨判定時刻改變。

#### Scenario: Same input at different times
- **WHEN** 未啟用公平順位，以相同的資料在兩個不同時刻推導
- **THEN** 兩次結果完全相同

#### Scenario: Fair ranking after every batch has closed
- **WHEN** 啟用公平順位，所有題目的第一個有效作答都已超過 3 秒，以相同的資料在兩個不同時刻推導
- **THEN** 兩次結果完全相同

#### Scenario: Repeated derivation
- **WHEN** 以同一份作答紀錄、設定與判定時刻推導 100 次
- **THEN** 100 次結果完全相同

### Requirement: Unsupported settings are rejected
要求提供任何老師改選時，推導 SHALL 失敗並說明該設定尚未支援，SHALL NOT 回傳忽略該設定的結果。啟用公平順位 SHALL 正常推導（見公平順位相關要求）。

#### Scenario: Fair ranking requested
- **WHEN** 以啟用公平順位的設定推導
- **THEN** 推導成功，依公平順位規則回傳結果

#### Scenario: Override provided
- **WHEN** 以包含第 1 題老師改選的設定推導
- **THEN** 推導失敗，錯誤說明老師改選尚未支援

#### Scenario: Empty overrides are accepted
- **WHEN** 未啟用公平順位，老師改選為空
- **THEN** 推導正常回傳先到先得的結果

## ADDED Requirements

### Requirement: Fair ranking orders the first batch by wins
啟用公平順位時（D14），每題以第一個有效作答的送達時間起 3000 毫秒內（含邊界）送達的有效作答為同一批。同批中 SHALL 依「已判定題目中的搶答成功題數」由少到多排出名次，題數相同時依原始接收順位；批次外的有效作答 SHALL 依原始接收順位排在批內之後。第 1 名為勝者；勝者不是該題原始接收順位最小者時，勝者來源 SHALL 為「公平順位改判」，否則為「先到先得」。

#### Scenario: Group with fewer wins takes the question
- **WHEN** 第 1 組已搶答成功 2 題、第 2 組 0 題，第 1 組先送出第 3 題，第 2 組在 1 秒後也送出，批次已結束
- **THEN** 第 3 題勝者為第 2 組，勝者來源為公平順位改判，第 1 組為第 2 名

#### Scenario: Submission after the batch
- **WHEN** 第 2 組在第 3 題第一個作答送達 3 秒之後才送出
- **THEN** 第 2 組不在同一批，第 3 題勝者仍為第 1 組，勝者來源為先到先得

#### Scenario: Exactly three seconds is in the batch
- **WHEN** 第 2 組的送達時間恰好是第一個作答加 3000 毫秒
- **THEN** 第 2 組屬於同一批

#### Scenario: Equal wins keep arrival order
- **WHEN** 同一批的兩組搶答成功題數相同
- **THEN** 先送達的組別為第 1 名

#### Scenario: Three or more groups in a batch
- **WHEN** 同一批有成功題數為 2、0、1 的三組
- **THEN** 名次依序為 0 題、1 題、2 題的組別，批次外的作答排在三組之後

#### Scenario: Without fair ranking nothing changes
- **WHEN** 未啟用公平順位，使用與第一個情境相同的作答
- **THEN** 第 3 題勝者為第 1 組，勝者來源為先到先得

### Requirement: Questions are judged in order of their first submission
啟用公平順位時，題目 SHALL 依各自第一個有效作答的送達時間先後依序判定；送達時間相同時題號小者先判定。判定一題時 SHALL 只使用在它之前已判定題目累積的搶答成功題數。沒有作廢時，已判定的題目 SHALL NOT 因之後送達的作答而改變。

#### Scenario: Earlier question affects a later one
- **WHEN** 第 2 題的第一個作答比第 1 題早送達，第 1 組贏得第 2 題，接著兩組都在第 1 題的同一批內送出，第 1 組先送達
- **THEN** 第 1 題勝者為第 2 組

#### Scenario: Later submissions do not change a judged question
- **WHEN** 第 1 題已判定由第 1 組搶答成功，之後其他題目陸續有作答送達
- **THEN** 第 1 題的勝者與名次不變

### Requirement: A question is being judged until its batch closes
啟用公平順位且活動為搶答中時，判定時刻早於「該題第一個有效作答送達時間 + 3000 毫秒」的題目 SHALL 為判定中：沒有勝者與勝者來源，名次暫依原始接收順位排列，且不計入後面題目的成功題數。活動已結束時，所有題目 SHALL 以當下已送達的有效作答立即判定，不再有判定中的題目。

#### Scenario: Within the first three seconds
- **WHEN** 啟用公平順位，第 1 題第一個作答送達 1 秒後推導
- **THEN** 第 1 題為判定中，沒有勝者

#### Scenario: After the batch closes
- **WHEN** 同一份資料在第一個作答送達 3 秒後推導
- **THEN** 第 1 題已判定並有勝者

#### Scenario: Ending inside a batch
- **WHEN** 第 1 題第一個作答送達 1 秒後老師結束搶答
- **THEN** 已結束後的推導中第 1 題已判定，以結束當下已送達的作答決定勝者

### Requirement: Voiding a winner re-judges the following questions
啟用公平順位時，作廢某題的作答後，結果 SHALL 以剩餘有效作答從頭重新推導（D25）：該題的批次以剩餘的第一個有效作答重新起算，且因各組成功題數改變，之後已判定的題目 SHALL 依新的成功題數一併重新判定。未啟用公平順位時，作廢 SHALL NOT 改變其他題目的結果。

#### Scenario: Chain re-judgement
- **WHEN** 啟用公平順位，第 1 組贏得第 1 題（成功 1 題）、第 2 組贏得第 2 題；第 2 題的批次中第 1 組先送達、第 2 組後送達；老師作廢第 1 組第 1 題的作答
- **THEN** 第 1 題由剩下的有效作答重新判定，第 2 題也依新的成功題數重新判定，兩題的勝者與各組成功題數一致

#### Scenario: Void without fair ranking
- **WHEN** 未啟用公平順位，老師作廢第 1 題勝者的作答
- **THEN** 第 1 題改由剩下最早送達的有效作答勝出，其他題目的結果不變
