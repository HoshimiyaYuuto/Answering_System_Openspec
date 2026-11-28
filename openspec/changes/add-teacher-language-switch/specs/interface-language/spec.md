# Spec Delta

## ADDED Requirements

### Requirement: The teacher console offers Traditional Chinese and English
教師控制台 SHALL 在畫面右上角提供「中文」與「EN」語言切換器，未登入、未設定密碼與已登入的畫面都可使用。預設語言、記憶與跨分頁同步的規則 SHALL 與學生頁相同，且兩者共用同一個選擇。切換後，控制台所有介面文字 SHALL 立即改為該語言，包含登入、活動狀態、開始／結束／重設與確認、倒數與公平順位設定、組別設定、學習單匯入摘要、作答監看與搶答結果、作廢確認、匯出與寫回的按鈕與訊息。`<html lang>` 與分頁標題 SHALL 跟著改變。

#### Scenario: Console in English
- **WHEN** 已登入的老師在準備中按「EN」
- **THEN** 活動狀態、按鈕、組別設定與匯入區塊都變成英文，`<html lang>` 為 `en`

#### Scenario: Login screen in English
- **WHEN** 未登入的瀏覽器語言為英文，開啟教師控制台
- **THEN** 登入畫面為英文；密碼錯誤時顯示英文的錯誤訊息

#### Scenario: Shared choice with the student page
- **WHEN** 同一個瀏覽器開著學生頁與教師控制台，在教師控制台切換成英文
- **THEN** 學生頁也變成英文

### Requirement: Switching language keeps the console state
在教師控制台切換語言 SHALL NOT 重新載入頁面，也 SHALL NOT 清除畫面上的狀態：尚未確認的匯入預覽、組別編輯中的內容、倒數與公平順位的設定、開啟中的確認對話框、匯出結果訊息都 SHALL 保留，只改變顯示語言。

#### Scenario: Pending import preview survives
- **WHEN** 老師上傳學習單看到預覽摘要，尚未按確認就切換成英文
- **THEN** 預覽摘要仍在且變成英文，按確認仍可套用

#### Scenario: Confirm dialog survives
- **WHEN** 搶答中老師按「結束搶答」出現確認，接著切換語言
- **THEN** 確認仍顯示（變成另一種語言），按確認後活動結束

### Requirement: The projector board offers Traditional Chinese and English
投影看板 SHALL 在畫面右上角提供「中文」與「EN」語言切換器，規則與教師控制台相同。切換後，階段、倒數、在線狀態、搶答結果、揭曉按鈕與「尚未揭曉」「無人作答」「公平順位改判」等文字 SHALL 立即改為該語言。切換 SHALL NOT 重新載入頁面，已揭曉的進度 SHALL 保留。

#### Scenario: Board switches during reveal
- **WHEN** 看板已揭曉 3 題後老師按「EN」
- **THEN** 看板變成英文，仍是已揭曉 3 題，第 4 題之後仍為未揭曉

#### Scenario: Login notice in English
- **WHEN** 未登入的英文瀏覽器開啟看板
- **THEN** 顯示英文的「請先在教師控制台登入」說明與連結

### Requirement: Import warnings follow the interface language
匯入摘要中的提醒 SHALL 依介面語言顯示：繁體中文介面顯示與現在相同的文字；英文介面 SHALL 顯示英文，且不出現中文原文。學習單名稱、工作表名稱、儲存格位置與題號 SHALL 原樣顯示。

#### Scenario: Answer cell already has content
- **WHEN** 英文介面匯入一份第 2 題作答格已有內容的學習單
- **THEN** 摘要的提醒以英文說明第 2 題第 1 格（含儲存格位置）已有內容、匯出時會被取代
