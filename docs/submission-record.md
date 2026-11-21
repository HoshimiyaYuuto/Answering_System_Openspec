# 作答紀錄與判定結果（資料格式約定）

版本 v0.1｜2026-11-21｜教師端成員提出，待學生端成員確認

本文件約定 server 內部保存的作答紀錄格式，以及由作答紀錄推導出的每題判定結果。學生端成員負責實作（`add-buzz-in-submission`），教師端的監看、結果、匯出與寫回都讀這份格式。實作時若需要調整，請直接修改本文件並告知另一位成員。

規則與 SpecKit 組的子功能 003（作答）、004（匯出）、005（公平順位）一致，只比對可觀察行為；欄位名稱配合本專案的題目與組別格式（題號 `id` 與組別 `id` 都是數字、空格以 `index` 編號）。

## 1. 作答紀錄（Submission）

一個組別對一題的一次送出。存在 server 記憶體的 `session.submissions` 陣列，與題目、組別一樣在 server 重啟或重設活動時清空。

```js
{
  id: 'b3f1c2d4-…',        // 隨機字串（crypto.randomUUID()）
  questionId: 3,           // = session.questions[].id，學習單上的題號
  groupId: 2,              // = groups[].id
  answers: [               // 依空格順序，筆數等於該題空格數；題組整題一起送出（D10）
    { blankIndex: 1, text: '細胞膜' },
    { blankIndex: 2, text: '粒線體' },
  ],
  sequence: 4,             // 該題第幾個送達，從 1 開始遞增
  receivedAt: '2026-11-21T08:00:00.000Z',  // server 收到的時間（ISO 8601 UTC）
  voidedAt: null,          // 老師作廢時間；非 null 表示已作廢
}
```

規則：

| 規則 | 依據 |
| --- | --- |
| 每題每組同一時間最多一筆 `voidedAt === null` 的有效作答；重複送出拒絕，原紀錄不變 | D4、D5、D6 |
| `answers` 的 `blankIndex` 不重複，筆數必須等於該題的空格數，每格都要有答案才能送出 | D10 |
| `text` 為去除前後空白後的答案，長度 1–200 字元；不判斷對錯 | D23 |
| `sequence` 以該題所有作答（含已作廢）的最大值 + 1 產生，給出後不改變；作廢不遞補、號碼不重用 | D6、D24 |
| 先後順序一律以 `sequence` 判斷；`receivedAt` 只用於顯示、CSV 與公平順位的 3 秒批次判定 | D6、D14 |
| 同題同時到達的請求必須依序處理，不得產生重複的 `sequence` | explore_summary 第 7 節 |
| 作廢只設定 `voidedAt`，不刪除紀錄；只能在「搶答中」作廢 | D24 |
| 作廢後同組可重送，重送是新的一筆，`sequence` 排在該題目前最大值之後；其他組的 `sequence` 不變 | D24 |
| 已作廢的作答不計入搶答成功、進度、結果、CSV 與寫回 | D24 |
| 學生端在搶答中只能取得自己組的作答；不得從任何回應得知他組是否已送出 | D7 |

## 2. 判定結果（QuestionResult）

每題一筆，**不儲存**，每次由作答紀錄即時推導。學生結果頁、老師監看與結果、CSV、xlsx 匯出與 Google 試算表寫回都使用同一個推導函式，確保結果一致。

```js
computeResults({ questions, submissions, fairRankingEnabled, overrides })
// 依題號順序回傳每題的判定結果
```

```js
{
  questionId: 3,
  winner: { groupId: 2, submissionId: 'b3f1c2d4-…' },  // 最終勝者；沒有有效作答時為 null
  winnerSource: 'arrival',   // 'arrival' 先到先得｜'fair' 因公平順位改判｜'override' 老師改選
  ranks: [                   // 有效作答的顯示順位，從 1 起連續編號
    { groupId: 2, submissionId: 'b3f1c2d4-…', rank: 1 },
    { groupId: 5, submissionId: '9c0a77e1-…', rank: 2 },
  ],
}
```

推導規則：

1. 只取該題 `voidedAt === null` 的作答。
2. **未啟用公平順位**：依 `sequence` 由小到大排出 `rank`，第 1 位為勝者，`winnerSource` 為 `'arrival'`。
3. **啟用公平順位**（D14、D25，與 SpecKit 005 相同）：
   - 以該題第一個有效作答的 `receivedAt` 起 3000 毫秒內（含）送達者為同一批，其餘為批次外。
   - 同批內依「已判定題目中的搶答成功題數」由少到多排序，相同再比 `sequence`；批次外依 `sequence` 排在批內之後。
   - 題目依各自第一個有效作答的送達時間先後依序判定，判定時只使用前面已判定題目累積的成功題數。
   - 勝者不是該題 `sequence` 最小者時，`winnerSource` 為 `'fair'`。
   - 作廢後從頭重新推導，後面已判定的題目連鎖重算（D25）。
4. **老師改選**（本組 O3）：`overrides` 為 `{ [questionId]: submissionId }`，只能在「已結束」設定，且只能選該題的有效作答。有設定的題目以它為勝者，`winnerSource` 為 `'override'`；`ranks` 維持原本的推導結果。
5. 同一份作答資料與設定，任何時刻推導結果都相同。

`fairRankingEnabled` 與 `overrides` 存在 `session` 上：前者只能在「準備中」設定，預設 `false`；後者在重設活動時清空。

## 3. 各功能如何使用

| 功能 | 讀取內容 | 負責 |
| --- | --- | --- |
| 學生送出 | 寫入 `session.submissions` | 學生端成員 |
| 學生結果頁 | 每題 `winner` 的組別與答案；自己組在各題的 `rank` | 學生端成員 |
| 老師監看（搶答中） | 每題每組的作答狀態（未送出／已送出／已作廢）、答案、`rank` | 教師端成員 |
| 老師結果（已結束） | 每題 `winner`、`winnerSource`，改選操作寫入 `overrides` | 教師端成員 |
| xlsx 匯出與 Google 試算表寫回 | 每題 `winner` 的 `answers`，依 `blankIndex` 寫到匯入時保存的答案寫入位置；`winner` 為 null 的題目不寫 | 教師端成員 |
| CSV 匯出 | 見下一節 | 教師端成員 |

### CSV 對應（D13）

每筆**有效**作答 × 每個空格一列，UTF-8 含 BOM，依題號、`rank`、空格序排序：

| 欄位 | 來源 |
| --- | --- |
| 題號 | `questionId` |
| 空格序 | `blankIndex` |
| 組別 | 組別名稱（`groups[].name`） |
| 答案 | `answers[].text` |
| 順位 | 判定結果的 `rank` |
| 是否搶答成功 | 是否為該題 `winner` |
| 送出時間 | `receivedAt` 轉為本地時間，不輸出 `Z` 或時區後綴 |
| 公平順位 | 未啟用為 `否`；啟用時為 `是`，該題 `winnerSource` 為 `'fair'` 時為 `是（改判）` |

老師改選的題目在 CSV 仍保留原始 `rank`，「是否搶答成功」以改選後的勝者為準。

## 4. 尚待確認

- 學生端讀取題目、送出、查詢自己組狀態的 API 路徑與回應格式，由 `add-buzz-in-submission` 定義並寫入 `docs/api-contract.md`。
- `computeResults()` 放在哪個模組由學生端成員決定；教師端只依賴它的輸入與輸出格式。
