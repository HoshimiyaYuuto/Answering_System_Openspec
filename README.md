# 課堂搶答系統

以 Node.js、Express 與原生 HTML/CSS/JavaScript 建置的課堂搶答系統。老師匯入填空式學習單（Guided Notes）後開啟搶答，各組以自己的裝置每題搶答，server 收到順序最快的組別為該題成功答案。系統不判斷答案對錯。

## 環境需求

- Node.js：已在 `v26.13.1` 驗證（`package.json` 未設定 `engines`，最低支援版本未驗證）
- npm（隨 Node.js 安裝）
- Windows、macOS 或 Linux

```sh
node --version
npm --version
```

## 安裝與啟動

在專案根目錄執行：

```sh
npm install
npm start
```

預設 server 綁定 `0.0.0.0:3000`，由 `HOST`、`PORT` 環境變數控制。學生入口為 `http://localhost:3000/student/`。

組別設定與階段控制端點依實際連線來源限制為 loopback，不信任 `X-Forwarded-For` 等轉發標頭。教師操作請使用 `http://localhost:3000/teacher/` 或 `http://127.0.0.1:3000/teacher/`，兩者都是 loopback，寫入請求會被接受。以區網 IP 開啟時，頁面會顯示警告且無法設定組別，server 也會以 `403 LOOPBACK_ONLY` 拒絕寫入。

Windows 防火牆第一次詢問是否允許 Node.js 網路存取時，若需要區網裝置連線，請選「私人網路」。

## 環境變數

`.env.example` 可複製成 `.env` 作為設定範本，但目前程式不會自動載入 `.env`（沒有 dotenv 套件），請在啟動的 shell 設定環境變數。教師密碼功能完成時再決定如何載入。

PowerShell：

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
npm start
```

macOS／Linux（POSIX shell）：

```sh
HOST=0.0.0.0 PORT=3000 npm start
```

| 變數 | 用途 | 預設值 |
| --- | --- | --- |
| `HOST` | HTTP server 綁定位址 | `0.0.0.0` |
| `PORT` | HTTP server 連接埠 | `3000` |
| `NODE_ENV` | 只有精確設為 `development` 才載入開發種子與開發階段路由 | 未設定 |

`NODE_ENV` 設為 `development` 以外的任何值，或未設定，都是一般模式：不載入種子資料，也不掛載開發路由。一般驗收與正式使用請保持未設定。

`NODE_ENV=development` 會載入 50 題假題目與 100 組種子，並掛載 `/api/dev/phase/:phase`。

`.env.example` 還列有 `TEACHER_PASSWORD`，但目前 server 未使用此變數。不可將真實密碼或金鑰提交到 repository。

## 測試

```sh
npm test
```

執行 Node.js 內建測試 runner。

## 開始與結束搶答

`POST /api/session/start` 與 `POST /api/session/end` 不需 development 環境、request body 為空，且只接受 loopback 來源。可在本機 PowerShell 呼叫：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start
Invoke-RestMethod -Method Post http://localhost:3000/api/session/end
```

這兩個端點執行正式的階段轉換。`/api/dev/phase/...` 是只在 `NODE_ENV=development` 掛載的開發捷徑，中文階段值在 PowerShell 網址中請用百分比編碼（與自動測試一致）：

```powershell
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD'
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E5%B7%B2%E7%B5%90%E6%9D%9F'
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E6%BA%96%E5%82%99%E4%B8%AD'
```

## 容量驗證

```sh
npm run check:capacity
```

`package.json` 將此指令對應到 `node server/capacity-check.js`。腳本自行建立 development app 並監聽隨機 loopback 連接埠，不需要先執行 `npm start`。它確認種子至少有 50 題，建立 100 條 SSE 連線，觸發「搶答中」階段事件，並斷言所有連線在 2 秒內收到事件，結束時會關閉連線與 server。成功時輸出連線數、題數、最大延遲，以及 2 秒內全數收到的結果。

## 模擬多位學生

同一個瀏覽器的所有視窗與分頁共用同一份 `localStorage`，因此是同一位學生。開啟下列三個不同來源，儲存空間彼此獨立，可模擬三位學生：

- `http://localhost:3000/student/`
- `http://127.0.0.1:3000/student/`
- `http://<區網IP>:3000/student/`

## 專案結構

- `server/`：Express server、SSE、測試與容量驗證腳本
- `public/student/`：學生頁面
- `public/teacher/`：教師組別設定臨時頁（正式教師端由隊友負責）
- `docs/`：需求摘要、API 契約與驗證紀錄
- `openspec/`：OpenSpec 規格與 change 文件

## 相關文件

- [需求探索摘要](docs/explore_summary.md)
- [API 契約](docs/api-contract.md)
- [驗證紀錄](docs/verification/)

## 目前進度

- 已完成：API 契約與 server 骨架、組別與學生進場。
- 下一步：搶答送出。
- 教師端正式畫面與 Guided Notes 匯入匯出由隊友負責，尚未完成。
