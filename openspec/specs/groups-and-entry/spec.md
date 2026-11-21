# groups-and-entry Specification

## Purpose

提供課堂活動的組別管理與免帳號學生進場能力，讓教師設定最多 100 組，學生選組後可在同組多裝置使用，並在重新整理或短暫斷線後恢復目前進場狀態。

## Requirements

### Requirement: Server serves the student and teacher static areas
server SHALL 提供 `public/student/` 與 `public/teacher/` 的靜態頁面；學生入口 SHALL 可由 `/student/` 開啟，教師控制台 SHALL 可由 `/teacher/` 開啟，且不限 localhost。

#### Scenario: Root redirects to student page
- **WHEN** 使用者開啟根路徑 `/`
- **THEN** server 導向 `/student/`

#### Scenario: Open student entry page
- **WHEN** 使用者開啟 `/student/`
- **THEN** server 提供學生端進場頁面

#### Scenario: Open temporary teacher group page
- **WHEN** 使用者從 localhost 或區網位址開啟 `/teacher/`
- **THEN** server 提供教師控制台頁面，原本的臨時組別設定頁已由控制台取代

### Requirement: Group list is readable and reflects configured groups
server SHALL 提供目前組別清單；`GET /api/session` 的 `groupCount` SHALL 等於目前實際組別數。

#### Scenario: Read configured group list
- **WHEN** 用戶端查詢組別清單
- **THEN** server 以契約 JSON envelope 回傳目前組別識別碼與名稱

#### Scenario: Session reports actual group count
- **WHEN** 組別數已設定或變更後查詢活動摘要
- **THEN** `groupCount` 等於清單中的實際組別數

### Requirement: Group configuration is limited to the teacher during preparation
組別設定操作 SHALL 僅在活動為「準備中」且請求來自已登入老師時接受；server SHALL 先檢查登入，再檢查階段，最後檢查請求內容。請求來源是否為 loopback 或帶有任何轉發標頭 SHALL NOT 影響判斷。

#### Scenario: Reject group configuration during buzzer phase
- **WHEN** 已登入老師在「搶答中」或「已結束」時提出組別設定
- **THEN** server 拒絕操作並回傳契約格式 JSON 錯誤

#### Scenario: Reject group configuration without teacher login
- **WHEN** 未登入的請求提出組別設定，即使來源是 loopback 或附上 loopback 轉發標頭
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`，組別不變

#### Scenario: Reject non-loopback group configuration
- **WHEN** 非 loopback 來源提出組別設定
- **THEN** server 依老師登入判斷權限：未登入回傳 `401 TEACHER_AUTH_REQUIRED` 且組別不變；已登入老師在「準備中」提交合法設定時，server 更新組別清單

### Requirement: Group count and names are validated
組別設定 SHALL 支援 1 至 100 組；每個組名去除前後空白後 SHALL 為 1 至 30 字元，且名稱不得重複。

#### Scenario: Reject invalid group ids
- **WHEN** 組別 id 不是 1 至 100 的整數或有重複
- **THEN** server 不更新組別並回傳契約格式 JSON 錯誤

#### Scenario: Generate default group names
- **WHEN** 教師指定合法組數並要求產生預設名稱
- **THEN** server 產生「第 1 組」至「第 N 組」且名稱不重複的清單

#### Scenario: Reject invalid group configuration
- **WHEN** 組數超過 100、組名長度不符或名稱重複
- **THEN** server 不更新組別並回傳契約格式 JSON 錯誤

### Requirement: Students enter a group without accounts
學生 SHALL 可免帳號密碼選擇現有組別進場；同一組 SHALL 可由多個瀏覽器/裝置同時使用。

#### Scenario: Enter without an account
- **WHEN** 學生未建立帳號或提供密碼而選擇現有組別
- **THEN** server 接受其進場並記錄所選組別

### Requirement: First entry is allowed in any phase
從未進場過的學生識別碼 SHALL 可在任一階段選擇現有組別進場；選擇不存在的組別或使用格式不符的學生識別碼 SHALL 被拒絕，並回傳契約格式 JSON 錯誤。

#### Scenario: Late first entry during buzzer phase
- **WHEN** 從未進場的學生識別碼在「搶答中」選擇現有組別
- **THEN** server 接受進場並回傳目前階段與組別資訊

#### Scenario: Reject unknown group
- **WHEN** 學生選擇已不存在的組別
- **THEN** server 拒絕進場並回傳契約格式 JSON 錯誤，學生端重新讀取組別清單並提示

#### Scenario: Reject malformed student id
- **WHEN** 學生識別碼格式不符
- **THEN** server 拒絕進場並回傳契約格式 JSON 錯誤

#### Scenario: Enter a group
- **WHEN** 學生選擇一個現有組別
- **THEN** server 記錄該學生識別碼所屬組別並回傳目前階段與組別資訊

#### Scenario: Multiple students share one group
- **WHEN** 多個不同學生識別碼選擇同一組
- **THEN** server 接受所有進場並將其視為同一組

### Requirement: Students can change groups only during preparation
已進場學生 SHALL 只能在「準備中」更換組別，且 server SHALL 以目前活動階段驗證換組要求。

#### Scenario: Change group during preparation
- **WHEN** 已進場學生於「準備中」選擇另一組
- **THEN** server 更新該學生識別碼的組別

#### Scenario: Reject group change after preparation
- **WHEN** 已進場學生於「搶答中」或「已結束」要求換組
- **THEN** server 拒絕換組並回傳契約格式 JSON 錯誤

### Requirement: Student entry survives refresh and reports invalidated membership
學生端 SHALL 將學生識別碼與組別進場資訊存在瀏覽器本地，重新整理後向 server 恢復目前組別及階段；原組別遭刪除或進場資料因重設失效時 SHALL 回到選組頁並說明原因。

#### Scenario: Restore entry after refresh
- **WHEN** 已進場學生重新整理頁面且組別仍有效
- **THEN** 學生端恢復原組別並顯示 server 目前階段

#### Scenario: Recover after group deletion or reset
- **WHEN** 存檔的進場資料所屬組別已刪除或已失效
- **THEN** server 回傳可辨識原因，學生端清除舊進場並返回選組頁說明原因

### Requirement: Student page synchronizes phase and connection health
學生端 SHALL 以 `GET /api/session` 取得初始階段，並以 `GET /api/events` 同步後續階段；超過 40 秒未收到 phase 或 heartbeat 事件 SHALL 顯示「重新連線中」。

#### Scenario: No groups configured
- **WHEN** 尚未設定任何組別
- **THEN** 學生頁面顯示「老師尚未設定組別」而非空白清單

#### Scenario: Synchronize phase updates
- **WHEN** server 推送 phase 事件
- **THEN** 已進場學生頁面更新為事件中的階段

#### Scenario: Show reconnecting after missed events
- **WHEN** 連線超過 40 秒未收到任何 phase 或 heartbeat 事件
- **THEN** 學生頁面顯示「重新連線中」並依 SSE 重連及 session 摘要恢復
