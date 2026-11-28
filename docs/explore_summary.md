# 課堂搶答系統｜OpenSpec Explore 結論

版本 v0.4｜2026-11-22｜OpenSpec 組｜用途：交給 codex 執行 `openspec propose` 與 `apply` 的唯一輸入

> v0.2 變更：對齊共同契約 v0.6（D12 改為直接讀寫線上 Google Sheets、D13 增為 8 欄、D14／D16 補充、新增 D25）；補上各項決策的狀態（Confirmed／Default）與 SpecKit 組 2026-11-20 對照表帶來的待回覆事項；更新第 5、8、9、10、11 節。
>
> v0.3 變更：老師密碼登入（D18、O5）與教師控制台由 `add-teacher-console` 實作（PR 待合併），更新 D18、O5、能力表與 change 順序；`add-buzz-in-submission` 的開始搶答須先登入且至少一組一題。
>
> v0.4 變更：`add-buzz-in-submission` 已合併並歸檔；`teacher-console` 已歸檔；新增 `question-results`（`add-results-computation`，教師端成員，已合併）與 `student-answering-ui`（規劃文件已備），並把學生結果頁獨立為 `student-results`；更新第 5、11 節。

## 0. 給 codex 的工作規則

- 本文件是 Explore 階段結論。行為基準是兩組共用的 Feature Contract v0.6（D1–D25，另含 E3、E4；以 SpecKit 組 repo 的 `docs/shared/FEATURE-CONTRACT.md` 為準），第 3 節為其摘要，第 4 節為本組覆寫與補充，兩者衝突時以第 4 節為準。
- 只對齊「使用者看得到的行為」，不得參考或複製另一組的程式碼。
- 技術選型由 design.md 決定，但必須遵守第 8 節限制。
- 額度有限：每個 change 小而獨立；每個 task 一次只動 1–2 個檔案；不要整個 repo 重新掃描；文件只做局部修改，不整份重生；一般 UI 與 CRUD 用輕量模型，狀態機與排序邏輯再升級。
- 工作順序：API 契約 → server 骨架 → 學生端（先用 mock 資料）→ 其餘。第 11 節有建議的 change 拆分。

## 1. 背景

老師用填空式學習單（Guided Notes）做課堂搶答，原本要收回講義、學生上台寫黑板，太耗時。系統要讓整個活動線上進行：老師匯入題目並開啟搶答，各組用自己的裝置**每題各自搶答**，最快送出的組別就是該題的成功答案，結束後老師把成功答案匯出寫回原 Guided Notes。

**系統不判斷答案對錯。** 對錯由老師在課堂上秀出答案、讓同學提出 Challenge，這是設計前提。

## 2. 範圍與分工

| 區塊 | 內容 | 負責 |
| --- | --- | --- |
| 學生端 | `public/student/`：選組別、選題號、作答、送出、結果頁、斷線重連 | 學生端成員 |
| server 核心 | 活動階段狀態機、送出接收與排序、階段同步、公平順位、倒數、作廢與最終勝者的資料模型 | 學生端成員 |
| 教師端 | `public/teacher/`：活動控制、監看、改選勝者、結果頁、組別設定畫面 | 教師端成員 |
| 資料進出 | Guided Notes 匯入、匯出 xlsx（動態定位填空格）、csv 匯出 | 教師端成員 |

專案目錄：`public/student/`、`public/teacher/`、`server/`、`docs/`（API 契約放 `docs/api-contract.md`）。分支：`main`、`feat/student-quiz`。

## 3. 行為基準摘要（來自 Feature Contract v0.6）

狀態：**Confirmed** = 兩組已同意；**Default** = SpecKit 組的預設，本組先照做，待兩組回覆後收成 Confirmed。

