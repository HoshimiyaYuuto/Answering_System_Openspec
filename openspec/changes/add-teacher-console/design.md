# Design: add-teacher-console

## Context

動機見 proposal.md。目前狀態：

- `server/index.js` 有三種老師權限檢查，都只看 `request.socket.remoteAddress` 是否為 loopback：
  - `loopbackOnly` 中介層：`/api/session/start`、`/end`、`GET /api/teacher/guided-notes`、`/api/dev/phase/:phase`。
  - `configureGroups()` 內的檢查：`PUT /api/groups`、`POST /api/groups/generate`。
  - `guidedNotesWriteGuard`：三個匯入寫入端點。
- 檢查順序的慣例是「來源 → 階段 → 內容」。錯誤一律為 `{"error":{"code","message"}}`。
- `/api/session/start` 只檢查階段，沒有組別或題目也能開始。
- `/api/events` 是 SSE，所有人共用，只推 `phase` 與 `heartbeat`。
- `public/teacher/` 是臨時頁：組別設定加上匯入區塊，以 `location.hostname` 判斷是否為 localhost，不是就停用操作。匯入狀態轉換寫在 `import-logic.js`（純函式，有測試）。
- `.env.example` 已有 `TEACHER_PASSWORD=replace-me`，但程式不會載入 `.env`。
- 測試以 `createApplication()` 在 `127.0.0.1` 起 server 後用 `fetch` 呼叫；`groups-entry.test.js` 與 `guided-notes-api.test.js` 另有「綁在非 loopback 網卡上應回 403」的測試。
- 參考 SpecKit 組 001 的老師登入行為（只比對可觀察行為，不參考程式）：密碼來自 `TEACHER_PASSWORD`，錯誤代碼 `WRONG_PASSWORD`、`TEACHER_PASSWORD_NOT_SET`、`TOO_MANY_ATTEMPTS`，每個來源每分鐘 10 次，重新整理不需再登入。

## Goals / Non-Goals

**Goals:**

- 一個 `requireTeacher` 中介層取代三種 loopback 檢查，新端點只要掛上它即可。
- 老師用手機或區網位址開啟教師頁，行為與 localhost 相同。
- SSE 與檔案上傳不需要額外處理就能帶著登入狀態。
- 錯誤代碼與 SpecKit 組相同，方便兩組互測。

**Non-Goals:**

- 不做 HTTPS；密碼在同網段以明文 HTTP 傳送（見 Risks）。
- 登入狀態不設逾時：維持到登出、關閉瀏覽器或 server 重啟。
- 不區分多位老師，所有已登入的瀏覽器權限相同。
- `/api/events` 維持公開，不區分老師與學生的事件。

## Decisions

### 1. 登入狀態放在 HttpOnly cookie

登入成功時 server 產生 32 bytes 隨機值（`crypto.randomBytes`，base64url）作為 token，存在記憶體的 `Set`，並以 cookie 交給瀏覽器：

```text
Set-Cookie: teacher_session=<token>; HttpOnly; SameSite=Strict; Path=/
```

| 選項 | 取捨 |
| --- | --- |
| **HttpOnly cookie（採用）** | 瀏覽器自動附在 `fetch`、檔案上傳與 `EventSource` 請求上；頁面 JavaScript 讀不到，XSS 也偷不走；`SameSite=Strict` 擋掉其他網站代送請求 |
| token 存 `sessionStorage`，放 `Authorization` 標頭（SpecKit 組的做法） | 每個 `fetch` 都要手動加標頭；`EventSource` 無法自訂標頭，之後老師專用的 SSE 要改用查詢字串帶 token，會留在 log 與瀏覽紀錄 |
| 簽章 cookie 或 JWT | 不需在 server 存 token，但無法讓登出立即失效，也要多管理一把簽章金鑰 |

兩種做法的可觀察行為相同（重新整理不需再登入），不影響兩組一致。

- 不設 `Max-Age`，關閉瀏覽器即失效；不設 `Secure`，因為課堂環境是 HTTP。
- cookie 由 server 自行解析 `Cookie` 標頭，不新增 `cookie-parser` 套件。
- server 重啟後 `Set` 清空，所有 token 失效，符合 spec。

### 2. 模組切分

- `server/teacher-auth.js`（新增）：`createTeacherAuth({ password, now })`，純邏輯，不碰 HTTP。
  - `isConfigured()`、`login(password, source)` 回傳 `{ token }` 或帶 `code` 與 `status` 的錯誤、`isValid(token)`、`logout(token)`。
  - `now` 可注入，測試不必真的等 60 秒。
- `server/index.js`：
  - `readTeacherToken(request)` 解析 cookie；`requireTeacher` 中介層。
  - 新增 `/api/teacher/login`、`/logout`、`/auth` 三個路由。
  - `createApplication()` 新增選項 `teacherPassword`（預設 `process.env.TEACHER_PASSWORD`）與 `now`，測試可直接傳入。

