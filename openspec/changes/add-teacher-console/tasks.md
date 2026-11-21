# Tasks: add-teacher-console

測試用密碼一律寫在測試檔內，使用明顯是假的固定字串（例如 `test-password`），不得使用真實密碼。

## 1. 登入模組

- [x] 1.1 新增 `server/teacher-auth.js` 與 `server/teacher-auth.test.js`：`createTeacherAuth({ password, now })` 提供 `isConfigured`、`login`、`isValid`、`logout`；密碼以 SHA-256 摘要加 `timingSafeEqual` 比對；同一來源 60 秒內 10 次失敗後回 `TOO_MANY_ATTEMPTS`（design 第 3、4 節）；驗證：`npm test` 涵蓋正確密碼、錯誤密碼、未設定（含空字串）回 `TEACHER_PASSWORD_NOT_SET`、`password` 非字串回 `INVALID_LOGIN_REQUEST`、第 11 次被拒且正確密碼也被拒、其他來源不受影響、以注入的 `now` 前進 60 秒後恢復、登出後 token 失效、不同 `createTeacherAuth()` 之間 token 不通用

## 2. 登入 API 與權限檢查

本組每個 task 只動 `server/index.js` 與一個測試檔（2.5、2.6 例外，見該項）。

- [x] 2.1 在 `server/index.js` 新增 `teacherPassword`、`now` 選項、cookie 解析、`requireTeacher` 中介層與 `POST /api/teacher/login`、`POST /api/teacher/logout`、`GET /api/teacher/auth`；新增 `server/teacher-auth-api.test.js`；驗證：`npm test` 確認登入成功的 `Set-Cookie` 含 `HttpOnly`、`SameSite=Strict`、`Path=/`，回應內容不含密碼與 token，`/auth` 在未登入、已登入、未設定密碼三種情況的回應正確，登出後 cookie 失效，新建的 app 不接受舊 cookie，429 只影響同一來源
- [x] 2.2 `POST /api/session/start`、`/end` 改用 `requireTeacher`，開始時依序檢查階段、組別、題目（`409 NO_GROUPS`、`409 QUESTIONS_REQUIRED`）；更新 `server/events.test.js`；驗證：`npm test` 涵蓋未登入（來源為 127.0.0.1）回 `401 TEACHER_AUTH_REQUIRED` 且沒有發布階段事件、沒有組別、沒有題目、搶答中再開始仍回 `INVALID_PHASE_TRANSITION`、登入且有組別與題目時開始成功並推送事件、development 的 `/api/dev/phase` 仍可用且仍限 loopback
- [x] 2.3 組別設定 `PUT /api/groups`、`POST /api/groups/generate` 改用 `requireTeacher`，檢查順序為登入 → 階段 → 內容；更新 `server/groups-entry.test.js`；驗證：`npm test` 涵蓋未登入回 `401`（含附上 `X-Forwarded-For: 127.0.0.1`）、未登入且在搶答中仍回 `401` 而非 `409`、已登入時原有的階段與內容驗證不變、綁在非 loopback 網卡時已登入可以設定（無可用網卡時略過），學生端點不需登入
- [x] 2.4 匯入的三個寫入端點與 `GET /api/teacher/guided-notes` 改用 `requireTeacher`，上傳端點的登入檢查放在讀取檔案內容之前；更新 `server/guided-notes-api.test.js`；驗證：`npm test` 涵蓋四個端點未登入回 `401`、已登入在搶答中回 `409 IMPORT_NOT_ALLOWED`、綁在非 loopback 網卡時已登入可以匯入（無可用網卡時略過），原有的匯入測試改為登入後全部通過
- [x] 2.5 在 `server/index.js` 直接執行時載入專案根目錄的 `.env`（存在才載入），並在 `.env.example` 加上 `TEACHER_PASSWORD` 的用途說明；驗證：`npm test` 不受本機 `.env` 影響；手動在 `.env` 設定測試用密碼後 `npm start`，執行下列指令，第一個回應 `authenticated` 為 `true`，第二個顯示 `準備中`

  ```powershell
  Invoke-RestMethod -Method Post http://localhost:3000/api/teacher/login -ContentType 'application/json' -Body '{"password":"<.env 內的密碼>"}' -SessionVariable teacher
  Invoke-RestMethod http://localhost:3000/api/session -WebSession $teacher
  ```
- [x] 2.6 更新 `docs/api-contract.md`（design 第 9 節）：新增「老師登入」一節，改寫「階段控制」「組別設定」「Guided Notes 匯入」的權限說明與 PowerShell 範例，補上新錯誤代碼；驗證：依文件的 PowerShell 範例操作，未登入呼叫 `/api/session/start` 得到 `401 TEACHER_AUTH_REQUIRED`，登入後沒有組別得到 `409 NO_GROUPS`，回應與文件一致

## 3. 教師控制台頁面

