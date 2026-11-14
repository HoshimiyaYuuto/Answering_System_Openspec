# Proposal

## Why

學生端與教師端需要在平行開發前共用穩定的 API 行為與錯誤格式。先定義契約並建立最小 server 骨架，可讓後續功能沿同一套階段、同步與回應規則整合。

## What Changes

- 新增 API 契約文件，定義通用 JSON 回應、錯誤格式、核心唯讀狀態介面與階段控制介面。
- 建立可由同網段裝置連線的 server 骨架，提供唯一權威活動階段與題數、組數摘要。
- 定義準備中、搶答中、已結束的單向階段轉移，以及兩秒內推送階段變更的行為。
- 統一成功、客戶端錯誤、未知路徑與內部錯誤的 JSON 格式。
- 階段控制端點初期僅接受 loopback 請求；後續教師端 change 再以密碼驗證取代此開發限制。
- 摘要與階段 SSE 事件包含 server 時間，事件串流定期傳送心跳。

## Capabilities

### New Capabilities
- `api-contract-and-session-lifecycle`: 對外 API 契約、權威階段生命週期、階段同步與統一錯誤回應。

### Modified Capabilities
- 無。

## Impact

- 新增 `docs/api-contract.md` 與 `server/` 骨架；可能新增輕量 Node.js server 相依與 `.env.example`、`.gitignore` 設定。
- 後續學生端與教師端須依此契約呼叫 API。此 change 不包含組別進場、作答提交、匯入匯出、教師驗證或結果功能。
