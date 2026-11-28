# Spec Delta

## MODIFIED Requirements

### Requirement: Console shows the monitoring panel while buzzing
老師控制台 SHALL 顯示「作答監看」區塊，依題號每題一列，顯示已送出組數與總組數、第 1 名的組別與答案，並可展開看各組的狀態、答案、送出時間與名次。展開的明細 SHALL 依名次列出有效作答，已作廢的作答依送達順序排在有效作答之後。收到監看通知或活動階段改變時 SHALL 重新讀取並取代畫面內容，且 SHALL 丟棄過期的回應。

#### Scenario: Two groups submit
- **WHEN** 搶答中第 1 組先、第 2 組後送出第 1 題
- **THEN** 2 秒內第 1 題顯示已送出 2 組，第 1 名為第 1 組，展開後第 1 組第 1 名、第 2 組第 2 名

#### Scenario: Details follow fair ranking places
- **WHEN** 啟用公平順位，第 3 題第 1 組先送達、第 2 組後送達，但第 2 組因公平順位排第 1 名
- **THEN** 展開第 3 題時，第 2 組（第 1 名）列在第 1 組（第 2 名）之前

#### Scenario: Voided entries are listed last
- **WHEN** 第 1 題第 1 組最先送出後被作廢，第 2 組為第 1 名
- **THEN** 展開第 1 題時，第 2 組列在前面，第 1 組的已作廢列在有效作答之後

#### Scenario: Out-of-order responses
- **WHEN** 連續兩次重新讀取監看資料，較早的請求比較晚的請求更晚回應
- **THEN** 畫面顯示較晚請求的資料

### Requirement: Console shows results after the session ends
活動為「已結束」時，同一區塊 SHALL 改為「搶答結果」，每題顯示勝者組別與答案；沒有勝者的題目 SHALL 標示「無人作答」。尚在判定中的題目 SHALL 標示「判定中」，不顯示勝者。勝者因公平順位改判的題目 SHALL 在勝者後標示「（公平順位改判）」。

#### Scenario: Results shown after ending
- **WHEN** 第 1 題由第 1 組搶答成功，老師結束搶答
- **THEN** 2 秒內區塊標題為「搶答結果」，第 1 題顯示第 1 組與其答案

#### Scenario: Unanswered question in results
- **WHEN** 活動已結束，第 3 題無人作答
- **THEN** 第 3 題顯示「無人作答」

#### Scenario: Question still being judged
- **WHEN** 判定結果中某題尚在判定中
- **THEN** 該題標示「判定中」且不顯示勝者

#### Scenario: Winner decided by fair ranking
- **WHEN** 第 3 題的勝者因公平順位改判
- **THEN** 第 3 題顯示勝者組別、答案與「（公平順位改判）」

## ADDED Requirements

### Requirement: Teacher is notified when a fair ranking batch closes
啟用公平順位且活動為搶答中時，某題的 3 秒批次結束後，server SHALL 在 2 秒內通知已登入老師的連線監看資料已改變，讓「判定中」的題目更新為最終名次，即使期間沒有新的送出。通知 SHALL 只送給已登入老師的連線，內容不含作答。未啟用公平順位時 SHALL NOT 送出這種通知。

#### Scenario: Judging turns into a final place
- **WHEN** 啟用公平順位，第 1 題只有一組送出，之後 3 秒內沒有任何送出
- **THEN** 第一個作答送達後 5 秒內，老師連線收到監看資料已改變的通知，重新讀取後第 1 題已判定

#### Scenario: No notice without fair ranking
- **WHEN** 未啟用公平順位，第 1 題只有一組送出
- **THEN** 老師連線只收到該次送出的通知，3 秒後沒有額外通知
