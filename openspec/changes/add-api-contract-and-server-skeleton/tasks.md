# Tasks

## 1. 安全與環境設定

- [x] 1.1 建立 `.gitignore` 忽略 `.env`，並新增不含真實秘密的 `.env.example`；以 `git check-ignore .env` 確認忽略規則，並檢視範例無真值。

## 2. API 契約

- [x] 2.1 建立 `docs/api-contract.md`，列出摘要查詢、loopback 階段控制、SSE 事件與心跳、server 時間欄位、JSON envelope、body 大小上限及錯誤狀態；逐項比對 spec 確認契約完整。

## 3. Server 骨架與開發工具

- [x] 3.1 建立最小 Node.js/Express 專案設定與 server 啟動入口；執行啟動命令並由本機 HTTP 請求取得含 server 時間欄位的 JSON 摘要。
- [ ] 3.2 實作權威活動摘要、loopback 階段控制及單向轉移；本機呼叫合法與非法轉移並從非 loopback 測試來源呼叫控制端點，確認允許／拒絕符合契約並確認帶有偽造轉發標頭的非 loopback 請求仍被拒絕。
- [ ] 3.3 加入 development-only 固定假題目、100 組種子與階段切換指令；在 development 執行指令確認階段變化，在 production 啟動確認無種子資料且測試路由不存在並確認未設定環境變數時視為 production，不載入種子。
- [ ] 3.4 實作 SSE 階段事件、server 時間欄位、定期心跳及重連後摘要；以自動化測試驗證事件格式、心跳可觀察，並在兩秒內收到階段更新，並以 15 秒間隔驗證心跳確實送出。
- [ ] 3.5 實作 JSON body 解析錯誤、超限 body、未知路徑及未預期錯誤處理；自動測試各情境皆回傳契約 JSON code 與訊息，且不洩漏堆疊或機敏值。
- [ ] 3.6 建立容量驗證 task/script：啟動 100 個 SSE 連線、載入至少 50 題，再觸發階段變化並記錄延遲；驗證 100 個連線都在 2 秒內收到事件。
- [ ] 3.7 以同網段裝置取得摘要，確認讀取端可連線；同時執行自動測試套件並確認開發工具隔離及 SSE 行為均通過。
