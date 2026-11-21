# Design

## Context

現有 server 使用 Express、記憶體 session state、REST JSON envelope 與 SSE，摘要已包含 phase、questionCount、groupCount、serverTime。`public/student/` 與 `public/teacher/` 尚無頁面。既有階段控制使用 socket loopback 驗證；本 change 沿用該安全邊界。See proposal.md - Why。

## Goals / Non-Goals

**Goals:**
- 讓組別設定、學生身分恢復和 phase 同步使用同一 server 權威狀態。
- 讓 groupCount 由實際組別清單計算，設定及學生進場 API 遵守既有 JSON envelope。
- 維持輕量原生 HTML/CSS/JavaScript，新增端點與行為在 `docs/api-contract.md` 留有契約。

**Non-Goals:**
- 不做題目匯入、作答、答案送出、結果或正式教師登入/教師控制介面。
- 不新增活動重設 API；若既有/後續重設清除學生進場記錄，恢復端點以失效原因要求學生重新選組。
- 不做持久化；server 重啟會清除記憶體組別及進場對應，瀏覽器端偵測失效後回選組。

## Decisions

- **沿用 Express 靜態檔案提供。** 將 `/student/` 對應 `public/student/`、`/teacher/` 對應 `public/teacher/`；避免另加 web server 或前端框架。臨時教師頁可被載入，但所有寫入仍由 socket remote address 限制為 loopback，不能信任 forwarded header。
- **組別設定使用三個端點。** `GET /api/groups` 回傳 `{data:{groups:[{id,name}]}}`，依 id 排序；`PUT /api/groups` 接受 `{groups:[{id,name}]}` 作完整取代，`id` 須為 1 至 100 的正整數且不重複；`POST /api/groups/generate` 接受 `{count}`，在 1–100 範圍產生並套用「第 N 組」，id 為 1 至 N。設定及產生都只允許準備中 + loopback。完整取代時保留仍存在的 group id 對應，移除組別的學生對應在查詢時回報 `group_removed`。
- **學生進場使用 browser-local 隨機 `studentId`。** `studentId` 為 8 至 64 字元、僅含英數與連字號，不符回 `INVALID_STUDENT_ID`；它只用於恢復同一瀏覽器的狀態，不是認證憑證，因此恢復查詢可使用查詢字串。進場規則：(1) 從未進場過的 `studentId` 可在任一階段選組，供換裝置、清除瀏覽器資料或晚到的學生使用；(2) 已進場的 `studentId` 換組僅限準備中；(3) 選擇不存在的組別回 `GROUP_NOT_FOUND`，學生端收到後重新讀取組別清單。`PUT /api/student/entry` 接受 `{studentId,groupId}`；`GET /api/student/entry?studentId=...` 回傳有效組別或 `{valid:false,reason}`，`reason` 為 `group_removed` 或 `entry_reset`。已知限制：清除本機資料可取得新 `studentId` 重新選組，與無帳號的前提一致，教師端不把 `studentId` 當作身分。
- **程式依功能分模組，種子沿用同一儲存。** 組別與進場邏輯放 `server/groups-entry.js`，`server/index.js` 只負責掛載，避免日後教師端 change 與本 change 在同一檔案衝突。development 種子的 100 組改為載入同一個組別儲存的初始狀態，可被 PUT 取代；production 起始為空，學生端顯示「老師尚未設定組別」。`/` 導向 `/student/`，方便學生直接輸入網址。
- **同組多人在線以不同 studentId 關聯同一 groupId。** server 不把組別鎖給單一瀏覽器；本 change 不需提供在線名單或人數，供教師監看的在線狀態留待後續教師端 change。
- **學生頁面先取 session snapshot，再接 SSE。** 初始畫面呼叫 `GET /api/session` 與組別/進場 API；`GET /api/events` 的 `phase` 更新階段，`heartbeat` 更新最後活動時間。40 秒無任何事件顯示「重新連線中」，EventSource 自動重連後重新讀 session 與 entry。準備中已進場頁只顯示組別、階段及等待提示，不顯示題目。
- **以契約文件先行固定端點與錯誤。** 新端點及成功/錯誤 body 寫進 `docs/api-contract.md`，不修改既有 `api-contract-and-session-lifecycle` requirement；所有 API 錯誤沿用既有 JSON envelope，未知代碼由新增章節列明。

## Risks / Trade-offs

- **[記憶體狀態在重啟後消失]** → entry 查詢回失效原因，學生清除本機舊組別並重新選組；持久化另列後續能力。
- **[無帳號識別碼可被清除或複製]** → `studentId` 只用於恢復同一瀏覽器狀態，不作教師認證或安全憑證；教師寫入仍受 loopback 限制。
- **[臨時教師頁從非 loopback 被開啟]** → UI 顯示 localhost 使用提示，API 以實際 socket 位址拒絕非 loopback 寫入。
- **[完整替換組別導致舊進場失效]** → 保留相同 group id 的關聯，對移除或清除的關聯回傳明確失效原因；手動測試刪組與重進場。

## Migration Plan

新增 API 與靜態頁面，不需資料遷移。先更新 `docs/api-contract.md`，再實作 server 與兩端頁面。回退時移除新端點與頁面即可；舊 session API、SSE 與 lifecycle 行為不變。

## Open Questions

- 首次進場可於「搶答中」「已結束」進行，是本組的決定，與共用契約 D21 的字面（只能在準備中換組）不完全相同，下次 meeting 與 SpecKit 組確認。
