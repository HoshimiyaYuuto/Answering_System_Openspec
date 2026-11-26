# Tasks: fix-student-entry-phase-race

> 說明：手動驗證以 `$env:NODE_ENV='development'; $env:TEACHER_PASSWORD='test-password'; npm start` 啟動（不使用 `.env` 的真密碼）。競態需要「請求已送出、回應尚未抵達時老師開始」，手動點擊很難對準，因此在學生頁的開發者工具 Console 暫時包住 `fetch`，讓 `GET /api/student/entry` 與 `GET /api/session` 的回應先停住，等老師按下開始後再放行。

## 1. 實作

- [x] 1.1 在 `public/student/logic.js` 與 `public/student/logic.test.js` 新增 `isPhaseSnapshotCurrent(requestPhaseVersion, currentPhaseVersion)` 與 `resolveResponsePhase({ responsePhase, currentPhase, requestPhaseVersion, currentPhaseVersion })`：版本已變時保留目前階段。驗證：`node --test public/student/logic.test.js`，涵蓋「進場回應準備中、事件已是搶答中」不回退、版本未變時採用回應、回應沒有階段時保留目前階段。
- [x] 1.2 修改 `public/student/app.js`：新增 `phaseVersion`（每個有效 `phase` 事件加一）；`enterGroup()`、`restoreEntry()`、`confirmEntryAfterClosedEventSource()` 送出前記下版本並傳給 `showEntryResult()`；`synchronizeFromServer()` 只在版本未變時套用 session 摘要的階段與 `activityId`。驗證：`npm test` 全過，以及 2.1 的手動步驟。

## 2. 驗證

- [x] 2.1 手動：
  1. 依上方指令啟動 server，老師頁 `http://127.0.0.1:3000/teacher/` 以 test-password 登入，確認階段為準備中。
  2. 學生頁分別以 `http://localhost:3000/student/`、`http://127.0.0.1:3000/student/`、`http://<區網 IP>:3000/student/` 開啟（不同來源模擬不同學生，各自的 `localStorage` 互不影響）。
  3. 在學生頁 Console 執行：
     `const orig = fetch.bind(window); let release; const gate = new Promise(r => release = r); window.fetch = async (u, o) => { const r = await orig(u, o); if (String(u).startsWith('/api/student/entry?') || u === '/api/session') await gate; return r; };`
  4. 按任一組別；約半秒後在老師頁按「開始搶答」，學生頁應先出現題號格。
  5. 在 Console 執行 `release()`，等 2 秒：學生頁 SHALL 仍停在作答區（50 個題號），不回到「等待活動」。
  6. 老師頁結束搶答後，用 dev 路由或重新啟動 server 回到準備中，換下一個來源重複；每個來源重複多次。
  7. 回歸：作答中重新整理仍恢復作答區；結束搶答後學生頁顯示「活動已結束」；準備中進場停在等待畫面。
  修正前同樣步驟會在 `release()` 後回到等待畫面。
