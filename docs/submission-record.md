# 作答紀錄與判定結果（資料格式約定）

版本 v0.4｜2026-11-23｜教師端成員整理；O3 不納入共同契約，移除老師改選，並依 SpecKit 004 補上 CSV 格式細節

本文件約定 server 內部保存的作答紀錄，以及由作答紀錄推導出的每題判定結果。

- **作答紀錄**的欄位以學生端成員 `add-buzz-in-submission` 的 design（第 4 節「提交資料模型與預留擴充」）為準，本文件只補上之後作廢會新增的欄位。
- **判定結果**、公平順位與 CSV 對應由教師端成員提出；學生結果頁、老師監看與結果、匯出與寫回都讀這份格式。

實作時若需要調整，請直接修改本文件並告知另一位成員。規則與 SpecKit 組的子功能 003（作答）、004（匯出）、005（公平順位）一致，只比對可觀察行為。

## 1. 作答紀錄

一組對一題的一次送出，由 `server/submissions.js` 保存在記憶體，與題目、組別一樣在 server 重啟或重設活動時清空。教師端以 `listSubmissions()` 讀取（依題目與 `rank` 排序）。

```js
{
  questionId: 3,                       // = session.questions[].id，學習單上的題號
  groupId: 2,                          // = groups[].id
  answers: ['細胞膜', '粒線體'],        // trim 後的答案；第 i 個對應該題 blanks[i]
  submittedAt: '2026-11-21T08:00:00.000Z',  // server 收到的時間（ISO 8601 UTC）
  rank: 4,                             // 該題的原始接收順位，從 1 起，不重用
  status: 'valid',                     // 'valid'｜'voided'（作廢由 add-submission-void 加入）
  voidedAt: null,                      // 作廢時間；由 add-submission-void 加入，'valid' 時為 null
}
```

- `add-buzz-in-submission` 只寫入 `status: 'valid'`。`voidedAt` 已由學生端成員同意採用，只在作廢時寫入，由 `add-submission-void` 加入（作廢端點見 `docs/api-contract.md`「作答作廢」），不影響 buzz-in。
- 一題內 `rank` 不重複，所以「`questionId` + `rank`」可唯一指定一筆作答，不另設 `id`。

規則：

| 規則 | 依據 |
| --- | --- |
| 每題每組同一時間最多一筆 `status: 'valid'` 的作答；重複送出回 `409 ALREADY_SUBMITTED`，原紀錄不變 | D4、D5、D6 |
| `answers` 長度必須等於該題空格數，每格都要有答案才能送出 | D10 |
| 每格答案去除前後空白後 1–200 字元；不判斷對錯 | D23 |
| `rank` 由每題計數器依序給出，給出後不改變；作廢不遞補、號碼不重用 | D6、D24 |
| 先後順序一律以 `rank` 判斷；`submittedAt` 只用於顯示、CSV 與公平順位的 3 秒批次判定 | D6、D14 |
| 「查重 → 驗證 → 寫入 → 遞增順位」在同一個同步區塊完成，不得產生重複的 `rank` | explore_summary 第 7 節 |
| 作廢只把 `status` 改為 `'voided'` 並記錄 `voidedAt`，不刪除紀錄；只能在「搶答中」作廢 | D24 |
| 作廢後同組可重送，重送是新的一筆，`rank` 排在該題目前最大值之後；其他組的 `rank` 不變 | D24 |
| 已作廢的作答不計入搶答成功、進度、結果、CSV 與寫回 | D24 |
| 學生端在搶答中只能取得自己組的作答，回應不含 `rank`；不得從任何回應得知他組是否已送出 | D7 |

## 2. 判定結果

每題一筆，**不儲存**，每次由作答紀錄即時推導。學生結果頁、老師監看與結果、CSV、xlsx 匯出與 Google 試算表寫回都使用同一個推導函式，確保結果一致。

```js
computeResults({ questions, submissions, fairRankingEnabled, now })
// submissions 為 listSubmissions() 的結果；now 為判定時刻（毫秒），用來判斷公平順位的 3 秒批次是否已結束；省略時視為 Infinity（所有批次都已結束）
// 依題號順序回傳每題的判定結果
```