| 編號 | 行為 | 狀態 |
| --- | --- | --- |
| D1 | 整場開放：老師開啟後所有題目同時可作答，每題各自比誰最快；結束後才公布結果 | Default |
| D2 | 階段：`準備中` → `搶答中` → `已結束`，只能往前，由老師操作；倒數結束視同老師結束 | Default |
| D3 | 學生選組別進場，不需帳號密碼；同組可多人同時在線 | Default |
| D4 | 同組任一人都能送出；某題送出後全組該題鎖定並同步顯示「已送出」 | Default |
| D5 | 已送出的答案不能修改（只有老師作廢後該組能重送，見 D24） | Default |
| D6 | 每組每題一筆有效作答；依 server 收到順序排順位；第 1 順位為搶答成功 | Default |
| D7 | 搶答中學生只看到自己組的答案與送出狀態；看不到他組是否已送出，也看不到某題是否已被搶走 | Default |
| D8 | 結束後學生看到每題的搶答成功組別與其答案，以及自己組各題的順位 | Default |
| D9 | 搶答中老師即時看到每題各組的送出狀態、答案與順位 | Default |
| D10 | 題組算一題：所有空格都填才能送出，整題一起比順位 | Default |
| D11 | 匯入：貼 Google 試算表連結（知道連結者可檢視）或上傳 xlsx；依表頭與合併範圍動態辨識題目與空格；匯入後顯示題數讓老師確認；不可寫死儲存格位置 | Default |
| D12 | **匯出寫回（v0.6 改版，依助教 2026-11-17 說明）**：老師的學習單存在自己的雲端 Google Sheets，系統須**直接對那份線上試算表讀寫**；讀取連線取得最新內容，寫回時把成功答案直接寫入對應填空格，不以「下載 xlsx 再手動覆蓋」為主要流程。答案一律寫成純文字，不得被試算表當成公式；題組保留「（1）」等前綴（前綴與答案分離時，答案寫右側獨立格；前綴位於合併填答區時維持「前綴＋答案」）；無人作答的題目保持空白。寫入需編輯權限，以**服務帳號共用**方式認證。匯入來源是上傳的 xlsx 時沒有雲端目標，維持下載產生的 xlsx | Confirmed |
| D13 | csv 欄位：題號, 空格序, 組別, 答案, 順位, 是否搶答成功, 送出時間, **公平順位**（第 8 欄，值為 `是`／`否`／`是（改判）`）；UTF-8 含 BOM；**送出時間以本地時間呈現，不輸出 UTC `Z` 或時區後綴**（v0.4） | Confirmed |
| D14 | 公平順位：老師在準備階段選擇啟用，預設不啟用。啟用時，某題第一個答案送達後 3 秒內送達的組別視為同一批；同批中「已判定題目的成功題數最少」者優先，相同再比送達順序；題目依第一個答案送達的先後判定，判定後如無作廢則不再改變；結果與匯出標示是否啟用 | Confirmed |
| D15 | 倒數：開啟時可選擇是否設定時間（10 秒至 60 分鐘）；時間到自動結束；剩餘時間以 server 為準 | Default |
| D16 | 投影看板：搶答中只顯示階段、倒數、各組是否在線，**不顯示任何作答資訊（含送出數量）**；結束後可逐題或全部揭曉，逐題揭曉依題號順序 | Confirmed |
| D17 | 老師在準備階段設定組數與組名 | Default |
| D18 | 老師端需輸入密碼，密碼由環境變數 `TEACHER_PASSWORD` 設定；登入狀態存 HttpOnly cookie；同一來源 60 秒內錯 10 次暫時鎖定（429）。本組已於 `add-teacher-console` 實作（見 O5） | Default（本組已實作；SpecKit 詢問的回覆見第 10 節 Q1） |
| D19 | 已結束後可重設活動回到準備中（需再確認）；組別保留，作答資料清空。2026-11-25 與 SpecKit 談定（契約 v0.10）：重設時學生進場一併失效，已連線學生也回選組頁並顯示「活動已重設，請重新選擇組別」；組別保留，老師不用重新登入 | Default（細節兩組同意，v0.10） |
| D20 | 組名 1–30 字元且不重複；倒數 10–3600 秒；組數上限 100（兩組已統一，見 O1） | Default（組數上限改為 100） |
| D21 | 學生只能在準備中換組；重新整理或斷線重連後回到原組別與目前階段 | Default |
| D22 | 題目敘述若匯入檔有則讀取並顯示於題號旁，沒有也不影響 | Default |
| D23 | 答案去除前後空白後 1–200 字元；不判斷對錯 | Default |
| D24 | 搶答中老師可作廢某組某題的作答，該組可重送；重送順位排該題現有號碼之後；被作廢的作答保留紀錄但不計入成功、進度與結果；只能在搶答中作廢；作廢事件只送老師與該組 | Confirmed |
| D25 | 公平順位下的作廢重判：啟用公平順位時，老師作廢某題的成功組後，該題以剩餘有效作答重新判定，且後面已判定的題目也依新的成功題數一併重新判定；不啟用時維持先到先得，只有被作廢的組別可重送 | Confirmed |
| E3、E4 | 公平順位機制；倒數計時與投影看板 | Confirmed |

