# Spec Delta

## ADDED Requirements

### Requirement: Console links to the projector board
已登入的教師控制台 SHALL 提供「開啟投影看板」連結，在新分頁開啟投影看板，任何階段都可使用。未登入時 SHALL NOT 顯示這個連結。

#### Scenario: Open the board
- **WHEN** 已登入老師在控制台點「開啟投影看板」
- **THEN** 新分頁開啟投影看板，顯示目前階段的看板內容

#### Scenario: Hidden before login
- **WHEN** 老師尚未登入
- **THEN** 頁面沒有「開啟投影看板」連結