放在 `server/results.js`，為純函式，不碰 HTTP 與 `session`，所有輸入都由呼叫端傳入。由獨立的小 change `add-results-computation` 實作（教師端成員負責），第一版只支援先到先得與過濾作廢；公平順位已由 `add-fair-ranking`（教師端成員接手）實作，原本的 `FAIR_RANKING_NOT_SUPPORTED` 錯誤已移除。server 以 `judgeResults()` 統一呼叫：搶答中傳入目前時間，活動已結束時傳入 `Infinity`，讓未過 3 秒的題目在結束時立即判定。老師改選（O3）不納入共同契約、兩組都不實作；程式仍保留 `overrides` 參數，傳入非空物件時丟出 `OVERRIDE_NOT_SUPPORTED`，呼叫端不要傳。`add-buzz-in-submission` 不包含它。

```js
{
  questionId: 3,
  settled: true,                     // false 表示公平順位的 3 秒批次尚未結束（判定中）；未啟用公平順位時恆為 true
  winner: { groupId: 2, rank: 4 },   // 最終勝者（以原始 rank 指定是哪一筆）；沒有有效作答或判定中時為 null
  winnerSource: 'arrival',           // 'arrival' 先到先得｜'fair' 因公平順位改判；winner 為 null 時也為 null
  placings: [                        // 有效作答的顯示名次，從 1 起連續編號
    { groupId: 2, rank: 4, place: 1 },
    { groupId: 5, rank: 6, place: 2 },
  ],
}
```

判定結果不含 `answers`。需要答案時（例如匯出、學生結果頁），以 `questionId` + `winner.rank` 到作答紀錄查詢那一筆。

`rank` 是送達順序，`place` 是對外顯示的名次。兩者在未啟用公平順位、沒有作廢時只差在作廢造成的空號；啟用公平順位時名次可能與送達順序不同（與 SpecKit 005「`rank` 維持送達序號語意，顯示順位由判定結果提供」相同）。

推導規則：

1. 只取該題 `status: 'valid'` 的作答。
2. **未啟用公平順位**：依 `rank` 由小到大排出 `place`，第 1 名為勝者，`winnerSource` 為 `'arrival'`。
3. **啟用公平順位**（D14、D25，與 SpecKit 005 相同）：
   - 以該題第一個有效作答的 `submittedAt` 起 3000 毫秒內（含）送達者為同一批，其餘為批次外。
   - 同批內依「已判定題目中的搶答成功題數」由少到多排序，相同再比 `rank`；批次外依 `rank` 排在批內之後。
   - 3000 毫秒含邊界：送達時間恰好等於第一個有效作答加 3000 毫秒者仍屬同一批（與 SpecKit 005 相同）。
   - 題目依各自第一個有效作答的送達時間先後依序判定；兩題的第一個有效作答時間相同時，題號小的先判定。判定時只使用前面已判定題目累積的成功題數。
   - **判定中**（SpecKit 005 AC-005-08、FR-010）：`now` 小於「該題第一個有效作答的 `submittedAt` + 3000 毫秒」時，該題 `settled` 為 `false`、`winner` 為 `null`，`placings` 暫以 `rank` 排序；該題的結果不計入後面題目的成功題數。批次結束後同一份資料重新推導即為定案結果。
   - 勝者不是該題 `rank` 最小者時，`winnerSource` 為 `'fair'`。
   - 作廢後從頭重新推導，後面已判定的題目連鎖重算（D25）。
4. 同一份作答資料、設定與 `now`，推導結果都相同；所有題目都已過批次時間後，結果不再隨 `now` 改變。`now` 省略或活動已結束（server 傳 `Infinity`）時，視為所有題目都已判定。
5. 沒有有效作答的題目 `settled` 為 `true`、`winner` 為 `null`、`placings` 為空陣列。

