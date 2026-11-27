# Spec Delta

## ADDED Requirements

### Requirement: The student page returns to group selection after an activity reset
老師重設活動時，已進場且連線中的學生頁 SHALL 在 2 秒內回到選組頁，並顯示「活動已重設，請重新選擇組別」（D19，與 SpecKit 談定的 v0.10）。重設時沒有連線的學生，之後重新整理或重連時，查詢進場得到 `activity_reset`，SHALL 顯示同一句說明。學生重新選組後 SHALL 照常進入目前階段；前一場的已送出狀態與草稿 SHALL NOT 出現在新一場活動。

#### Scenario: Connected student sees the reset
- **WHEN** 學生停在作答區、結果頁或等待畫面，老師重設活動
- **THEN** 2 秒內頁面回到選組頁，顯示「活動已重設，請重新選擇組別」

#### Scenario: Student was offline during the reset
- **WHEN** 學生關閉頁面期間老師重設活動，之後學生重新開啟頁面
- **THEN** 頁面顯示選組頁與「活動已重設，請重新選擇組別」

#### Scenario: Rejoin after a reset
- **WHEN** 學生在重設後重新選擇組別，老師再開始一場搶答
- **THEN** 題號格的每一題都是「未作答」，不顯示前一場的已送出或草稿

#### Scenario: Other invalid entries keep their own message
- **WHEN** 進場因組別被移除或 server 重啟而失效
- **THEN** 頁面顯示原本對應的說明，不顯示「活動已重設」
