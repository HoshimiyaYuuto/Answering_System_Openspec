# Spec Delta: groups-and-entry

## RENAMED Requirements

- FROM: `### Requirement: Group configuration is limited to loopback during preparation`
- TO: `### Requirement: Group configuration is limited to the teacher during preparation`

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Temporary teacher page only configures groups
**Reason**: `/teacher/` 臨時頁由正式教師控制台取代，組別設定與匯入成為控制台的一部分。
**Migration**: 教師頁行為改由 `teacher-console` 能力規範；組別設定與匯入 API 的權限改由 `teacher-auth` 規範。
