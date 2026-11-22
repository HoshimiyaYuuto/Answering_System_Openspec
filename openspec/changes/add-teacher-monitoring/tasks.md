# Tasks: add-teacher-monitoring

前提：`add-buzz-in-submission`（PR #8）與 `add-results-computation`（PR #9）都已合併到 main；apply 前先把本分支更新到最新的 main，確認 `server/submissions.js`、`server/results.js` 存在且介面與 design 的 Context 一致，不一致時先停下來更新 design。

自動測試沿用既有做法：`createApplication({ teacherPassword: 'test-password', submissions })`，先 `POST /api/teacher/login` 取得 cookie；作答一律以注入的 `createSubmissions()` 呼叫 `submit()` 建立，或經 `POST /api/student/submissions` 送出。

## 1. 監看資料與查詢端點

- [x] 1.1 新增 `server/teacher-monitor.js` 與 `server/teacher-monitor.test.js`：`buildMonitor()`（design 第 1 節）；驗證：`node --test server/teacher-monitor.test.js` 涵蓋 3 組中只有第 1 組送出時另兩組在 `notSubmitted`、A 先 B 後時 A 為第 1 名且為勝者、已作廢作答 `place` 為 null 且由順位 2 勝出、只有作廢作答的組別不在 `notSubmitted`、作廢後重送的組別兩筆都在 `entries`、無作答題目 `winner` 為 null、`settled: false` 的結果 `winner` 為 null、題目依題號排序、組別不存在時組名為 `組 <id>`、輸入不被修改
- [x] 1.2 在 `server/index.js` 新增 `GET /api/teacher/monitor`（`requireTeacher`，以 `computeResults()` 與 `submissions.listSubmissions()` 呼叫 `buildMonitor()`），新增 `server/teacher-monitor-api.test.js`，並在 `docs/api-contract.md` 新增「老師監看」一節（design 第 6 節）；驗證：`npm test` 涵蓋未登入 401 `TEACHER_AUTH_REQUIRED`、準備中每題每組皆在 `notSubmitted`、搶答中兩組經學生 API 送出後名次與答案正確、結束後仍可查詢且結果相同、查詢前後 `GET /api/session` 相同、50 組 × 50 題全部送出後查詢在 200 毫秒內完成；回應欄位與契約範例一致

## 2. 老師即時通知

- [x] 2.1 在 `server/index.js` 讓 `GET /api/events` 支援 `role=teacher`：未登入回 401 且不建立連線，成功時保存 `teacherToken`，每次送出後對 token 仍有效的老師連線送 `monitor` 事件（design 第 2 節）；新增 `server/teacher-monitor-events.test.js`，並在 `docs/api-contract.md` 的 `/api/events` 一節補上 `role=teacher` 與 `monitor` 事件；驗證：`npm test` 涵蓋老師連線在送出後 2 秒內收到 `monitor` 且內容只有 `serverTime`、未登入以 `role=teacher` 連線得 401、登出後的老師連線不再收到 `monitor`、同時連線的學生連線與公開連線都沒收到 `monitor`、學生連線仍照 PR #8 收到自己組的 `submission`、老師連線仍收到 `phase`

## 3. 控制台監看區塊

- [x] 3.1 新增 `public/teacher/monitor-logic.js` 與 `public/teacher/monitor-logic.test.js`：狀態、事件、節流與 `getMonitorView()`（design 第 3、4 節）；驗證：`npm test` 涵蓋過期的 `monitorLoaded` 被丟棄、載入中收到多次 `changed` 只再查一次、查詢失敗保留舊資料、準備中只顯示提示、搶答中顯示「已送出 N／M 組」與第 1 名、已結束標題為「搶答結果」並顯示勝者、無勝者顯示「無人作答」、`settled: false` 顯示「判定中」、展開內容的名次、已作廢、答案與本地時間格式
- [x] 3.2 修改 `public/teacher/index.html`：在「活動狀態」之後新增「作答監看」區塊（標題、提示、題目清單容器）；驗證：`npm start` 後開啟 `http://localhost:3000/teacher/` 並登入，區塊存在，準備中顯示「開始搶答後會顯示各組作答」
- [x] 3.3 修改 `public/teacher/app.js`：以 `role=teacher` 連線事件，`monitor`、`phase`、`open` 與登入後觸發 `changed`，依 3.1 的邏輯查詢與重建畫面（`replaceChildren`、`textContent`、保留展開狀態），401 沿用 `handleAuthError`（design 第 5 節）；驗證：`npm test` 通過，並依下列步驟操作（`.env` 設定測試用密碼），結果記錄於 `docs/verification/add-teacher-monitoring.md`：
  1. 老師在 `http://localhost:3000/teacher/` 登入，設定 2 組並上傳 `02-official-group.xlsx`，監看區塊顯示準備中的提示。
  2. 以 `http://127.0.0.1:3000/student/` 與 `http://<區網 IP>:3000/student/` 兩個視窗分別以第 1 組、第 2 組進場（學生頁尚未完成時，改用 PowerShell 呼叫 `PUT /api/student/entry`）。
  3. 老師開始搶答，第 1 組先、第 2 組後送出第 1 題（學生頁尚未完成時，改用 PowerShell 呼叫 `POST /api/student/submissions`），2 秒內老師端第 1 題顯示已送出 2／2 組、第 1 名為第 1 組；展開後第 1 組第 1 名、第 2 組第 2 名（AC-000-05）。
  4. 展開第 1 題後，第 2 組再送出第 2 題，第 1 題保持展開。
  5. 送出答案 `<b>粗體</b>`，畫面顯示原字串而不是粗體。
  6. 老師結束搶答，2 秒內標題變為「搶答結果」，第 1 題顯示第 1 組與答案，沒人作答的題目顯示「無人作答」（AC-000-07）。
  7. 以學生頁與 `curl.exe -N http://localhost:3000/api/events` 確認學生與公開連線沒有收到 `monitor` 事件（AC-S-07）。
  8. 在 `http://<區網 IP>:3000/teacher/` 另開老師頁登入，畫面與 localhost 相同；在其中一頁登出後，另一頁下一次更新時回到登入畫面。

## 4. 整合檢查

- [x] 4.1 以最新 main 重跑全部測試與容量檢查，並補完 `docs/verification/add-teacher-monitoring.md` 的環境與未測項目；驗證：`npm test` 全部通過，`npm run check:capacity` 通過，`openspec validate add-teacher-monitoring --strict` 通過

## Workflow follow-up

- 開 PR 請學生端成員 review，合併後執行 archive。
