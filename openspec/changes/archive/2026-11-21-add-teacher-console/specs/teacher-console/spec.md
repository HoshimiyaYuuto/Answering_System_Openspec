# Spec Delta: teacher-console

## Purpose

提供老師在課堂上操作整場活動的網頁控制台：登入後查看活動摘要、設定組別、匯入學習單，並開始與結束搶答。

## ADDED Requirements

### Requirement: Teacher page shows login, setup notice, or console by login status
`/teacher/` SHALL 依登入狀態顯示三種畫面之一：server 未設定密碼時顯示「需要先設定老師密碼」的說明且不提供登入表單；已設定密碼但未登入時顯示登入表單；已登入時顯示控制台。以 localhost、127.0.0.1 或區網位址開啟時行為 SHALL 相同。

#### Scenario: Open without login
- **WHEN** 未登入的老師開啟 `/teacher/`
- **THEN** 頁面只顯示登入表單，不顯示組別、匯入或階段控制

#### Scenario: Password not configured
- **WHEN** server 未設定老師密碼時開啟 `/teacher/`
- **THEN** 頁面說明需要先設定 `TEACHER_PASSWORD` 並重新啟動 server，不顯示登入表單

#### Scenario: Open from a LAN address
- **WHEN** 已登入的老師以區網位址開啟 `/teacher/`
- **THEN** 頁面顯示控制台，不顯示「只能以 localhost 開啟」的警告

### Requirement: Login form reports each failure reason
登入表單 SHALL 在密碼錯誤、嘗試次數過多、server 無回應時分別顯示對應訊息並留在登入畫面；登入成功 SHALL 切換到控制台。密碼欄位在失敗後 SHALL 清空。

#### Scenario: Wrong password
- **WHEN** 老師輸入錯誤密碼並送出
- **THEN** 頁面顯示密碼錯誤，仍在登入畫面，密碼欄位已清空

#### Scenario: Too many attempts
- **WHEN** server 回應嘗試次數過多
- **THEN** 頁面說明請稍後再試

#### Scenario: Successful login
- **WHEN** 老師輸入正確密碼並送出
- **THEN** 頁面切換到控制台並顯示目前活動摘要

### Requirement: Console shows the live session summary
控制台 SHALL 顯示目前階段、組數與題數，資料以 server 為準；其他分頁或裝置造成階段變化時，控制台 SHALL 在 2 秒內更新。組別設定或匯入成功後，組數與題數 SHALL 立即更新。

#### Scenario: Phase changed elsewhere
- **WHEN** 老師在另一個分頁開始搶答
- **THEN** 這個分頁的控制台在 2 秒內顯示「搶答中」

#### Scenario: Counts after setup
- **WHEN** 老師套用 5 組並匯入 6 題的學習單
- **THEN** 控制台顯示 5 組、6 題

### Requirement: Teacher starts the session from the console
控制台 SHALL 只在「準備中」提供可用的「開始搶答」按鈕。server 因沒有組別或沒有題目而拒絕時，控制台 SHALL 顯示原因並維持「準備中」。開始成功後控制台 SHALL 顯示「搶答中」。

#### Scenario: Start with groups and questions
- **WHEN** 已有組別與題目，老師按「開始搶答」
- **THEN** 控制台顯示「搶答中」，已進場學生在 2 秒內看到「搶答中」

#### Scenario: Start without questions
- **WHEN** 已有組別但沒有匯入題目，老師按「開始搶答」
- **THEN** 控制台顯示需要先匯入題目，階段維持「準備中」

### Requirement: Ending the session requires confirmation
「結束搶答」SHALL 只在「搶答中」可用，且按下後 SHALL 先要求老師再確認一次；取消時階段不變。同一結束操作被重複送出時，階段 SHALL 只變化一次，控制台 SHALL NOT 顯示錯誤，最後顯示「已結束」。

#### Scenario: Confirm ending
- **WHEN** 老師按「結束搶答」後選擇確認
- **THEN** 控制台顯示「已結束」，已進場學生在 2 秒內看到「已結束」

#### Scenario: Cancel ending
- **WHEN** 老師按「結束搶答」後選擇取消
- **THEN** 階段維持「搶答中」

#### Scenario: Ending twice
- **WHEN** 兩個分頁幾乎同時確認結束搶答
- **THEN** 階段只變成「已結束」一次，兩個分頁都顯示「已結束」且沒有錯誤訊息

### Requirement: Setup panels follow the phase
控制台 SHALL 包含組別設定與 Guided Notes 匯入區塊，兩者只在「準備中」可操作；其他階段 SHALL 停用並說明只能在準備中設定。

#### Scenario: Setup during preparation
- **WHEN** 已登入老師在「準備中」開啟控制台
- **THEN** 可以產生與套用組別，也可以匯入學習單

#### Scenario: Setup locked after start
- **WHEN** 活動進入「搶答中」
- **THEN** 組別設定與匯入操作停用，並說明只能在準備中設定

### Requirement: Expired login returns to the login screen
控制台的任何操作收到 `401 TEACHER_AUTH_REQUIRED` 時，頁面 SHALL 回到登入畫面並說明登入已失效。老師按「登出」後 SHALL 回到登入畫面。

#### Scenario: Server restarted while logged in
- **WHEN** server 重新啟動後，老師在控制台按任何操作按鈕
- **THEN** 頁面回到登入畫面並說明登入已失效，請重新登入

#### Scenario: Log out
- **WHEN** 老師按「登出」
- **THEN** 頁面回到登入畫面，重新整理後仍是登入畫面
