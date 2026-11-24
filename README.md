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

預設 server 綁定 `0.0.0.0:3000`，由 `HOST`、`PORT` 環境變數控制。學生入口為 `http://localhost:3000/student/`，教師控制台為 `http://localhost:3000/teacher/`。

Windows 防火牆第一次詢問是否允許 Node.js 網路存取時，若需要區網裝置連線，請選「私人網路」。

## 老師密碼

老師端（組別設定、匯入、開始與結束搶答）需要先以密碼登入，密碼由 `TEACHER_PASSWORD` 設定。第一次使用時，在專案根目錄：

```powershell
Copy-Item .env.example .env
```

用編輯器打開 `.env`，把 `TEACHER_PASSWORD=replace-me` 改成自己的密碼，再執行 `npm start`。`.env` 已列在 `.gitignore`，不會被提交；請不要使用與其他服務相同的密碼，因為課堂環境以 HTTP 傳送。

- 沒有設定密碼時，教師頁會說明需要先設定，任何密碼都無法登入。
- 登入後重新整理頁面不需再登入；按「登出」、關閉瀏覽器或 server 重新啟動後需重新登入。
- 同一台裝置 60 秒內密碼錯誤 10 次，會暫時無法登入，等一分鐘即可。
- 老師可以用 localhost，也可以用手機或其他電腦以 `http://<區網IP>:3000/teacher/` 登入操作。每個網址的登入狀態分開，換網址要重新登入。

## 環境變數

以 `npm start`（或 `node server/index.js`）啟動時，若專案根目錄有 `.env` 會自動載入，不需要額外套件。已在 shell 設定的環境變數優先於 `.env`。

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
| `TEACHER_PASSWORD` | 老師登入密碼；未設定或為空時老師無法登入 | 未設定 |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Google 服務帳號 JSON 金鑰檔的路徑（檔案放 repository 外），用於寫回 Google 試算表；未設定時只能下載 xlsx | 未設定 |
| `NODE_ENV` | 只有精確設為 `development` 才載入開發種子與開發階段路由 | 未設定 |

`NODE_ENV` 設為 `development` 以外的任何值，或未設定，都是一般模式：不載入種子資料，也不掛載開發路由。一般驗收與正式使用請保持未設定。

`NODE_ENV=development` 會載入 50 題假題目與 100 組種子，並掛載 `/api/dev/phase/:phase`。

不可將真實密碼或金鑰提交到 repository，repository 只放不含真實值的 `.env.example`。

## 測試

```sh
npm test
```

執行 Node.js 內建測試 runner。

## 開始與結束搶答

在教師控制台設定組別並匯入學習單後，按「開始搶答」；要結束時按「結束搶答」並再按一次「確認結束」。沒有組別或沒有題目時無法開始，畫面會說明缺少什麼。結束後不能重新開始。