`fairRankingEnabled` 存在 `session` 上，預設 `false`；由 `POST /api/session/start` 的 body 設定（只能在「準備中」開始時決定），重設活動後回到 `false`。見 [API 契約](api-contract.md)。

## 3. 各功能如何使用

| 功能 | 讀取內容 | 負責 |
| --- | --- | --- |
| 學生送出 | 寫入作答紀錄 | 學生端成員（`add-buzz-in-submission`） |
| 學生結果頁 | 每題 `winner` 的組別與答案；自己組在各題的 `place` | 學生端成員（`add-student-results`） |
| 老師監看（搶答中） | 每題每組的作答狀態（未送出／已送出／已作廢）、答案、`place`；`settled` 為 `false` 的題目標示「判定中」 | 教師端成員 |
| 老師結果（已結束） | 每題 `winner`、`winnerSource` | 教師端成員 |
| 下載 xlsx | 每題 `winner` 那筆作答的 `answers`，`answers[i]` 寫到匯入時保存的 `blanks[i]` 答案寫入位置；`winner` 為 null 的題目不寫 | 教師端成員（`add-guided-notes-export`） |
| Google 試算表寫回 | 同上，但寫回前重新讀取線上試算表，以匯入時同一套表頭與題號規則重新定位 `blanks[i]` 的答案寫入位置，不使用匯入時保存的位置；題號或空格數對不上時拒絕寫入（D12、O6） | 教師端成員（`add-guided-notes-export`） |
| CSV 匯出 | 見下一節 | 教師端成員 |

### CSV 對應（D13）

每筆**有效**作答 × 每個空格一列，依題號、`place`、空格序排序。欄位依序為 `題號,空格序,組別,答案,順位,是否搶答成功,送出時間,公平順位`：

| 欄位 | 來源 |
| --- | --- |
| 題號 | `questionId` |
| 空格序 | 該題 `blanks[i].index` |
| 組別 | 組別名稱（`groups[].name`） |
| 答案 | `answers[i]` |
| 順位 | 判定結果的 `place` |
| 是否搶答成功 | 該題 `winner` 為 `是`，其餘為 `否` |
| 送出時間 | `submittedAt` 轉為本地時間，不輸出 `Z` 或時區後綴 |
| 公平順位 | 未啟用為 `否`；啟用時為 `是`，該題 `winnerSource` 為 `'fair'` 時為 `是（改判）` |

檔案格式（與 SpecKit 004 現況一致，2026-11-23 由 SpecKit 組提供）：

- UTF-8 含 BOM、CRLF 換行，Excel 直接開啟不亂碼。
- 欄位值以 `=`、`+`、`-`、`@` 開頭時，前面加單引號 `'`，避免被試算表當成公式。
- 欄位含逗號、雙引號或換行時，依 RFC 4180 以雙引號包住，內部的雙引號改成兩個。
- 組別一律輸出組名，不輸出組別 id（兩組的 id 型別不同，本組為整數、SpecKit 為 UUID，使用者都看不到 id）。

## 4. 尚待確認

- CSV「順位」欄：本文件用判定結果的 `place`（有效作答之間連續編號，啟用公平順位時為改判後的名次）；SpecKit 說明為「該題送達順位」。未啟用公平順位且沒有作廢時兩者相同；有作廢或公平順位時是否一致，做 CSV 匯出時與 SpecKit 確認。

已解決（v0.4）：

- O3 老師改選：不納入共同契約，兩組都不實作（SpecKit 2026-11-23 回覆），已移除第 2 節的改選規則與 `overrides`。
- CSV 格式細節：依 SpecKit 004 現況補上（BOM、CRLF、公式前綴、RFC 4180、組別用組名）。

已解決（v0.3）：

- `voidedAt`：採用。
- `computeResults()` 的位置：`server/results.js`，由 `add-results-computation` 實作，教師端成員負責。
- 判定中：新增 `now` 參數與 `settled` 欄位。
- 兩題第一個有效作答時間相同時，以題號小者先判定。
- 寫回的位置：改為寫回前重新定位，與 D12、O6 一致。
