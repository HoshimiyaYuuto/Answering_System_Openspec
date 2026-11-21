# 作答紀錄與判定結果（資料格式約定）

版本 v0.2｜2026-11-21｜教師端成員整理

本文件約定 server 內部保存的作答紀錄，以及由作答紀錄推導出的每題判定結果。

- **作答紀錄**的欄位以學生端成員 `add-buzz-in-submission` 的 design（第 4 節「提交資料模型與預留擴充」）為準，本文件只補上之後作廢會新增的欄位。
- **判定結果**、公平順位、老師改選與 CSV 對應由教師端成員提出；學生結果頁、老師監看與結果、匯出與寫回都讀這份格式。

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
  status: 'valid',                     // 'valid'｜'voided'（作廢由之後的 change 加入）
  voidedAt: null,                      // 作廢時間；作廢 change 加入，'valid' 時為 null
}
```

- `add-buzz-in-submission` 只寫入 `status: 'valid'`；`voidedAt` 是本文件對作廢 change 的提案。
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
computeResults({ questions, submissions, fairRankingEnabled, overrides })
// submissions 為 listSubmissions() 的結果；依題號順序回傳每題的判定結果
```

```js
{
  questionId: 3,
  winner: { groupId: 2, rank: 4 },   // 最終勝者（以原始 rank 指定是哪一筆）；沒有有效作答時為 null
  winnerSource: 'arrival',           // 'arrival' 先到先得｜'fair' 因公平順位改判｜'override' 老師改選
  placings: [                        // 有效作答的顯示名次，從 1 起連續編號
    { groupId: 2, rank: 4, place: 1 },
    { groupId: 5, rank: 6, place: 2 },
  ],
}
```

`rank` 是送達順序，`place` 是對外顯示的名次。兩者在未啟用公平順位、沒有作廢時只差在作廢造成的空號；啟用公平順位時名次可能與送達順序不同（與 SpecKit 005「`rank` 維持送達序號語意，顯示順位由判定結果提供」相同）。

推導規則：

1. 只取該題 `status: 'valid'` 的作答。
2. **未啟用公平順位**：依 `rank` 由小到大排出 `place`，第 1 名為勝者，`winnerSource` 為 `'arrival'`。
3. **啟用公平順位**（D14、D25，與 SpecKit 005 相同）：
   - 以該題第一個有效作答的 `submittedAt` 起 3000 毫秒內（含）送達者為同一批，其餘為批次外。
   - 同批內依「已判定題目中的搶答成功題數」由少到多排序，相同再比 `rank`；批次外依 `rank` 排在批內之後。
   - 題目依各自第一個有效作答的送達時間先後依序判定，判定時只使用前面已判定題目累積的成功題數。
   - 勝者不是該題 `rank` 最小者時，`winnerSource` 為 `'fair'`。
   - 作廢後從頭重新推導，後面已判定的題目連鎖重算（D25）。
4. **老師改選**（本組 O3，尚待與 SpecKit 組確認是否納入共同契約）：`overrides` 為 `{ [questionId]: rank }`，只能在「已結束」設定，且只能指定該題的有效作答。有設定的題目以它為勝者，`winnerSource` 為 `'override'`；`placings` 維持原本的推導結果。
5. 同一份作答資料與設定，任何時刻推導結果都相同。

`fairRankingEnabled` 與 `overrides` 存在 `session` 上：前者只能在「準備中」設定，預設 `false`；後者在重設活動時清空。

## 3. 各功能如何使用

| 功能 | 讀取內容 | 負責 |
| --- | --- | --- |
| 學生送出 | 寫入作答紀錄 | 學生端成員（`add-buzz-in-submission`） |
| 學生結果頁 | 每題 `winner` 的組別與答案；自己組在各題的 `place` | 學生端成員（`add-student-results`） |
| 老師監看（搶答中） | 每題每組的作答狀態（未送出／已送出／已作廢）、答案、`place` | 教師端成員 |
| 老師結果（已結束） | 每題 `winner`、`winnerSource`；改選操作寫入 `overrides` | 教師端成員 |
| xlsx 匯出與 Google 試算表寫回 | 每題 `winner` 那筆作答的 `answers`，`answers[i]` 寫到匯入時保存的 `blanks[i]` 答案寫入位置；`winner` 為 null 的題目不寫 | 教師端成員 |
| CSV 匯出 | 見下一節 | 教師端成員 |

### CSV 對應（D13）

每筆**有效**作答 × 每個空格一列，UTF-8 含 BOM，依題號、`place`、空格序排序：

| 欄位 | 來源 |
| --- | --- |
| 題號 | `questionId` |
| 空格序 | 該題 `blanks[i].index` |
| 組別 | 組別名稱（`groups[].name`） |
| 答案 | `answers[i]` |
| 順位 | 判定結果的 `place` |
| 是否搶答成功 | 是否為該題 `winner` |
| 送出時間 | `submittedAt` 轉為本地時間，不輸出 `Z` 或時區後綴 |
| 公平順位 | 未啟用為 `否`；啟用時為 `是`，該題 `winnerSource` 為 `'fair'` 時為 `是（改判）` |

老師改選的題目在 CSV 仍保留原始 `place`，「是否搶答成功」以改選後的勝者為準。

## 4. 尚待確認

- 作廢 change 是否採用本文件提出的 `voidedAt` 欄位。
- `computeResults()` 放在哪個模組由學生端成員決定；教師端只依賴它的輸入與輸出格式。
- O3 老師改選是否納入共同契約，待 SpecKit 組回覆；若不納入，移除第 2 節第 4 點與 `overrides`。