也可以在 PowerShell 先登入再呼叫 API（`-SessionVariable` 保存登入的 cookie）：

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<老師密碼>"}' -SessionVariable teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/start -WebSession $teacher
Invoke-RestMethod -Method Post http://localhost:3000/api/session/end -WebSession $teacher
```

`/api/dev/phase/...` 是只在 `NODE_ENV=development` 掛載的開發捷徑，不需登入但只接受 localhost。中文階段值在 PowerShell 網址中請用百分比編碼（與自動測試一致）：

```powershell
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E6%90%B6%E7%AD%94%E4%B8%AD'
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E5%B7%B2%E7%B5%90%E6%9D%9F'
Invoke-RestMethod -Method Post 'http://localhost:3000/api/dev/phase/%E6%BA%96%E5%82%99%E4%B8%AD'
```

## 匯入學習單

登入教師控制台後，在「匯入學習單」區塊匯入 Guided Notes，只能在「準備中」操作。

1. 選擇 `.xlsx` 檔（5 MiB 以內）後按「讀取檔案」，或貼上 Google 試算表連結後按「讀取連結」。
2. 核對摘要：工作表、題數、空格數、每題是單題或題組、題組前綴，以及提醒事項。
3. 按「確認匯入」後題目才生效；按「取消」則維持原本的題目。再次匯入並確認會取代目前的題目。

學習單須有同一列寫著「題號」「題目」「作答」的表頭列，位置不限；表頭以下題號欄為數字的列是一題，題號儲存格向下合併多列為題組。使用 Google 試算表連結時，須在「共用」設定為「知道連結者可檢視」，不需要帳號或金鑰；若無法下載，請在 Google 試算表選「檔案 → 下載 → Microsoft Excel (.xlsx)」後改用上傳。

測試用學習單在 `fixtures/guided-notes/`，預期結果記錄在 `expected.json`。

API 細節見 [API 契約](docs/api-contract.md) 的「Guided Notes 匯入」一節。

## 匯出結果與寫回 Google 試算表

活動「已結束」後，教師控制台的「匯出結果」區塊可以把每題搶答成功組別的答案放回 Guided Notes：

- **寫回 Google 試算表**：只適用於以 Google 試算表連結匯入的學習單，答案直接寫進原線上試算表，只改答案儲存格的值，不動格式與其他內容。
- **下載 xlsx**：任何匯入方式都可用，也是寫回失敗時的備援。檔案以匯入時的內容為底，由 exceljs 重新產生，條件式格式、圖片等少數格式可能遺失。

寫回前 server 會重新讀取線上試算表，依「題號／題目／作答」表頭重新找到每題的位置，所以老師在匯入後插入或刪除列也能寫到正確題目；但題號被改掉或空格數不同時會拒絕寫入並說明原因。第二次寫回不會清除「這次無人作答、上一次留下的答案」。

### 設定服務帳號（只需做一次）

寫回使用 Google Cloud 服務帳號，不需要老師登入 Google。

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立（或選擇）一個專案。
2. 在「API 和服務 → 程式庫」搜尋「Google Sheets API」並啟用。
3. 在「IAM 與管理 → 服務帳號」建立服務帳號（不需要指派角色），進入該帳號的「金鑰」分頁，新增 JSON 金鑰並下載。
4. 把金鑰檔放在 repository **以外**的位置，例如 `C:\Users\<使用者>\.secrets\answering-sheets.json`。不要放進專案資料夾，也不要貼到聊天、群組或 issue。
5. 在 `.env` 加上金鑰檔路徑（只寫路徑，不寫金鑰內容）：

   ```
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=C:\Users\<使用者>\.secrets\answering-sheets.json
   ```

6. 重新啟動 server。登入後可確認設定：

   ```powershell
   Invoke-RestMethod http://localhost:3000/api/teacher/guided-notes/writeback -WebSession $teacher
   ```

   `configured` 為 `True` 且顯示服務帳號信箱即設定成功。金鑰檔不存在或格式錯誤時 server 仍會啟動，只是寫回停用，終端機會顯示一行「Google 服務帳號金鑰檔無法讀取，寫回功能停用。」。

### 每份試算表要做的事

1. 學習單必須是**原生 Google 試算表**。如果是上傳到雲端硬碟的 `.xlsx`，請先開啟後選「檔案 → 儲存為 Google 試算表」，再使用新檔案的連結。
2. 「共用」設定為「知道連結者可檢視」（匯入與寫回前重新讀取都需要）。
3. 把試算表共用給服務帳號信箱（`...@...iam.gserviceaccount.com`），權限設為「編輯者」。控制台的「匯出結果」區塊會顯示要共用的信箱。
4. 在教師控制台以連結匯入，活動結束後按「寫回 Google 試算表」。

寫回失敗時，區塊會顯示原因與下一步（例如沒有編輯權限時會顯示應共用的信箱），也可以直接改用「下載 xlsx」。錯誤代碼見 [API 契約](docs/api-contract.md) 的「Guided Notes 匯出」一節。

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
- `public/teacher/`：教師控制台（登入、活動狀態、開始與結束搶答、組別設定、學習單匯入）
- `fixtures/guided-notes/`：匯入用的測試學習單與預期結果
- `docs/`：需求摘要、API 契約與驗證紀錄
- `openspec/`：OpenSpec 規格與 change 文件

## 相關文件

- [需求探索摘要](docs/explore_summary.md)
- [API 契約](docs/api-contract.md)
- [驗證紀錄](docs/verification/)

## 目前進度

- 已完成：API 契約與 server 骨架、組別與學生進場、Guided Notes 匯入（上傳 xlsx 與 Google 試算表連結）、老師密碼登入與教師控制台（開始與結束搶答）。
- 下一步：搶答送出。
- 教師端監看與結果、重設活動、倒數、匯出寫回 Guided Notes 與 CSV 尚未完成。