- [ ] 3.1 新增 `public/teacher/console-logic.js` 與 `public/teacher/console-logic.test.js`：畫面狀態（`checking`、`notConfigured`、`login`、`console`）、控制台事件（摘要更新、開始、結束確認與取消、結束時已是「已結束」視為成功、任何 `401` 回到登入並帶訊息、登出）、各按鈕可用條件（design 第 8 節）；驗證：`npm test` 涵蓋每個狀態轉換與按鈕條件，以及兩次結束只顯示「已結束」不顯示錯誤
- [ ] 3.2 修改 `public/teacher/import-logic.js` 與 `public/teacher/import-logic.test.js`：移除 `isAllowedHost`，只依階段決定能否匯入；驗證：`npm test` 確認準備中可用、搶答中與已結束停用並說明原因，原有的狀態轉換與過期回應測試仍通過
- [ ] 3.3 修改 `public/teacher/index.html`：標題改為「教師控制台」，新增登入區、未設定密碼說明區、活動摘要（階段、組數、題數）、開始與結束按鈕、結束確認列、登出按鈕，移除「請以 localhost 開啟」提示與警告，組別設定與匯入區塊保留；驗證：`npm start` 後開啟 `http://localhost:3000/teacher/`，HTML 中各區塊存在且只有「讀取中…」可見
- [ ] 3.4 修改 `public/teacher/app.js`：串接 3.1、3.2 的邏輯與登入、摘要、開始、結束、登出 API，開啟 `/api/events` 同步階段，組別區塊依階段停用；驗證：`npm test` 通過，並依下列瀏覽器步驟操作（`.env` 設定測試用密碼）：
  1. 開啟 `http://localhost:3000/teacher/`，只看到登入表單；輸入錯誤密碼，顯示密碼錯誤且欄位清空
  2. 輸入正確密碼，顯示控制台：準備中、0 組、0 題；重新整理後仍在控制台
  3. 直接按「開始搶答」，顯示需要先設定組別；產生並套用 5 組後再按，顯示需要先匯入學習單
  4. 匯入 `fixtures/guided-notes/01-official-single.xlsx` 並確認，摘要顯示 5 組、6 題
  5. 以 `http://127.0.0.1:3000/student/` 與 `http://<區網IP>:3000/student/` 開兩個學生頁，分別進入第 1、2 組
  6. 以 `http://<區網IP>:3000/teacher/` 開第二個教師分頁（需重新登入，因為 cookie 依網址來源分開），確認同樣顯示 5 組、6 題
  7. 在 localhost 分頁按「開始搶答」，兩個學生頁與區網教師分頁在 2 秒內顯示「搶答中」，組別設定與匯入停用
  8. 在兩個教師分頁都按「結束搶答」並都按確認，兩個分頁都顯示「已結束」且沒有錯誤訊息，學生頁顯示「已結束」
  9. 停止 server 再 `npm start`，在教師分頁按「登出」以外的任一操作，回到登入畫面並說明登入已失效
  10. 不設定 `TEACHER_PASSWORD`（暫時移走 `.env`）重新啟動，教師頁顯示需要先設定密碼，沒有登入表單
- [ ] 3.5 更新 `README.md`（老師密碼設定、登入方式、PowerShell 登入範例、區網裝置也可操作、目前進度）與 `openspec/config.yaml` 的 `context` 中「教師端須以 localhost 開啟」一句，改為老師端點需登入；驗證：依 README 從複製 `.env.example` 開始，可完成一次登入並開始搶答；`openspec validate add-teacher-console --strict` 通過

## 4. 整合驗證

- [ ] 4.1 執行 `npm test` 與 `npm run check:capacity`，全部通過；確認 `git grep -n LOOPBACK_ONLY -- server public` 只剩開發路由與其測試
- [ ] 4.2 人工驗證並記錄於 `docs/verification/add-teacher-console.md`：老師用 localhost 與區網位址（或手機）各登入一次，加上兩個不同來源的學生頁，完成「登入 → 設定組別 → 匯入 → 開始 → 結束」；另驗證連續 10 次錯誤密碼後第 11 次（即使正確）顯示稍後再試、60 秒後可登入；記錄驗證環境、步驟與結果

## Workflow follow-up

- 開工前在群組告知學生端成員：老師端點改為登入檢查（`401 TEACHER_AUTH_REQUIRED`），之後新增的老師端點請使用 `requireTeacher`；開始搶答多了組別與題目檢查。
- `add-guided-notes-import` 須先合併並歸檔，本 change 的 `guided-notes-import` delta 才能歸檔。
- 執行 `/openspec-verify-change add-teacher-console`，通過後 sync 與 archive。
- 開 PR 時列出改動到的學生端成員檔案（`server/events.test.js`、`server/groups-entry.test.js`、`server/index.js` 的權限檢查），請其 review。
