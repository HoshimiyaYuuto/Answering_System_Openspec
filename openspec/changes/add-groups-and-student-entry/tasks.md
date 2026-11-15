# Tasks

## 1. API 契約

- [x] 1.1 更新 `docs/api-contract.md`，定義 `GET/PUT /api/groups`、`POST /api/groups/generate`、`GET/PUT /api/student/entry` 的 request/response、階段與 loopback 限制、`studentId` 格式、首次進場規則，以及錯誤代碼（例如 `INVALID_GROUPS`、`GROUP_NOT_FOUND`、`GROUP_CHANGE_NOT_ALLOWED`、`INVALID_STUDENT_ID`）；以逐 endpoint 對照 spec 核對文件欄位驗證，並在 PR 說明標註契約變更。

## 2. 組別 API

- [x] 2.1 新增 `server/groups-entry.js`（組別儲存與驗證：數量 1–100、id 為不重複正整數、名稱去空白後 1–30 字元且不重複、generate）與 `server/groups-entry.test.js` 單元測試；以 `npm test` 驗證。
- [x] 2.2 修改 `server/index.js` 掛載 `GET/PUT /api/groups`、`POST /api/groups/generate`，加入 loopback 與「準備中」檢查，`groupCount` 取自實際組別數，development 種子改走同一儲存；在測試檔補：非 loopback（含偽造 forwarded header）與非準備中被拒、PUT 可取代種子組別、production 起始為空；以 `npm test` 及 `Invoke-RestMethod http://localhost:3000/api/groups` 手動驗證。

## 3. 學生進場 API

- [ ] 3.1 在 `server/groups-entry.js` 實作 `studentId` 格式驗證、進場儲存、首次進場任一階段、換組僅限準備中、`GROUP_NOT_FOUND`、`group_removed` 與 `entry_reset` 失效原因，並在測試檔補單元測試；以 `npm test` 驗證。
- [ ] 3.2 在 `server/index.js` 掛載 `PUT/GET /api/student/entry`；測試補：免帳號首次進場、多個 `studentId` 共用同組、搶答中換組被拒、搶答中首次進場被接受、刪組後 GET 回 `valid:false`；以 `npm test` 及 `Invoke-RestMethod` 手動驗證。

## 4. 靜態頁面提供

- [ ] 4.1 在 `server/index.js` 掛載 `/student/`、`/teacher/` 靜態路徑，`/` 導向 `/student/`；測試補三個入口的回應，並以 `Invoke-WebRequest` 手動驗證。

## 5. 學生端

- [ ] 5.1 新增 `public/student/logic.js`（可同時被瀏覽器與 Node 載入的純函式：超過 40 秒無事件判定為「重新連線中」、進場恢復結果判斷）與 `public/student/logic.test.js`；以 `npm test` 驗證。
- [ ] 5.2 新增 `public/student/index.html` 與 `public/student/app.js`：組別清單（空清單顯示「老師尚未設定組別」）、選組、準備中等待畫面、選到不存在組別時重新讀取清單；以 `npm start` 後開啟 `http://localhost:3000/student/` 手動完成選組與等待流程。
- [ ] 5.3 更新 `public/student/app.js`：`localStorage` 保存 `studentId`、重新整理恢復、組別失效返回選組並說明原因、以 `phase` 與 `heartbeat` 同步階段、EventSource 重連後重新讀 session 與 entry；以兩個瀏覽器視窗手動驗證。

## 6. 臨時教師組別設定頁

- [ ] 6.1 新增 `public/teacher/index.html` 與 `public/teacher/app.js`，只提供組數產生、組名編輯與提交、localhost 使用提示，非 loopback 開啟時顯示唯讀提示；以 `npm start` 後開啟 `http://localhost:3000/teacher/` 手動確認頁面不含題目或正式教師功能。

## 7. 整合驗收

- [ ] 7.1 `npm test` 全部通過（含第一個 change 既有測試）；手動驗證：(a) 在 localhost 用 `/teacher/` 產生 5 組；(b) 兩個視窗選不同組、第三個視窗選同組；(c) 重新整理後恢復；(d) 老師開始後兩視窗兩秒內變「搶答中」；(e) 搶答中換組被拒；(f) 搶答中用沒有 localStorage 的新視窗首次進場成功；(g) 準備中移除某組，該組學生重新整理後回選組並顯示原因；(h) 手機以區網 IP 開 `/student/` 選組，並確認 `/teacher/` 的寫入被拒；(i) 重啟 server 後學生端顯示重新連線並回選組；結果記錄於 `docs/verification/`。
