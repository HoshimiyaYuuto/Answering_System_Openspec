# AGENTS.md

## 專案規則
- 需求依據：`docs/explore_summary.md`；每次只處理指定的 OpenSpec change 與 tasks，不做範圍外的事。
- 實作與契約不一致時先停下回報，不要自行修改契約或 spec。
- 不得在任何檔案、log 或 commit 寫入真實密碼、金鑰或機敏資料；密碼只放 `.env`，repo 只放 `.env.example`。
- 每個 task 驗證通過才在 `tasks.md` 打勾。
- 不要整個 repo 重新掃描，只讀與目前 task 相關的檔案。
- 前端更新畫面一律以「取代」內容（例如 `replaceChildren()`、設定 `textContent`），不得用附加的方式累加；同一個資料來源若可能被同時請求多次，必須丟棄過期的回應。
- 沙盒無法執行 `npm test` 時，不得宣稱測試已通過，只回報改動的檔案，由使用者在本機驗證。

## Git 規則
- 不使用 `git add .`，只加入這次改動的檔案。
- commit 前先列出 `git status` 與提交檔案清單，確認沒有 `.env` 或金鑰。
- 不使用 `--force`，不直接推送 `main`。
- 推送前先告訴使用者要推到哪個分支與包含哪些 commit，等確認後再推。
- commit 訊息註明對應的 change 與 task 編號。
- 請務必在 Commit 訊息的最底下加上共同作者標記 Co-Authored-By: Codex <codex@openai.com>