## 4. 本組覆寫與補充

- **O1 組數上限**：覆寫 D20 的 50 組。老師設定組數 N，上限 100（真實課堂曾有 64 組，50 組不夠用）。SpecKit 組已於 2026-11-20 詢問是否統一；本組主張統一為 100，2026-11-22 已回覆並附實測數字（100 組 × 50 題 5,000 筆提交約 0.6～1.1 秒、100 條 SSE 最大延遲 10 毫秒內）；SpecKit 已同意，兩組統一為 100。
- **O2 組別命名**：老師輸入 N 後可一鍵產生「第 1 組～第 N 組」對應 eeclass 編號，仍可改名。
- **O3（E5）結束後改選勝者（已決定不做）**：`已結束` 階段，老師可對每題在所有送出中改選最終勝者（預設為第 1 順位），標記「老師改選」。匯出 xlsx 以最終勝者答案為準，csv 同時保留原始順位與最終勝者；學生結果頁顯示最終勝者。原因：系統不判斷對錯，快但答錯的答案不該被直接寫回。與 SpecKit 討論後，兩組都不做，不納入共同契約；`computeResults()` 保留 `overrides` 參數，傳入時回 `OVERRIDE_NOT_SUPPORTED`。以下為原始構想與注意事項，保留供參考。注意：D25 的連鎖重判只發生在作廢；改選勝者不得觸發公平順位重算，兩者須在資料模型分開（「有效作答」「原始順位」「最終勝者」三層）。
- **O5 老師身分（D18）**：已由 `add-teacher-console` 實作（PR 待合併）：`TEACHER_PASSWORD` 來自 `.env`；`POST /api/teacher/login`、`logout`、`GET /api/teacher/auth`；老師端點（組別設定、匯入、開始、結束）一律用 `requireTeacher`，未登入回 `401 TEACHER_AUTH_REQUIRED`；`loopbackOnly` 只剩開發路由使用。老師可用手機或區網位址登入操作，遠端講課不再被擋。已知限制：區網以 HTTP 傳輸，密碼與 cookie 未加密，只適合課堂內網；登入狀態存在 server 記憶體，重啟後失效。新增老師端點請沿用 `requireTeacher`。
- **O6 Google Sheets 寫回（D12）**：`export-guided-notes` 須支援「連結匯入 → 寫回線上試算表」。匯入時 server 私下保存試算表 ID 與工作表，供寫回使用；寫回前須重新讀取並以同一套表頭／題號規則重新定位，不可只信匯入時記下的儲存格位置（老師可能在匯入後插列），題號對不上時拒絕寫入並說明原因。服務帳號金鑰只放 `.env` 或 repo 外的檔案路徑，不進 repo。
- **O7 開始搶答的前置條件**：開始前須至少一組、至少一題，否則 `409 NO_GROUPS`、`409 QUESTIONS_REQUIRED`，檢查順序為階段 → 組別 → 題目（與 SpecKit 的代碼一致，已寫入 `docs/api-contract.md`）。因此之後所有需要「搶答中」的測試與手動驗證，都要先登入、至少有一組一題（development 種子兩者皆有；也可用開發路由 `/api/dev/phase/搶答中` 略過登入與前置條件，僅限開發測試）。
- **O4 學生端補充**：進場後組別記在瀏覽器本地；搶答中題號格顯示每題「未作答／草稿／已送出」；草稿只存本機，重新整理不消失，老師重設活動後清除。
- **O8 介面語言切換（對齊 SpecKit 007）**：SpecKit 組已完成繁體中文／English 切換（他們 repo 的 `specs/007-i18n/spec.md`），本組補做以維持功能一致。行為：三個畫面右上角「中文／EN」、預設依瀏覽器語言（`en*` 英文，其餘繁中）、選擇記在 localStorage 且其他分頁跟著改、`<html lang>` 跟著改、伺服器錯誤依代碼在前端翻譯、組名／題目／答案不翻譯。server 回應、API 與共用契約 D1～D25 都不變。學生端由 `add-student-language-switch` 實作；教師控制台與投影看板由 `add-teacher-language-switch` 實作（切換時原地重畫，保留匯入預覽、組別編輯與看板揭曉進度；匯入摘要新增 `warningDetails` 讓英文版的提醒也是英文，`warnings` 原文不變）。

