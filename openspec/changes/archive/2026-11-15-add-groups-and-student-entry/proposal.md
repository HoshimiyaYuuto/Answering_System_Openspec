# Proposal

## Why

活動開始前需要由教師快速設定組別，學生也需要不建立帳號就能選組進場。建立組別與進場能力後，學生可在多裝置間共享同組身分並於重新整理後恢復，同時由 server 保證搶答中不能換組。

## What Changes

- 新增組別清單、組別設定/一鍵產生、學生進場/恢復/準備階段換組 API，並同步更新 `docs/api-contract.md`。
- server 靜態提供 `public/student/` 與 `public/teacher/`；新增暫時最小教師組別設定頁，設定操作限 loopback。
- 新增輕量學生端選組/等待介面，以瀏覽器本地識別碼恢復進場，並依既有 session API 與 SSE 更新階段及連線提示。
- 組數最多 100；組名 1–30 字元且不重複；組別設定僅限準備中及 loopback。
- 本 change 不包含題目、作答、答案送出或正式教師端介面。

## Capabilities

### New Capabilities
- `groups-and-entry`: 組別設定、學生選組進場、換組、重新連線恢復，以及學生/暫時教師頁面的靜態提供。

### Modified Capabilities
- 無。既有 `api-contract-and-session-lifecycle` 行為不變；新端點細節寫入 API 契約文件並由新 capability 規範。

## Impact

- 修改 `server/` 以提供組別與學生進場 API、記憶體狀態及 `public/` 靜態檔案。
- 新增 `public/student/` 與 `public/teacher/` 輕量頁面/腳本及相關 server 自動測試。
- 更新 `docs/api-contract.md`，新增群組清單/設定、學生身分/進場/恢復端點。
- 對應 Explore 摘要第 2、3、5、6、7、8 節；依第 0 節規則小步修改並逐 task 驗證。
