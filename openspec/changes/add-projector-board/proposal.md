# Proposal

## Why

共同契約 D16（E4）規定要有投影看板，兩組都已同意（Confirmed）。本組目前沒有：

- 老師只能把控制台投影出去，但控制台在搶答中會顯示各組答案與送出數量，等於讓全班看到他組作答，違反 D16 與 D7 的隱私要求；
- server 沒有追蹤各組是否在線，D16 要求的「各組是否在線」無從顯示；
- 結束後沒有「逐題揭曉」的畫面，老師無法一題一題公布答案。

這是倒數（已完成）之外，E4 剩下的部分，也是最後一個 P2 功能。

對應 `docs/explore_summary.md`：
- 第 2 節 D7、D15、D16；
- 第 5 節模組表 `projection-board`；
- 第 7 節「隱私與推送」。

## What Changes

**投影看板頁**（`/teacher/board.html`）
- 只有已登入老師的瀏覽器能開啟，未登入時說明要先在教師控制台登入，並附連結。
- **準備中**：顯示階段與各組是否在線。
- **搶答中**：顯示階段、倒數剩餘時間（有設定時）與各組是否在線。不顯示任何作答資訊，包含送出數量、題目是否已被搶走。
- **已結束**：顯示「搶答結果」，每題一開始都是「尚未揭曉」。
  - 「揭曉下一題」依題號順序揭曉一題；
  - 「全部揭曉」一次揭曉全部；
  - 揭曉後顯示成功組別與答案，無人作答的題目顯示「無人作答」，公平順位改判的題目加註。
- 揭曉進度只存在這個頁面，重新整理或重設活動後回到全部未揭曉。
- 階段變化、在線狀態變化在 2 秒內更新，不需重新整理。

**各組在線狀態**（server）
- 某組至少有一位已進場學生的事件連線開著時，該組為在線。
- 新增老師專用端點 `GET /api/teacher/presence`，回傳各組在線狀態。
- 學生連線開啟或關閉、進場或換組、組別設定變更、重設活動時，對已登入老師的連線送出 `presence` 通知。通知不含任何作答或組別細節。
- 學生與公開連線不會收到在線資訊。

**教師控制台**
- 新增「開啟投影看板」連結，在新分頁開啟看板。

**不在範圍**
- 由控制台遙控看板的揭曉進度（使用者已選定由看板自己控制）。
- 控制台本身顯示各組在線（另案，若有需要再加）。
- 學生頁：不受影響。

## Capabilities

### New Capabilities

- `projection-board`：投影看板的顯示內容、各階段可見資訊、揭曉流程，以及供看板使用的各組在線狀態與通知。

### Modified Capabilities

- `teacher-console`：新增「開啟投影看板」連結的 requirement。

## Impact

- **server**：`server/index.js`（在線狀態計算、`GET /api/teacher/presence`、`presence` 通知）。
- **前端**：新增 `public/teacher/board.html`、`board.js`、`board-logic.js`（含測試）；`public/teacher/index.html` 加連結。
- **API 與文件**：`docs/api-contract.md` 新增在線狀態端點與 `presence` 事件；`docs/explore_summary.md` 模組表更新進度。
- **依賴**：沿用 `add-countdown-and-reset` 的 `countdownEndsAt`、`add-fair-ranking` 的 `winnerSource`。本分支從 `feat/student-fair-ranking-notice` 開出，需在前面的 PR 合併後再合併。