## 5. 能力拆分與優先級

能力名稱為建議值，實際以 OpenSpec 產生的資料夾名稱為準。負責欄中「學生端成員」指負責 `public/student/` 與 server 核心者，「教師端成員」指負責 `public/teacher/` 與資料進出者。

| 能力（spec） | 內容 | 優先級 | 負責 | 進度（2026-11-21） |
| --- | --- | --- | --- | --- |
| api-contract-and-session-lifecycle | API 契約、階段狀態機、全員同步（2 秒內）、統一錯誤格式（已完成並歸檔） | P0 | 學生端成員 | 已歸檔 |
| groups-and-entry | 組別設定、學生進場、換組、重連、靜態檔案提供 | P0 | 學生端成員（API 與學生端）；教師端成員（組別設定畫面） | 已歸檔（PR #2 合併進 feat/student-quiz） |
| guided-notes-import | 匯入、摘要確認、動態辨識 | P0 | 教師端成員 | 已歸檔 |
| buzz-in-submission | 送出、鎖定、server 排序、競態處理、題目資料結構 | P0 | 學生端成員 | 已歸檔（`add-buzz-in-submission`，PR #8 已合併） |
| student-answering-ui | 搶答中作答畫面：題號格、作答、草稿、送出、鎖定、同組同步、重連（第 6 節第 4、5、6、7、8、10 項） | P0 | 學生端成員 | 規劃文件已備（`add-student-answering-ui`），待 apply |
| student-results | 結束後結果頁：各題搶答成功組別與答案、自己組各題順位（第 6 節第 9 項） | P0 | 學生端成員 | 未開始（依賴 question-results） |
| question-results | `computeResults()` 純函式：由作答紀錄推導每題判定結果（先到先得、過濾作廢；公平順位與老師改選之後各自加入），供結果頁、監看、匯出共用 | P0 | 教師端成員 | 實作完成，已合併，待歸檔（`add-results-computation`） |
| teacher-monitoring-results | 監看、結果（老師登入已由 teacher-auth／teacher-console 完成，不再屬於此能力） | P0 | 教師端成員（資料來源為 server） | 未開始 |
| export-guided-notes | 寫回 xlsx | P0 | 教師端成員 | 未開始（須依 D12 v0.6 改為 Google Sheets 寫回，見 O6） |
| countdown | 倒數與自動結束（含 D19 重設活動） | P1 | 學生端成員（server 計時、學生端顯示）；教師端成員（老師設定）。學生端成員無法開發，server 與控制台由教師端成員以 `add-countdown-and-reset` 接手；學生頁顯示由 `add-student-countdown-and-reset` 處理 | 實作中（`add-countdown-and-reset`） |
| csv-export | 匯出活動結果 | P1 | 教師端成員 | 未開始（8 欄、本地時間） |
| void-submission | D24 作廢 | P1 | 教師端成員（server 與操作畫面，學生端成員無法開發時接手）；學生端頁面提示由 `add-student-void-notice` 處理 | 實作中（`add-submission-void`） |
| challenge-override | O3 結束後改選 | P1 | 學生端成員（最終勝者資料模型）；教師端成員（操作畫面與匯出） | 不做（兩組決定） |
| question-groups | 題組匯入與整題送出（D10） | P2 | 教師端成員（匯入）；學生端成員（送出與學生端） | 匯入端已含在 guided-notes-import；送出端未開始 |
| fair-ranking | D14 公平順位 | P2 | 學生端成員（由教師端成員接手） | 實作中（`add-fair-ranking`，含 D25 連鎖重判；學生頁提示另由 `add-student-fair-ranking-notice` 處理） |
| projection-board | D16 投影看板 | P2 | 教師端成員 | 實作中（`add-projector-board`：`/teacher/board.html`、`GET /api/teacher/presence`） |
| teacher-auth | D18 老師密碼驗證，取代各寫入端點的 loopback 檢查（O5） | P0 | 教師端成員 | 已歸檔（`add-teacher-console`） |
| teacher-console | 教師控制台：登入畫面、活動狀態即時同步、開始與結束搶答（結束需確認）、組別與匯入依階段鎖定 | P0 | 教師端成員 | 已歸檔（`add-teacher-console`） |

