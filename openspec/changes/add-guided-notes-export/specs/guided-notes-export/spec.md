# Spec Delta

## Purpose

活動結束後，把每題搶答成功組別的答案寫回老師的 Guided Notes：以連結匯入時直接寫回原線上 Google 試算表，任何來源都可下載寫好答案的 xlsx 作為備援。

## ADDED Requirements

### Requirement: Each question's winning answer comes from its judged result
匯出時，每題的成功答案 SHALL 為該題判定結果中勝者那一筆作答的答案；沒有勝者的題目 SHALL 視為無人作答。匯出 SHALL NOT 改變作答、順位、題目或活動階段。

#### Scenario: Lowest rank wins
- **WHEN** 第 1 題有 A 組（順位 1）與 B 組（順位 2）的有效作答
- **THEN** 第 1 題的成功答案為 A 組的答案

#### Scenario: Voided submission is not exported
- **WHEN** 第 1 題 A 組（順位 1）的作答已作廢，B 組（順位 2）的作答有效
- **THEN** 第 1 題的成功答案為 B 組的答案

#### Scenario: Question without valid submissions
- **WHEN** 第 3 題沒有任何有效作答
- **THEN** 第 3 題視為無人作答，匯出時不寫入任何內容

#### Scenario: Export leaves session data unchanged
- **WHEN** 老師下載 xlsx 或寫回試算表之後查詢活動摘要
- **THEN** 階段、題數與組數與匯出前相同

### Requirement: Answers are written into each blank's answer cell by layout
每個空格的答案 SHALL 寫入匯入時判定的答案寫入位置，內容依版面決定：前綴與答案格分離時只寫答案；前綴位於合併填答區時寫「前綴＋答案」；沒有前綴時只寫答案。無人作答的題目 SHALL NOT 寫入任何儲存格。答案 SHALL 一律以純文字寫入，SHALL NOT 被試算表當成公式。

#### Scenario: Separate prefix cell
- **WHEN** 匯入 `02-official-group.xlsx`，第 1 題成功答案為「甲」「乙」
- **THEN** G5、G6 保持「（1）」「（2）」，H5 寫入「甲」、H6 寫入「乙」

#### Scenario: Prefix inside merged answer area
- **WHEN** 匯入 `04-mixed-groups.xlsx`，第 2 題成功答案為「甲」「乙」「丙」
- **THEN** G7、G8、G9 分別寫入「（1）甲」「（2）乙」「（3）丙」

#### Scenario: Single question
- **WHEN** 匯入 `01-official-single.xlsx`，第 1 題成功答案為「光合作用」
- **THEN** G5 寫入「光合作用」

#### Scenario: Answer that looks like a formula
- **WHEN** 成功答案為「=1+1」
- **THEN** 該格內容為文字「=1+1」，不是公式計算結果

#### Scenario: Unanswered question left untouched
- **WHEN** 第 3 題無人作答
- **THEN** 第 3 題的填空格維持匯入檔原本的內容

### Requirement: Teacher downloads the Guided Notes with answers after the session ends
系統 SHALL 讓已登入老師在「已結束」階段下載一份以原匯入檔為底、已寫入成功答案的 xlsx，上傳與連結兩種匯入來源都適用。除答案儲存格外，工作表內容 SHALL 與原匯入檔相同。

#### Scenario: Download after ending
- **WHEN** 已登入老師在「已結束」階段要求下載
- **THEN** 回應為 xlsx 檔，開啟後答案位於各題答案寫入位置，題目與其他儲存格不變

#### Scenario: Download before ending
- **WHEN** 老師在「準備中」或「搶答中」要求下載
- **THEN** server 回 409 `EXPORT_NOT_ALLOWED`

#### Scenario: Nothing imported
- **WHEN** 尚未匯入學習單時要求下載
- **THEN** server 回 409 `NO_GUIDED_NOTES`

#### Scenario: Not logged in
- **WHEN** 未登入時要求下載
- **THEN** server 回 401 `TEACHER_AUTH_REQUIRED`

