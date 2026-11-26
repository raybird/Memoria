# Issue 38 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)。

## 設計方案

- **計數範圍**：`countUnscanned` 依 repository 登記的 `default_branch` 計算 `rev-list --count refs/heads/<default_branch> --tags --not <tips>`。`default_branch` 為 null，或這個本機分支不存在時，退回原本的 `--branches --tags HEAD`（SCN-004）。檔頭註解原本寫「和 sync 會發現的提交相同」，改為說明兩者刻意不同：計數只反映合併或發版之後該 sync 的變更。
- **未掃描的 tag**：列出本機 `refs/tags/*` 中，不在 `getCurrentRefObservations` 已觀察 ref 裡的 tag，依 tag 建立時間由新到舊排列。`RepoScanLag` 加 `unscanned_tags: string[] | null`（null 表示量不到，和 `unscanned_commits` 一致）。
- **brief 顯示**：Repository 狀態行在 `unscanned_tags` 非空時加「｜ 未掃描 tag: <名稱>」，最多列 3 個，超過時加「等 N 個」。`BriefData` 的 repository 加 `unscanned_tags`；HTTP `/v1/brief` 隨之多這個欄位。
- **doctor**：repo scan 檢查沿用新的計數，仍然永遠是 `ok`（未掃描在兩次 sync 之間是正常狀態）。
- `repo sync`、`listNewCommits` 與 scanner 都不改（SCN-005）。

## 實作步驟

1. ✅ **盤點預設分支（最大風險）** — 唯讀查本機資料根：列出每個 repository 的登記預設分支，以及它最近 30 天合併提交實際所在的分支，標出不一致的 repository，結果依 TBD-1 交使用者決定。相依：無。
   - 完成判準：盤點表記在本步驟；TBD-1 有結論，或明確列為已知限制。
   - 完成證據：✅ 2026-11-26。維護者資料根登記 12 個 active repository，每個以 `git rev-list --count --first-parent --since=30.days refs/heads/<分支>`（另加 `--merges`）量 main、master、dev、develop、staging、release 中存在的分支。下游以代稱記錄：

     | repository | 登記的預設分支 | 近 30 天 first-parent 提交／merge | 判定 |
     |---|---|---|---|
     | Memoria（本 repo） | main | main 88／0 | 一致 |
     | downstream-a | master | dev 223／163、master 42／37 | 不一致：整合分支是 dev；dev 有 926 個提交不在 master，最新 tag 只在 dev |
     | downstream-b | dev | dev 133／25、main 130／25、staging 120／23 | 一致（dev 為整合分支，main、staging 為部署分支） |
     | 其餘 9 個 | main 或 master | 只有登記的那個分支有活動 | 一致 |

     TBD-1 結論：使用者選更正，downstream-a 的登記已改為 dev（見 README TBD-1）。
2. ✅ **SCN-001、SCN-002、SCN-004：計數範圍** — 在 `test-brief-scope.sh` 的 (K) 段先寫斷言取得紅燈，再改 `countUnscanned`。相依：步驟 1。
   - 完成判準：三個 Scenario 綠燈；(K) 段原有的斷言不變。
   - 完成證據：✅ 2026-11-26。新增 `(K/issue-38)` 段，(K) 段原有斷言未改。紅燈（改程式前）：SCN-001 三項失敗（brief 顯示「未掃描 commit: 4」、`--json` 得 4、doctor 列為落後），SCN-002 得 7 而非 3。綠燈：`scan-lag.ts` 的 `countUnscanned` 改為 `measureLag`，有登記預設分支且本機有該分支時算 `refs/heads/<分支> --tags`，否則退回 `--branches --tags HEAD`；SCN-004（沒有登記預設分支）與「登記了但本機沒有該分支」兩種退回情況都斷言維持原計數。
3. ✅ **SCN-003：未掃描的 tag** — 先寫斷言取得紅燈，再改 `scan-lag.ts`、`brief.ts`、型別。相依：步驟 2。
   - 完成判準：brief 人讀輸出與 `--json` 都正確，sync 後清除。
   - 完成證據：✅ 2026-11-26。紅燈：Repository 狀態行沒有「未掃描 tag: v1.1.0」，`--json` 的 `unscanned_tags` 為 undefined（sync 前後各一項）。綠燈：`RepoScanLag`、`BriefRepository` 加 `unscanned_tags`，`MemoriaCore.attachScanLag` 一併帶入，`renderBrief` 最多列 3 個、超過加「等 N 個」（另斷言 4 個 tag 時寫「等 4 個」、`--json` 列全部 4 個）；sync 後清空。HTTP：`test-http-api.sh` 新增 issue-38 段，斷言 `/v1/brief` 的結構化 `unscanned_tags` 與 markdown 一致；以 main 的建置跑同一段會失敗（`unscanned_tags wrong: {…"unscanned_commits":0}`），不是假綠燈。
4. ✅ **SCN-005：sync 範圍不變** — 以 `test-repo-sync.sh`、`test-repo-events.sh` 的既有斷言作回歸；另在 (K) 段斷言 feature 分支提交 sync 後照常產生事件。相依：步驟 2。
   - 完成判準：`repo` 組腳本全綠。
   - 完成證據：✅ 2026-11-26。`repo sync`、`listNewCommits`、scanner 都沒改。(K/issue-38) 段斷言：feature 分支有 4 個提交時 `repo sync --dry-run` 的 `new_commits` 仍為 4，sync 後 feature 的提交在 `git_commits`。`repo` 組 8 支全綠（見步驟 5）。
5. ✅ **文件與回歸** — 更新 `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`（`/v1/brief` 欄位）、`docs/OPERATIONS.md`（未掃描的計算範圍）；跑 `core`、`http-mcp`、`repo` 組。相依：步驟 2～4。
   - 完成判準：三組全綠，文件與行為一致。
   - 完成證據：✅ 2026-11-26。文件：CLI 雙語（Repository 區塊的兩種提示、退回條件、更正登記的方式）、API 雙語（`/v1/brief` 的 `unscanned_commits` 範圍與 `unscanned_tags`）、OPERATIONS.md Scan lag（與 `new_commits` 不再必然相等、登記不一致時漏報與更正方式）、architecture.md、CHANGELOG（Added、Changed、升級注意），各檔 Last verified 更新。檢查：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`release:docs-check` 通過；以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 跑 core 組 10 支、http-mcp 組 5 支、repo 組 8 支，共 23 支全部 exit 0。

## 測試策略

| 驗收編號 | 測試層級 | 腳本 |
|---|---|---|
| SCN-001～004 | CLI 端到端（真實 git fixture） | `scripts/test-brief-scope.sh` (K) 段 |
| SCN-005 | 回歸 | `scripts/test-repo-sync.sh`、`scripts/test-repo-events.sh`、(K) 段 |
| `/v1/brief` 欄位 | HTTP 契約 | `scripts/test-http-api.sh` |