## 6. 學生端需求（核心）

每項以 SHALL 描述，附代表性場景，請轉成 spec 的 Requirement 與 Scenario。

1. **進場選組**：學生端 SHALL 顯示 1～N 組清單，點選後進場。場景：準備中選第 3 組，畫面顯示「第 3 組」與「準備中」，老師端看到該組在線。
2. **換組限制**：學生 SHALL 只能在準備中換組，且由 server 檢查階段，不可只靠前端隱藏按鈕。
3. **等待畫面**：準備中 SHALL 顯示組別與等待提示，不顯示題目內容。
4. **搶答中作答**：搶答中 SHALL 顯示題號格與各題狀態；點題號進入該題，顯示題目敘述（若有）與一個或多個空格輸入框；題數與老師匯入一致。
5. **送出與鎖定**：送出 SHALL 去除前後空白後驗證 1–200 字元；成功後該題鎖定並顯示「已送出」，同組其他裝置同步鎖定。場景：空白答案被拒絕並說明原因；已送出的題不能再改。
6. **隱私**：搶答中 SHALL NOT 顯示他組任何資訊，包含是否已送出、是否已被搶走。
7. **階段同步**：老師開啟或結束時，已進場學生畫面 SHALL 在 2 秒內更新；倒數顯示以 server 剩餘時間為準。
8. **重連**：重新整理或斷線重連 SHALL 回到原組別、目前階段與自己組已送出的答案；斷線時顯示「重新連線中…」。
9. **結果頁**：已結束 SHALL 顯示每題搶答成功（最終勝者）的組別與答案，以及自己組各題的順位與是否成功。
10. **錯誤處理**：伺服器 10 秒內無回應 SHALL 顯示「伺服器沒有回應」；被刪除的組別重連時 SHALL 回到選組畫面並說明原因。

## 7. Server 核心要求