### Requirement: Teacher writes answers back to the linked Google Sheet
以連結匯入時，系統 SHALL 讓已登入老師在「已結束」階段把成功答案寫回原線上試算表，並回報寫入的儲存格數。寫回 SHALL 只改變答案儲存格的值，SHALL NOT 改變格式、公式、版面或其他儲存格。沒有任何成功答案時 SHALL 回報寫入 0 格且不呼叫寫入。

#### Scenario: Successful write-back
- **WHEN** 已登入老師在「已結束」階段要求寫回，試算表已共用給服務帳號為編輯者
- **THEN** server 回 200，`writtenCells` 為實際寫入的格數，線上試算表的答案格出現成功答案

#### Scenario: No winning answers
- **WHEN** 所有題目都無人作答時要求寫回
- **THEN** server 回 200，`writtenCells` 為 0，線上試算表不變

#### Scenario: Write-back before ending
- **WHEN** 老師在「搶答中」要求寫回
- **THEN** server 回 409 `EXPORT_NOT_ALLOWED`，不寫入任何內容

#### Scenario: Imported from an uploaded file
- **WHEN** 學習單以上傳 xlsx 匯入，老師要求寫回
- **THEN** server 回 409 `GUIDED_NOTES_NOT_LINK`，訊息提示改用下載 xlsx

#### Scenario: Concurrent write-back
- **WHEN** 前一次寫回尚未完成時再次要求寫回
- **THEN** server 回 409 `WRITEBACK_IN_PROGRESS`，不重複寫入

### Requirement: Write-back re-locates blanks in the current online sheet
寫回前系統 SHALL 重新讀取線上試算表，以與匯入相同的表頭與題號規則重新定位答案位置，並以新的位置寫入。重新讀到的題號集合或任一題的空格數與匯入時不同時，SHALL 拒絕寫入並說明差異。無法重新讀取時 SHALL 拒絕寫入。位置與匯入時不同時，回應 SHALL 標示已重新對位。

#### Scenario: Row inserted after import
- **WHEN** 老師匯入 `01-official-single.xlsx` 後在線上試算表第 3 列上方插入一列，再要求寫回
- **THEN** 第 1 題答案寫入 G6，回應的 `remapped` 為 true

#### Scenario: Layout unchanged
- **WHEN** 匯入後線上試算表沒有被修改，老師要求寫回
- **THEN** 答案寫入匯入時的位置，`remapped` 為 false

#### Scenario: Question number changed
- **WHEN** 匯入後老師把線上試算表的題號 3 改成 30，再要求寫回
- **THEN** server 回 409 `SHEET_MODIFIED`，訊息指出第 3 題找不到，不寫入任何內容

#### Scenario: Sheet cannot be re-read
- **WHEN** 寫回前重新讀取線上試算表失敗（例如已取消「知道連結者可檢視」）
- **THEN** server 回 502 `SHEET_CHECK_FAILED`，不寫入任何內容

#### Scenario: Second write-back after answers are present
- **WHEN** 同一份試算表已寫回過一次，老師再次要求寫回
- **THEN** 答案寫入與第一次相同的儲存格，前綴格不被覆寫

### Requirement: Write-back failures report an actionable reason
寫回失敗時，系統 SHALL 依原因回傳對應的錯誤代碼與中文訊息，訊息 SHALL 說明老師下一步可以怎麼做，並提示可改用下載 xlsx。任何寫回失敗 SHALL NOT 改變本地資料，也 SHALL NOT 影響其他功能。

#### Scenario: Service account not configured
- **WHEN** server 未設定服務帳號金鑰，老師要求寫回
- **THEN** server 回 503 `SHEET_NOT_CONFIGURED`

#### Scenario: Sheet not shared with the service account
- **WHEN** Google 回應沒有編輯權限
- **THEN** server 回 422 `SHEET_NOT_EDITABLE`，訊息包含應共用的服務帳號信箱

#### Scenario: Sheet deleted
- **WHEN** Google 回應找不到試算表
- **THEN** server 回 422 `SHEET_NOT_FOUND`

#### Scenario: Worksheet missing
- **WHEN** Google 回應無法解析目標工作表範圍
- **THEN** server 回 422 `SHEET_TAB_NOT_FOUND`

