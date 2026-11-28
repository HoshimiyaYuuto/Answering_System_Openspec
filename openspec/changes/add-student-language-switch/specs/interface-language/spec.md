# Spec Delta

## ADDED Requirements

### Requirement: The student page offers Traditional Chinese and English
學生頁 SHALL 在畫面右上角提供語言切換器，包含「中文」與「EN」兩個選項，並標示目前的語言。切換後，學生頁所有介面文字 SHALL 立即改為該語言，包含：標題、按鈕、階段名稱、題號格狀態、提示、錯誤訊息、倒數、結果摘要、名次與公平順位說明。

#### Scenario: Switch to English
- **WHEN** 學生在選組畫面按「EN」
- **THEN** 畫面標題、按鈕與提示都變成英文，「EN」標示為目前語言

#### Scenario: Switch back to Chinese
- **WHEN** 學生在英文介面按「中文」
- **THEN** 介面回到繁體中文

#### Scenario: Results in English
- **WHEN** 英文介面的學生在活動結束後查看結果，第 3 題因公平順位改判
- **THEN** 摘要、每題的名次、「無人作答」「本組未作答」與公平順位說明都以英文顯示

### Requirement: The interface language defaults to the browser and is remembered
沒有使用者選擇時，介面語言 SHALL 依瀏覽器的語言清單判定：第一個以 `en` 開頭的語言為英文，第一個以 `zh` 開頭的語言為繁體中文，兩者都沒有時為繁體中文。使用者選擇後，選擇 SHALL 記在該瀏覽器，重新整理後保留；同一個瀏覽器的其他分頁 SHALL 跟著改變。瀏覽器不允許儲存時，介面 SHALL 仍可切換，只是不保留。

#### Scenario: English browser
- **WHEN** 瀏覽器語言清單為 `en-US`、`zh-TW`，且從未選擇過
- **THEN** 學生頁以英文顯示

#### Scenario: Other language browser
- **WHEN** 瀏覽器語言清單只有 `ja-JP`
- **THEN** 學生頁以繁體中文顯示

#### Scenario: Choice survives reload
- **WHEN** 學生選擇「中文」後重新整理
- **THEN** 介面仍是繁體中文，即使瀏覽器語言是英文

#### Scenario: Other tabs follow
- **WHEN** 同一個瀏覽器開著兩個學生頁分頁，其中一個切換成英文
- **THEN** 另一個分頁也變成英文

### Requirement: The page language is declared for assistive technology
頁面的 `<html lang>` SHALL 與介面語言一致（英文為 `en`，繁體中文為 `zh-TW`），初次載入與每次切換後都 SHALL 更新。分頁標題與螢幕閱讀器讀到的標籤（例如題號按鈕、空格輸入框的名稱）SHALL 使用目前的語言。

#### Scenario: Language attribute follows the switch
- **WHEN** 學生切換成英文
- **THEN** `<html lang>` 為 `en`，分頁標題與題號按鈕的可讀名稱為英文

### Requirement: Server error messages follow the interface language
伺服器回應 SHALL 維持繁體中文，API 與共用契約 SHALL NOT 因語言而改變。英文介面顯示伺服器錯誤時，SHALL 依錯誤代碼顯示對應的英文訊息；沒有對應英文的代碼 SHALL 顯示伺服器原文。繁體中文介面 SHALL 顯示與現在相同的訊息。

#### Scenario: Known error code in English
- **WHEN** 英文介面的學生在準備中以外的階段嘗試換組，伺服器回 `GROUP_CHANGE_NOT_ALLOWED`
- **THEN** 頁面顯示該代碼的英文訊息

#### Scenario: Unknown error code
- **WHEN** 英文介面收到沒有對應英文的錯誤代碼
- **THEN** 頁面顯示伺服器回傳的原文

### Requirement: Content entered by people is never translated
組名、題目、空格提示、學生答案 SHALL 原樣顯示，不因介面語言改變。切換語言 SHALL NOT 改變任何行為，包括作答、草稿、送出、鎖定、名次、結果、重連與重設的處理。

#### Scenario: Answers stay as typed
- **WHEN** 學生以繁體中文送出答案「水」後切換成英文
- **THEN** 結果與題號頁仍顯示「水」，組名仍是「第 1 組」

#### Scenario: Draft survives a language switch
- **WHEN** 學生在第 2 題輸入草稿但尚未送出，接著切換語言
- **THEN** 第 2 題的草稿仍在，題號格顯示為草稿狀態