- 單一權威狀態；所有寫入端點 SHALL 由 server 檢查階段與權限。
- 順位以 server 收到順序為準，同題同時到達的請求 SHALL 原子處理，不得產生重複順位；各題順位獨立，號碼不重用。
- 每組每題僅一筆有效作答，重複送出 SHALL 被拒絕。
- 所有 API 回應 SHALL 為 JSON，錯誤含統一的 code 與訊息，包含不存在的路徑；內部錯誤也要回應。
- 階段變化 SHALL 在 2 秒內推送給所有已連線端；倒數剩餘時間由 server 計算。
- 支援 100 組同時在線、至少 50 題，操作無明顯延遲。
- **隱私與推送**：搶答中任何公開推送（含 SSE、輪詢回應、`GET /api/session`）SHALL NOT 帶有可推出他組作答的資訊，包含送出數量、版本號中夾帶的作答次數、題目是否已被搶走。作答變更只能送給老師與該組的連線（D7、D24）。
- **每題競態**：同題同時到達的請求以單一序列化點處理（Node 單執行緒下同步更新記憶體狀態即可，不可在檢查與寫入之間插入 `await`）。
- 最小介面（細節放 `docs/api-contract.md`）：取得階段與題數與組數、選組進場／換組、送出（組別、題號、答案）、取得自己組狀態、取得結果；教師端另有登入、組別設定、匯入、開啟／結束／重設、監看、作廢、改選、匯出。

## 8. 技術與限制

- 本機運作，不需對外部署；但 server 為了匯入與寫回 Google Sheets 須能對外連線 Google（D12）。server SHALL 能被同網段手機連線（demo 至少兩組學生畫面，可用多個瀏覽器視窗）。
- 建議（design 可推翻）：Node.js + Express，REST 加 SSE 或 WebSocket 推送；狀態先放記憶體，重啟後保留列為 P2；前端先以 `public/` 內的輕量實作，不引入重型框架以節省額度。
- 學生端先用固定 JSON 的 mock 開發，不等真實 server。
- 密碼與金鑰（含 Google 服務帳號金鑰）只放 `.env` 或 repo 外的檔案路徑，repo 只放 `.env.example`（不含真實值），並加入 `.gitignore`；文件、程式、log 不得出現機敏資料。
- 匯入匯出 SHALL NOT 寫死儲存格位置，助教會用另一份 Guided Notes 測試。

## 9. 驗收

共同驗收情境（兩組一致）：

- AC-000-01 匯入官方單題範本顯示 6 題；AC-000-02 匯入官方題組範本顯示 4 題（2 題為題組，各 2 空格）；AC-000-03 欄位位置不同的學習單仍正確。
- AC-000-04 老師開啟，學生 2 秒內可作答；AC-000-05 A 組先送、B 組後送，老師端 A 為第 1、B 為第 2，且 A、B 互看不到。
- AC-000-06 搶答中重新整理，回到同一階段且已送出答案仍在；AC-000-07 老師結束後 2 秒內顯示結果，之後不能再送出。
- AC-000-08 匯出（線上試算表來源寫回原表；xlsx 上傳來源下載匯出檔）後每題填空格為成功答案，無人作答保持空白；AC-000-09 csv（8 欄）與老師端順位一致。

本組補充：

- AC-S-05 寫回前老師在線上試算表插入一列，寫回仍對到正確題目；題號被改動時拒絕寫入並說明原因。AC-S-06 啟用公平順位後作廢第 N 題成功組，第 N 題與其後已判定題目依 D25 重新判定。AC-S-07 搶答中任一公開推送內容不含他組送出數量。AC-S-08 100 組 × 50 題同時送出，無重複順位且 server 回應時間在可接受範圍（數字於 design 訂定）。
- AC-S-01 搶答中學生嘗試呼叫換組，server 拒絕；AC-S-02 同組兩台裝置同時送出同一題，只有一筆有效；AC-S-03 組數設為 100 可正常進場與排序；AC-S-04 老師改選勝者後，結果頁、xlsx、csv 一致。
- 除自動測試外須人工驗證：老師加至少兩個學生視窗跑完整流程，記錄於 `docs/verification/`。

## 10. 待確認

已解決：Q4 官方 Guided Notes 範本結構（已放入 `fixtures/guided-notes/`，`expected.json` 記錄預期結果）。

