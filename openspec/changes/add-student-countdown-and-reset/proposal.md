# Proposal

## Why

`add-countdown-and-reset` 已在 server 與教師控制台完成 D15 倒數與 D19 重設，但學生頁還沒跟上：

- **倒數**：老師設了倒數，學生頁卻看不到剩餘時間。SpecKit 的同一功能（001 AC-001-22）要求老師與所有學生看到的剩餘時間相差不超過 1 秒。
- **重設**：老師重設後，學生頁不認得 `reset` 事件，也不認得 `activity_reset`。要等瀏覽器重連失敗（約 5 秒）才回選組頁，畫面只顯示通用的「進場狀態無效」。D19 與 SpecKit 談定的文字是「活動已重設，請重新選擇組別」，而且所有畫面要在 2 秒內同步。

對應 `docs/explore_summary.md`：
- 第 2 節 D15、D19（v0.10 細節）；
- 第 4 節 O4（老師重設活動後清除草稿）；
- 第 5 節模組表 `countdown`（學生端顯示）。

## What Changes

**倒數顯示**
- 搶答中且有倒數時，作答區顯示「剩餘時間 m:ss」，每秒更新。
- 剩餘時間依 server 給的 `countdownEndsAt` 與 `serverTime` 計算，不依學生手機的時鐘。
- 歸零後顯示 0:00，直到收到「已結束」的階段變化，接著照既有流程顯示活動已結束。
- 沒有倒數或不在搶答中時不顯示。

**重設處理**
- 收到 `reset` 事件時：
  - 清除本機的進場與本場畫面狀態；
  - 2 秒內回到選組頁，顯示「活動已重設，請重新選擇組別」。
- 查詢進場得到 `activity_reset` 時，顯示同一句說明。這涵蓋重設時沒有連線，之後才重新整理或重連的學生。
- 重設前的草稿不會出現在新一場活動：沿用既有以 `activityId` 隔離草稿的做法，不另外刪除。

**不在範圍**
- server 與教師控制台：已由 `add-countdown-and-reset` 完成。
- 投影看板的倒數：屬於 `add-projector-board`。
- 等待畫面（準備中）與結果頁（已結束）不顯示倒數，因為這兩個階段不會有進行中的倒數。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `student-answering-ui`：新增「作答區顯示倒數剩餘時間」的要求。
- `groups-and-entry`：新增「重設後學生頁回到選組頁並說明原因」的要求。
  - 這裡用 ADDED，不改「Student entry survives refresh and reports invalidated membership」，因為那條要求正在 `add-countdown-and-reset` 修改中；兩個 change 改同一條要求，歸檔時會衝突。

## Impact

- **程式**：
  - `public/student/logic.js`：`activity_reset` 的說明文字、剩餘時間的純函式；
  - `public/student/app.js`：記錄 server 時鐘差、每秒更新剩餘時間、處理 `reset` 事件；
  - `public/student/index.html`：倒數顯示區。
- **API**：不新增或修改端點。只讀取 `add-countdown-and-reset` 已寫進 `docs/api-contract.md` 的 `countdownEndsAt`、`reset` 事件與 `activity_reset`。
- **依賴**：
  - 依賴 `add-countdown-and-reset`。本分支從 `feat/countdown-and-reset` 開出。
  - 那個 PR 與它之前的兩個作廢 PR 合併進 `main` 後，本 PR 才能合併。
- **負責人**：學生端 change。學生端成員目前無法開發，由教師端成員一人負責。
