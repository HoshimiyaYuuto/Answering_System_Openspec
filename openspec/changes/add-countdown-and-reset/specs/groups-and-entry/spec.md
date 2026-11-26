# Spec Delta

## MODIFIED Requirements

### Requirement: Student entry survives refresh and reports invalidated membership
學生端 SHALL 將學生識別碼與組別進場資訊存在瀏覽器本地，重新整理後向 server 恢復目前組別及階段；原組別遭刪除或進場資料因重設失效時 SHALL 回到選組頁並說明原因。server 查詢進場時 SHALL 以原因區分失效情形：組別已刪除為 `group_removed`；老師重設活動前已進場、重設後尚未重新進場為 `activity_reset`；其他沒有進場紀錄的情形（包含 server 重啟）為 `entry_reset`。學生重新選組進場後，SHALL 不再回報 `activity_reset`。

#### Scenario: Restore entry after refresh
- **WHEN** 已進場學生重新整理頁面且組別仍有效
- **THEN** 學生端恢復原組別並顯示 server 目前階段

#### Scenario: Recover after group deletion or reset
- **WHEN** 存檔的進場資料所屬組別已刪除或已失效
- **THEN** server 回傳可辨識原因，學生端清除舊進場並返回選組頁說明原因

#### Scenario: Entry looked up after an activity reset
- **WHEN** 學生在重設前已進場，重設後以原學生識別碼查詢進場
- **THEN** server 回 `200`，`valid` 為 `false`，`reason` 為 `activity_reset`

#### Scenario: Re-entry after an activity reset
- **WHEN** 該學生重設後重新選擇任一組別進場，再查詢進場
- **THEN** server 回傳有效進場與新選的組別

#### Scenario: Unknown entry is not reported as a reset
- **WHEN** 從未進場過的學生識別碼查詢進場
- **THEN** server 回傳 `reason` 為 `entry_reset`，不是 `activity_reset`
