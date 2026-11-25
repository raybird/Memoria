# Issue 38 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)。

## 設計方案

- **計數範圍**：`countUnscanned` 依 repository 登記的 `default_branch` 計算 `rev-list --count refs/heads/<default_branch> --tags --not <tips>`。`default_branch` 為 null，或這個本機分支不存在時，退回原本的 `--branches --tags HEAD`（SCN-004）。檔頭註解原本寫「和 sync 會發現的提交相同」，改為說明兩者刻意不同：計數只反映合併或發版之後該 sync 的變更。
- **未掃描的 tag**：列出本機 `refs/tags/*` 中，不在 `getCurrentRefObservations` 已觀察 ref 裡的 tag，依 tag 建立時間由新到舊排列。`RepoScanLag` 加 `unscanned_tags: string[] | null`（null 表示量不到，和 `unscanned_commits` 一致）。
- **brief 顯示**：Repository 狀態行在 `unscanned_tags` 非空時加「｜ 未掃描 tag: <名稱>」，最多列 3 個，超過時加「等 N 個」。`BriefData` 的 repository 加 `unscanned_tags`；HTTP `/v1/brief` 隨之多這個欄位。
- **doctor**：repo scan 檢查沿用新的計數，仍然永遠是 `ok`（未掃描在兩次 sync 之間是正常狀態）。
- `repo sync`、`listNewCommits` 與 scanner 都不改（SCN-005）。

## 實作步驟

1. 📝 **盤點預設分支（最大風險）** — 唯讀查本機資料根：列出每個 repository 的登記預設分支，以及它最近 30 天合併提交實際所在的分支，標出不一致的 repository，結果依 TBD-1 交使用者決定。相依：無。
   - 完成判準：盤點表記在本步驟；TBD-1 有結論，或明確列為已知限制。
   - 完成證據：
2. 📝 **SCN-001、SCN-002、SCN-004：計數範圍** — 在 `test-brief-scope.sh` 的 (K) 段先寫斷言取得紅燈，再改 `countUnscanned`。相依：步驟 1。
   - 完成判準：三個 Scenario 綠燈；(K) 段原有的斷言不變。
   - 完成證據：
3. 📝 **SCN-003：未掃描的 tag** — 先寫斷言取得紅燈，再改 `scan-lag.ts`、`brief.ts`、型別。相依：步驟 2。
   - 完成判準：brief 人讀輸出與 `--json` 都正確，sync 後清除。
   - 完成證據：
4. 📝 **SCN-005：sync 範圍不變** — 以 `test-repo-sync.sh`、`test-repo-events.sh` 的既有斷言作回歸；另在 (K) 段斷言 feature 分支提交 sync 後照常產生事件。相依：步驟 2。
   - 完成判準：`repo` 組腳本全綠。
   - 完成證據：
5. 📝 **文件與回歸** — 更新 `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`（`/v1/brief` 欄位）、`docs/OPERATIONS.md`（未掃描的計算範圍）；跑 `core`、`http-mcp`、`repo` 組。相依：步驟 2～4。
   - 完成判準：三組全綠，文件與行為一致。
   - 完成證據：

## 測試策略

| 驗收編號 | 測試層級 | 腳本 |
|---|---|---|
| SCN-001～004 | CLI 端到端（真實 git fixture） | `scripts/test-brief-scope.sh` (K) 段 |
| SCN-005 | 回歸 | `scripts/test-repo-sync.sh`、`scripts/test-repo-events.sh`、(K) 段 |
| `/v1/brief` 欄位 | HTTP 契約 | `scripts/test-http-api.sh` |