替代方案是把登入寫在 `index.js` 內；拆出模組能單獨測試密碼比對與次數限制，`index.js` 只負責接線。

### 3. 密碼比對使用固定時間

把輸入與設定的密碼各自做 SHA-256，再以 `crypto.timingSafeEqual` 比較兩個 32 bytes 的摘要。直接比較字串會因長度不同或前綴相同而提早結束，洩漏時間差；先雜湊可讓兩邊長度固定，`timingSafeEqual` 不會因長度不同而丟錯。

### 4. 嘗試次數限制

- 以 `request.socket.remoteAddress` 為來源，記錄每個來源最近 60 秒內的失敗時間。
- 累計 10 次失敗後，該來源的登入一律回 `429`，即使密碼正確，直到最早一次失敗超過 60 秒。
- 只計算失敗，成功登入不清除紀錄。每次呼叫時順便刪除超過 60 秒的紀錄，記憶體用量隨來源數而定（一間教室約 100 台）。
- 未設定密碼時直接回 `503`，不計入失敗。

### 5. `requireTeacher` 取代 loopback 檢查

檢查順序改為「登入 → 階段 → 內容」，未登入回 `401 TEACHER_AUTH_REQUIRED`。

| 端點 | 原本 | 改為 |
| --- | --- | --- |
| `PUT /api/groups`、`POST /api/groups/generate` | `configureGroups()` 內的 loopback | `requireTeacher` |
| `POST /api/session/start`、`/end` | `loopbackOnly` | `requireTeacher` |
| 匯入的三個寫入端點 | `guidedNotesWriteGuard` 內的 loopback | `requireTeacher` 後接只檢查階段的 guard |
| `GET /api/teacher/guided-notes` | `loopbackOnly` | `requireTeacher` |
| `/api/dev/phase/:phase` | `loopbackOnly` | 不變（只在 development 掛載，屬開發工具） |
| 學生端點、`GET /api/session`、`GET /api/groups`、`/api/events` | 公開 | 不變 |

`loopbackOnly` 與 `isLoopback` 只剩開發路由使用。`403 LOOPBACK_ONLY` 在契約中保留，但只用於開發路由。

上傳端點的 `requireTeacher` 放在 `express.raw()` 之前，未登入時不讀取 5 MiB 的內容。

### 6. 開始搶答的前提

`/api/session/start` 依序檢查：

1. 階段不是準備中 → `409 INVALID_PHASE_TRANSITION`
2. 沒有組別 → `409 NO_GROUPS`「請先設定組別。」
3. 沒有題目 → `409 QUESTIONS_REQUIRED`「請先匯入學習單。」

階段放在最前面，重複開始時的錯誤與現在相同。`NODE_ENV=development` 會放入 100 組與 50 題種子資料，開發與容量驗證不受影響。

### 7. `.env` 載入

只在 `server/index.js` 直接執行（`npm start`）時，若專案根目錄有 `.env` 就呼叫 Node 內建的 `process.loadEnvFile('.env')`。`createApplication()` 本身不讀檔，測試不會讀到開發者本機的 `.env`。

- 已在 shell 設定的環境變數優先，`.env` 不會覆蓋（已在 Node v24.22.0 實測）。
- 替代方案：
  - 新增 `dotenv` 套件：多一個相依套件。
  - 在 `npm start` 加 `node --env-file-if-exists=.env`：直接執行 `node server/index.js` 時不會載入。

### 8. 教師頁的畫面狀態機

教師頁從「臨時頁」改為控制台。`console-logic.js`（新增，純函式）負責畫面狀態，`import-logic.js` 拿掉 `isAllowedHost`，只依階段決定能否操作。

```text
                 GET /api/teacher/auth
  ┌──────────┐  ─────────────────────▶  passwordConfigured=false ──▶ ┌────────────┐
  │ checking │                                                       │ notConfig  │
  └──────────┘  ─▶ authenticated=false ─▶ ┌────────┐                 └────────────┘
        │                                 │ login  │◀──── logout / 任何 401
        │                                 └────────┘      （訊息：登入已失效）
        │                                   │ 登入成功
        └─▶ authenticated=true ────────────▶▼
                                          ┌─────────┐
                                          │ console │  子狀態依 phase：準備中／搶答中／已結束
                                          └─────────┘
```

| 畫面 | 由什麼決定 | 顯示 |
| --- | --- | --- |
| `checking` | 頁面剛載入 | 「讀取中…」 |
| `notConfigured` | `auth.passwordConfigured === false` | 設定 `TEACHER_PASSWORD` 後重新啟動的說明 |
| `login` | 未登入；附帶 `error` 訊息 | 密碼欄、登入按鈕、錯誤訊息 |
| `console` | 已登入；`summary` 來自 `GET /api/session` | 階段、組數、題數、開始／結束、組別設定、匯入、登出 |