已解決：Q5 助教 2026-11-17 公告原文已取得：系統須「直接串接自己雲端線上的 Google Sheets 進行讀寫，而非下載成 .xlsx 檔在本地端離線處理」。本組的理解：公告排除的是使用者手動下載 xlsx 再手動上傳的流程。本組以連結匯入時由 server 即時讀取線上試算表（經公開連結取得內容後解析），寫回前同樣重新讀取最新內容，寫回以 Sheets API 直接寫入線上試算表，老師全程不需下載或上傳任何檔案，符合公告；上傳 xlsx 與下載 xlsx 僅為備援。公告未提及服務帳號，本組維持以服務帳號寫回（O6）。Demo 時以「匯入後修改線上試算表再寫回」示範讀到的是線上最新內容（AC-S-05）。

待與 SpecKit 組、助教確認：

- Q1 D18 老師密碼：本組已實作密碼登入（O5），2026-11-22 已回覆 SpecKit 已對齊（`WRONG_PASSWORD`、`TOO_MANY_ATTEMPTS`、`TEACHER_PASSWORD_NOT_SET`、`NO_GROUPS`、`QUESTIONS_REQUIRED` 一致）。待 SpecKit 確認未登入時的代碼：本組為 `401 TEACHER_AUTH_REQUIRED`。
- Q2 D20 組數上限：已解決，SpecKit 同意兩組統一為 100（見 O1）。
- Q3 O3 結束後改選勝者：已解決，兩組都不做，不納入共同契約（見 O3）。
- Q4 SpecKit 對照表列出的其餘 Default 決策（D1～D11、D15、D17、D19、D21～D23）：逐條核對後回覆「照你們的」或指出差異（尚未逐條核對，見回覆草稿）。
- Q6 Google 服務帳號由誰建立、測試用試算表由誰提供、金鑰如何在組員間傳遞（不得進 repo）。

## 11. 建議的 OpenSpec change 順序

狀態：✅ 已歸檔／🔶 進行中／⬜ 未開始。

1. ✅ `add-api-contract-and-server-skeleton`
2. ✅ `add-groups-and-student-entry`
3. ✅ `add-guided-notes-import`（task 5.3 延後，待 `add-export-guided-notes` 一併處理）
4. ✅ `add-buzz-in-submission`（已合併並歸檔；後續小修：`submissions.clear()` 不清訂閱者、`createApplication` 的 `now` 轉為 Date 傳給 `createSubmissions`）：**只做 server**——題目讀取（供學生端）、送出、鎖定、server 排序、競態處理、每組私有推送；不含畫面。
5. ✅ `add-student-answering-ui`：學生端題號格、作答、草稿、送出、鎖定同步（依 4 的 API；規劃文件已備，待 apply；只動 `public/student/`，不含結果頁）。
5a. ✅ `add-results-computation`：`server/results.js` 的 `computeResults()` 第一版（教師端成員，已合併，待歸檔）。
6. 🔶 `add-student-results`：結束後結果頁（依賴 5a 的 `computeResults()` 與 server 端點公開結果）。
7. ✅ `add-teacher-console`（含老師登入 D18 與開始／結束搶答；教師端成員實作，已歸檔，取代原本規劃的 `add-teacher-auth`）。
8. 教師端與資料進出：`add-teacher-monitoring`（監看與結果，登入已不屬於它）、`add-export-guided-notes`（含 Google Sheets 寫回，O6）。
9. P1：countdown、csv-export（8 欄）、void-submission、challenge-override。
10. P2：question-groups（送出端）、fair-ranking（含 D25）、projection-board。

每個 change 的 proposal 需寫明 Why、What Changes、Impact，tasks 需小到可獨立驗證。

註：D20 組數上限本組主張 100（真實課堂曾有 64 組），尚未與 SpecKit 組統一；各 change 的測試與文件請不要寫「已統一為 50」。
