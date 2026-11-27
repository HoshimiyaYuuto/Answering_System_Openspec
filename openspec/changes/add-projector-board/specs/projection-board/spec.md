# Spec Delta

## ADDED Requirements

### Requirement: Only a logged-in teacher can open the board
投影看板 SHALL 只在已登入老師的瀏覽器顯示活動內容。未登入或登入失效時，看板 SHALL 只顯示「請先在教師控制台登入」與前往控制台的連結，SHALL NOT 顯示階段以外的任何活動資訊。

#### Scenario: Not logged in
- **WHEN** 未登入老師的瀏覽器開啟投影看板
- **THEN** 頁面顯示「請先在教師控制台登入」與控制台連結，沒有組別、倒數或結果

#### Scenario: Logged in
- **WHEN** 已在教師控制台登入的瀏覽器開啟投影看板
- **THEN** 頁面顯示目前階段與該階段的看板內容

### Requirement: The board shows phase, countdown and presence before the end
活動為「準備中」或「搶答中」時，看板 SHALL 顯示目前階段與每組的組名及是否在線。搶答中且有倒數時 SHALL 顯示剩餘時間，剩餘時間 SHALL 依 server 時間計算。看板 SHALL NOT 顯示任何作答資訊，包含答案、送出數量、名次與題目是否已被搶走（D16、D7）。階段變化與在線狀態變化 SHALL 在 2 秒內反映在看板上，不需重新整理。

#### Scenario: Buzzing with a countdown
- **WHEN** 老師以 5 分鐘倒數開始搶答
- **THEN** 2 秒內看板顯示「搶答中」與剩餘時間，並列出每組是否在線

#### Scenario: Submissions stay hidden
- **WHEN** 搶答中第 1 組送出第 1 題
- **THEN** 看板畫面沒有任何改變，不顯示答案、送出數量或第 1 題已被作答

#### Scenario: A group comes online
- **WHEN** 第 3 組學生進場並連上
- **THEN** 2 秒內看板上第 3 組顯示為在線

#### Scenario: A group goes offline
- **WHEN** 第 3 組唯一的學生關閉頁面
- **THEN** 2 秒內看板上第 3 組顯示為離線

### Requirement: The board reveals results question by question after the end
活動為「已結束」時，看板 SHALL 顯示「搶答結果」，所有題目一開始 SHALL 為「尚未揭曉」。「揭曉下一題」SHALL 依題號順序揭曉下一個尚未揭曉的題目；「全部揭曉」SHALL 揭曉所有題目。揭曉的題目 SHALL 顯示成功組別與答案；無人作答的題目 SHALL 顯示「無人作答」；勝者因公平順位改判的題目 SHALL 加註「（公平順位改判）」。尚未揭曉的題目 SHALL NOT 顯示勝者或答案。全部揭曉後，揭曉按鈕 SHALL 停用。揭曉進度 SHALL 只保存在該看板頁面；重新整理或活動重設後 SHALL 回到全部未揭曉。

#### Scenario: Reveal one by one
- **WHEN** 活動結束後，老師在看板上按兩次「揭曉下一題」
- **THEN** 第 1、2 題顯示成功組別與答案，第 3 題之後仍為「尚未揭曉」

#### Scenario: Reveal all
- **WHEN** 老師按「全部揭曉」
- **THEN** 所有題目都顯示結果，兩個揭曉按鈕都停用

#### Scenario: Unanswered and re-judged questions
- **WHEN** 揭曉的第 4 題無人作答，第 3 題勝者因公平順位改判
- **THEN** 第 4 題顯示「無人作答」，第 3 題顯示勝者、答案與「（公平順位改判）」

#### Scenario: Reload resets the reveal
- **WHEN** 已揭曉 2 題後重新整理看板
- **THEN** 所有題目回到「尚未揭曉」

#### Scenario: Reset hides the results
- **WHEN** 老師在控制台重設活動
- **THEN** 2 秒內看板回到準備中畫面，不再顯示任何結果

### Requirement: The server reports group presence only to teachers
server SHALL 以「該組至少有一位有效進場學生的事件連線開著」判定該組在線。已登入老師 SHALL 能讀取每組的組別編號、組名與是否在線；未登入 SHALL 收到 `401 TEACHER_AUTH_REQUIRED`。學生連線開啟或關閉、學生進場或換組、組別設定變更、活動重設時，server SHALL 在 2 秒內通知已登入老師的連線「在線狀態已改變」；通知 SHALL NOT 含任何作答或組別資料。學生連線與未帶身分的公開連線 SHALL NOT 收到在線通知，公開的活動摘要也 SHALL NOT 包含在線資訊。

#### Scenario: Presence for a connected group
- **WHEN** 第 2 組有一位學生進場並開著事件連線，第 1 組沒有
- **THEN** 老師讀取在線狀態，第 2 組為在線、第 1 組為離線

#### Scenario: Two devices in one group
- **WHEN** 第 2 組兩台裝置都連著，其中一台關閉
- **THEN** 第 2 組仍為在線

#### Scenario: Not logged in
- **WHEN** 未登入時讀取在線狀態
- **THEN** server 回傳 `401 TEACHER_AUTH_REQUIRED`

#### Scenario: Only teachers are notified
- **WHEN** 第 3 組學生連上
- **THEN** 已登入老師的連線收到在線通知，學生連線與公開連線沒有收到
