# Proposal: add-student-results

## Why

活動結束後，學生端目前只顯示「活動已結束」，看不到結果。共同契約 D8 要求結束後學生能看到每題搶答成功的組別與答案，以及自己組各題的順位與是否成功。`add-results-computation` 已提供 `computeResults()`，但 server 沒有任何端點把結果提供給學生，學生頁也沒有結果畫面。此外，搶答中讀回的舊作答快照可能覆蓋剛收到的同組送出事件，且首次建立 studentId SSE 連線沒有立即同步；連線被 CLOSED 拒絕後，進場確認若遇到暫時網路錯誤也缺少恢復重試。

## What Changes

- server 新增 `GET /api/student/results?studentId=...`：只在「已結束」提供，沿用有效進場檢查；回應只包含每題的成功組別名稱與答案，以及該學生所屬組別自己的名次與答案。
- 新增 `server/student-results.js`：把 `computeResults()` 的輸出與作答紀錄、組別名稱組成學生端回應，不另外寫判定規則，確保與老師端看到的結果一致。
- 學生頁在「已結束」顯示結果畫面：每題的成功組別與答案、本組名次與是否成功、無人作答的題目；讀取失敗時顯示錯誤並可重試；重新整理後仍能看到結果。
- 搶答期間合併同一組的作答快照與即時事件，避免較舊快照讓題目狀態倒退；studentId SSE 連線首次開啟與重連後都同步伺服器狀態；CLOSED 後進場確認遇到暫時網路錯誤時延遲重試，確定進場失效才回到選組。
- 搶答中與準備中不提供也不顯示任何結果。
- 對應 `docs/explore_summary.md`：D7、D8、第 6 節第 9、10 項；`docs/submission-record.md`：學生結果頁一列。

## Capabilities

### New Capabilities

- `student-results`：結束後學生端取得與顯示每題成功組別、答案與本組名次。

### Modified Capabilities

無。既有 `student-answering-ui` 規定「已結束」時顯示「活動已結束」並停用作答，本 change 在同一畫面增加結果區塊，沒有牴觸既有 Requirement。

## Impact

- **負責人**：學生端成員。
- **程式**：新增 `server/student-results.js` 與測試、`server/student-results-api.test.js`；修改 `server/index.js`（新端點）、`docs/api-contract.md`、`public/student/logic.js`、`logic.test.js`、`index.html`、`app.js`、`server/capacity-check.js`；新增 `docs/verification/add-student-results.md`。本 change 追加的 UI 一致性工作會修改 `public/student/logic.js`、`public/student/logic.test.js` 與 `public/student/app.js`。
- **依賴**：`add-buzz-in-submission`（已歸檔）、`add-results-computation`（已合併）、`add-student-answering-ui`（已合併；本 change 擴充其「已結束」畫面）。
- **不在範圍**：公平順位、作廢與老師改選（O3 已確認兩組都不納入共同契約）、老師端結果畫面、CSV 與匯出、倒數。