控制台內的事件與按鈕：

| 事件 | 結果 |
| --- | --- |
| `GET /api/session` 回應、SSE `phase` 事件 | 更新 `summary`；收到 `phase` 後重新讀一次摘要，取得最新組數與題數 |
| 按「開始搶答」 | `starting`，按鈕停用；成功後更新階段；`409` 顯示訊息 |
| 按「結束搶答」 | 顯示「確定結束？」與「確認」「取消」；確認後 `ending` |
| 結束回 `409 INVALID_PHASE_TRANSITION` | 重新讀摘要；若已是「已結束」則視為成功、不顯示錯誤（兩個分頁同時結束） |
| 任何請求回 `401 TEACHER_AUTH_REQUIRED` | 回到 `login`，訊息「登入已失效，請重新登入。」 |
| 組別或匯入成功 | 重新讀摘要，更新組數與題數 |

| 按鈕 | 可用條件 |
| --- | --- |
| 開始搶答 | 階段為準備中，且沒有進行中的請求 |
| 結束搶答 | 階段為搶答中，且沒有進行中的請求 |
| 組別設定、匯入 | 階段為準備中 |
| 登出 | 一律可用 |

畫面一律以 `replaceChildren` 或 `textContent` 重繪。摘要可能同時被 SSE 與按鈕觸發讀取，沿用 `createRequestSequence()` 丟棄過期回應。

### 9. 與 `docs/api-contract.md` 的一致性

- 新增「老師登入」一節：三個端點、cookie 屬性、錯誤代碼。
- 「階段控制」「組別設定」「Guided Notes 匯入」三節的 loopback 說明改為「需老師登入，未登入回 `401 TEACHER_AUTH_REQUIRED`」，檢查順序改為登入 → 階段 → 內容。
- 開始搶答補上 `409 NO_GROUPS`、`409 QUESTIONS_REQUIRED`。
- 錯誤狀態表新增 `401 TEACHER_AUTH_REQUIRED`、`401 WRONG_PASSWORD`、`400 INVALID_LOGIN_REQUEST`、`429 TOO_MANY_ATTEMPTS`、`503 TEACHER_PASSWORD_NOT_SET`、`409 NO_GROUPS`、`409 QUESTIONS_REQUIRED`；`403 LOOPBACK_ONLY` 註明只用於開發路由。
- 成功回應維持 `{"data": ...}`；登入成功回 `{"data":{"authenticated":true}}`，不回傳 token。

### 10. 既有測試的調整

- 新增測試輔助函式：以測試用密碼登入並取得 `Cookie` 標頭。測試用密碼寫在測試檔內，是假的固定字串，不是真實密碼。
- `events.test.js`：開始與結束改為帶 cookie；開始前先設定組別並放入題目。
- `groups-entry.test.js`、`guided-notes-api.test.js`：
  - 原本「從非 loopback 網卡呼叫回 403」改為「未登入回 401、登入後從非 loopback 網卡可以操作」。
  - 原本的「偽造 `X-Forwarded-For` 不被採信」改為「偽造標頭也無法代替登入」。

這些檔案有一部分由學生端成員撰寫，改動會在 PR 說明中列出。

## Risks / Trade-offs

- [密碼以明文 HTTP 在區網傳送，同網段可監聽] → 課堂本機使用，需求不含 HTTPS；README 提醒不要使用與其他服務相同的密碼。
- [學校網路可能讓多台裝置共用同一個對外 IP，學生亂猜密碼時會讓老師也被限制] → 限制只持續 60 秒；server 依實際連線位址判定，同一區網內每台裝置通常有自己的位址。
- [改動學生端成員的路由與測試，可能和他正在開發的分支衝突] → 改動集中在權限檢查，不改各端點的商業邏輯；開工前在群組告知，PR 說明列出每個改動。
- [`guided-notes-import` 的 MODIFIED 依賴 `add-guided-notes-import` 先歸檔] → `openspec validate` 已提示；歸檔順序為 `add-guided-notes-import` 先、本 change 後。
- [登入狀態不逾時，忘記登出的瀏覽器一直有效] → 不設 `Max-Age`，關閉瀏覽器即失效；控制台提供登出按鈕。
- [沒設定密碼時老師無法操作任何東西] → 教師頁明確說明要設定 `TEACHER_PASSWORD`；README 與 `.env.example` 一併說明。

## Migration Plan

1. 合併後，在專案根目錄把 `.env.example` 複製成 `.env`，把 `TEACHER_PASSWORD` 改成自己的密碼，再 `npm start`。
2. 原本以 PowerShell 呼叫 `/api/session/start` 的方式需改成先登入；README 提供 PowerShell 範例（`-SessionVariable` 保存 cookie）。
3. 回復方式：revert 本 change 的 commit，權限檢查回到 loopback。資料都在記憶體，不需要資料遷移。