#### Scenario: File is not a native Google Sheet
- **WHEN** Google 回應此文件不支援該操作（檔案仍是雲端上的 xlsx）
- **THEN** server 回 422 `SHEET_NOT_NATIVE`，訊息提示先「儲存為 Google 試算表」再重新匯入

#### Scenario: Sheets API disabled
- **WHEN** Google 回應服務帳號所屬專案未啟用 Sheets API
- **THEN** server 回 503 `SHEET_API_DISABLED`

#### Scenario: Invalid service account credentials
- **WHEN** 取得 Google 存取權杖失敗或 Google 回應認證無效
- **THEN** server 回 503 `SHEET_AUTH_FAILED`

#### Scenario: Temporary failure
- **WHEN** Google 回應限流、5xx，或連線逾時
- **THEN** server 回 502 `SHEET_UNAVAILABLE`

### Requirement: Teacher can query the write-back configuration
系統 SHALL 提供需老師登入的查詢，回傳 server 是否已設定服務帳號、服務帳號信箱，以及目前匯入來源是否可寫回。

#### Scenario: Configured with linked import
- **WHEN** server 已設定服務帳號，學習單以連結匯入，老師查詢
- **THEN** 回應 `configured` 為 true、包含服務帳號信箱、`target` 為 `link`

#### Scenario: Not configured
- **WHEN** server 未設定服務帳號，老師查詢
- **THEN** 回應 `configured` 為 false、`serviceAccountEmail` 為 null

### Requirement: Service account credentials stay out of the repository and responses
服務帳號金鑰 SHALL 只從 repo 外的檔案讀取，檔案路徑由環境變數提供。金鑰內容、存取權杖、答案內容與試算表內容 SHALL NOT 出現在任何 API 回應或 log；log 只記錄寫入格數與錯誤代碼。

#### Scenario: Failure response contains no secrets
- **WHEN** 寫回因認證失敗而回傳錯誤
- **THEN** 回應與 log 不包含私鑰、存取權杖或 Google 原始錯誤內容

#### Scenario: Unreadable key file
- **WHEN** 環境變數指向的金鑰檔不存在或格式錯誤
- **THEN** server 照常啟動，寫回設定視為未設定，log 只說明金鑰檔無法讀取

### Requirement: Teacher console offers export after the session ends
老師控制台 SHALL 顯示「匯出結果」區塊，說明寫回目標與應共用的服務帳號信箱。「下載 xlsx」SHALL 只在「已結束」且已匯入時可用；「寫回 Google 試算表」SHALL 只在「已結束」、以連結匯入且 server 已設定服務帳號時可用。寫回進行中按鈕 SHALL 停用。結果 SHALL 顯示寫入格數與是否重新對位，失敗時顯示原因與下載備援。階段改變或重新匯入時 SHALL 清除上一次的結果訊息。

#### Scenario: Before the session ends
- **WHEN** 已登入老師在「搶答中」開啟控制台
- **THEN** 兩個匯出按鈕皆停用，並說明結束後才能匯出

#### Scenario: Linked import after ending
- **WHEN** 以連結匯入、server 已設定服務帳號、活動已結束
- **THEN** 兩個按鈕皆可用，區塊顯示服務帳號信箱與共用說明

#### Scenario: Uploaded import after ending
- **WHEN** 以上傳 xlsx 匯入、活動已結束
- **THEN** 只有「下載 xlsx」可用，並說明上傳的檔案沒有線上試算表可寫回

#### Scenario: Write-back result shown
- **WHEN** 寫回成功且 `remapped` 為 true
- **THEN** 區塊顯示寫入格數，並說明線上試算表版面有變動、已依題號重新對位

#### Scenario: Write-back failure shown
- **WHEN** 寫回回傳 `SHEET_NOT_EDITABLE`
- **THEN** 區塊顯示 server 的中文訊息，並提示可改用下載 xlsx

#### Scenario: Message cleared when the phase changes
- **WHEN** 顯示過寫回結果後，控制台收到活動階段改變（例如之後的重設活動讓階段回到「準備中」）
- **THEN** 先前的寫回結果訊息消失
