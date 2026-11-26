# 審查報告
- 範圍：完整交付範圍（main..issue-38-scan-lag-default-branch，單一提交 2cca66c）
- Reviewed BASE SHA：c59a9ec83ff86eb812a511833c2a0483cf549038（main；`git merge-base main 2cca66c` 相同）
- Reviewed HEAD SHA：2cca66c72f092af7ce688e99846f6f1586b40702
- Reviewed patch-id：0e55ab03ff57d101836c360ce7880a8c717234d3（`git diff c59a9ec 2cca66c | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（未參與實作），2026-11-26

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
1. **英文文件的退回條件寫成「not checked out locally」，意思跟程式相反。** `docs/CLI.md:68`「when that branch is not checked out locally」與 `CHANGELOG.md:13`「when it is not checked out locally」。程式的條件是本機沒有 `refs/heads/<預設分支>`（`src/core/git/scan-lag.ts:30-33`、`:47-49`），跟 HEAD 停在哪個分支無關。照 git 用語讀「checked out」，SCN-001 的情境（HEAD 在 feature，main 沒有 checked out）會被讀成退回全部分支，正好和實際行為相反。`docs/API.md`、`docs/OPERATIONS.md`（not local）與兩份 zh-TW（本機沒有這個分支）都寫對了。建議改成「when no local branch by that name exists」或「is not a local branch」。
2. **doctor 的 repo scan 對「只有未掃描 tag」的 repository 仍回報 up to date，與 brief 不一致。** `需決策`。常見流程是合併後先 sync，再在已掃描的提交上打發版 tag：這時 `unscanned_commits` 為 0、`unscanned_tags` 有值，brief 顯示「未掃描 tag: vX」，`doctor` 的 repo scan 卻寫「N of N repositories up to date」（`src/cli/commands/doctor.ts:141-149` 只看 `unscanned_commits`）。這不違反已核准的 SCN（SCN-003 只要求 brief 與 `--json`，README「關鍵差異」也只列 brief），所以不是缺陷，但「up to date」這個字面敘述從此可能與 brief 矛盾。待決問題：doctor 要不要也點名未掃描的 tag？做法 A：doctor 的 repo scan 值加上未掃描 tag（新行為，要新增 Scenario 並取得核准，可在本 issue 或另開 issue）；做法 B：維持現狀，在 `docs/OPERATIONS.md` Scan lag 寫明 doctor 只看提交數。reviewer 建議 B 在本 issue 完成（改一句文件），A 有需要再另開 issue。

### NICE TO HAVE
1. **被移動的 tag 不會被點名。** `src/core/git/scan-lag.ts:52-53` 只比對 tag 名稱。`git tag -f v1 <新提交>` 之後，v1 的名稱已在 `git_refs` 中，所以不會列為未掃描（實測 `{"c":1,"t":[]}`，提交數仍會反映新提交）。比對 `%(objectname)`／`%(*objectname)` 與已觀察的 `commit_sha` 就能抓到。重新打 tag 很少見，所以不阻擋。
2. **「newest first」實際上是依 `creatordate` 排序。** 輕量 tag 的 creatordate 是被標記提交的 committer date，不是打 tag 的時間，所以替舊提交補打的輕量 tag 會排在後面。排序也沒有斷言（四個 tag 指向同一個提交）。可以在文件寫「依 tag 日期（輕量 tag 用提交日期）」，或補一個順序斷言。
3. **`unscanned_tags` 在 JSON 沒有上限。** 實測一次多出 5000 個 tag 時，`brief --json` 從 696 bytes 變成 40717 bytes，markdown 仍只列 3 個。目前可以接受；如果之後 HTTP 呼叫端反映 payload 太大，再考慮加上限。
4. **可以少一次 git 呼叫。** `hasLocalBranch` 與 tag 列表是兩次 `for-each-ref`，可以合併成一次（`for-each-ref --format=%(refname) refs/heads/<branch> refs/tags`，再在記憶體中分開）。實測 5000 個已觀察加 5000 個未掃描的 tag，brief 從 129 ms 增加到 222 ms，影響不大，屬可讀性與效率的小改善。
5. `scripts/test-brief-scope.sh:2-14` 檔頭的段落清單沒有加上 `(K/issue-38)`。

## 已查核維度

### 驗收與證據

核准：README 的 Gherkin 區塊在 `fec4368..2cca66c` 之間沒有變動（diff 只動了涉及檔案、核准 commit、TBD-1、Timeline 與狀態）。`fec4368` 是 HEAD 的祖先，核准來源涵蓋 SCN-001～005。

紅燈的獨立驗證：用 `git worktree add` 檢出 c59a9ec，用 main 的原始碼建置，換上 HEAD 版的兩支測試腳本後執行：
- `test-brief-scope.sh` exit 1，`(K/issue-38)` 共 9 項失敗：SCN-001 三項（brief 顯示「未掃描 commit: 4」、`--json` 得到 4、doctor 寫 `k38 4`）、SCN-002（得到 7）、SCN-003 三項（沒有 tag 行，`unscanned_tags` 為 undefined）、4 個 tag 的兩項。SCN-004 與「登記了但本機沒有該分支」兩項在 main 上通過，符合它們「維持原行為」的性質。
- `test-http-api.sh` exit 1：`unscanned_tags wrong: {"repository":"http38",…,"unscanned_commits":0}`。

這和實作計畫步驟 2、3 記錄的紅燈一致。

| 驗收 | 證據 | 結論 |
|---|---|---|
| SCN-001 | `scripts/test-brief-scope.sh` (K/issue-38)：feature 分支有 4 個提交時，brief 行沒有「未掃描」、`--json` 為 0、doctor 為 `1 of 1 repositories up to date`。期望值都是字面值，main 上為紅燈 | 通過 |
| SCN-002 | 同段：main 新增 3 個提交後顯示「未掃描 commit: 3」（main 上是 7），sync 後沒有「未掃描」 | 通過 |
| SCN-003 | 同段：annotated tag v1.1.0 出現在狀態行，`--json` 為 `v1.1.0`，sync 後 length 0。另外 4 個輕量 tag 時寫「等 4 個」、`--json` 有 4 個。`test-http-api.sh` issue-38 段斷言 `/v1/brief` 的結構化欄位與 markdown 一致 | 通過 |
| SCN-004 | 同段：k38n 沒有 remote，先斷言 `default_branch` 為 null，side 分支 2 個提交時計數為 2。這是保持原行為的 characterization 斷言，main 上本來就綠，屬預期。另一項「登記 main、本機改名為 trunk」的斷言期望 1，若沒有退回機制（`--ignore-missing` 會把不存在的 ref 略過，只算 tag）會得到 0，所以這項確實能抓到錯誤實作 | 通過 |
| SCN-005 | 同段：dry-run 的 `new_commits` 仍為 4；sync 後 feature 的提交在 `git_commits`。`src/core/git/scanner.ts` 與 `listNewCommits` 不在 diff 內。`test-repo-sync`、`test-repo-events` 在 HEAD 全綠 | 通過 |

reviewer 在 HEAD 重跑（前綴 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`；工作樹的 `dist/cli.mjs` 與在 2cca66c 重新建置的產物比對，只差在 esbuild 的模組路徑註解，正規化後相同）：
- `pnpm run check` 通過。
- core 組：`test-pure-functions`、`test-smoke`、`test-cli-memory`、`test-memory-attributes`、`test-brief-scope`、`test-migrations`、`test-prune`、`test-utility-ranking`、`test-bootstrap`、`test-setup-onboarding`：10 支全部 exit 0
- http-mcp 組：`test-memory-browser`、`test-ui-http`、`test-http-api`、`test-mcp-e2e`、`test-vector-recall`：5 支全部 exit 0
- repo 組：`test-repo-git-exec`、`test-repo-registry`、`test-repo-sync`、`test-repo-events`、`test-repo-summary`、`test-repo-promotion`、`test-repo-edge`、`test-repo-noninvasive`：8 支全部 exit 0
- `pnpm run release:docs-check`：exit 0（`Release doc sync check passed for v1.39.0`）；`bash -n`（兩支測試腳本與 install.sh）：exit 0

### 相關失敗面

以 HEAD 建置在暫存資料根實測：

| 輸入／狀態 | 預期 | 實測／覆蓋 | 判定 |
|---|---|---|---|
| 預設分支名稱含 `/`（`release/2026`），另有同名 tag 指向 feature | 用完整 refname，不會混淆；tag 帶進 feature 的提交 | `{"c":2,"t":["release/2026"]}` | 正確 |
| 登記 `ma`，本機只有 `main`（前綴比對） | for-each-ref 依路徑元件比對，不會命中；退回全部分支 | `{"c":1,"t":[]}`；另外 `.includes()` 精確比對也擋住 `refs/heads/main/x` 這類情況（files backend 下兩者本來就不能並存） | 正確 |
| detached HEAD 上有新提交，已登記預設分支 | 不算（屬未合併的工作） | `{"c":0}` | 符合 SCN-001 的意圖 |
| annotated／輕量 tag | 都會列出 | 測試兩種都有 | 正確 |
| tag 指向已掃描的提交 | 計數 0，tag 照列 | 4 個輕量 tag 的斷言、HTTP 段都屬這種情況 | 正確 |
| tag 被刪除 | 不列 | 實測不列 | 正確 |
| tag 被移動 | 理想上要列 | 不列（NICE TO HAVE 1） | 小缺口 |
| 從沒掃描過（tips 為空） | null | `measureLag` 第一行回傳 UNMEASURED，沿用舊行為 | 正確 |
| 路徑已不是這個 repository | null | fingerprint 不符時回傳 UNMEASURED；原 (K) 段的路徑失效斷言仍綠 | 正確 |
| disabled 的 repository | 跳過 | `measureScanLag` 的 filter 沒有改動 | 正確 |
| 登記值是 `origin/dev`、`refs/heads/dev`，或含 glob 字元 | 找不到本機分支就退回全部分支（多報，不會漏報） | 由 `hasLocalBranch` 的精確比對保證；參數經 argv 傳遞，沒有 shell 注入 | 可以接受 |
| 大量 tag | 延遲可以接受 | 5000 個已觀察加 5000 個未掃描：222 ms，main 為 129 ms | 可以接受 |
| git 指令白名單 | 只用 `rev-list`、`for-each-ref` | 兩者都在 `src/core/git/git-exec.ts` 的 `ALLOWED_SUBCOMMANDS` 內；`test-repo-noninvasive` 全綠 | 正確 |
| 登記的預設分支不是實際整合分支（最大風險） | 漏報 | 依 TBD-1 盤點並更正；常青文件都寫明更正方式（`repo add` 的 upsert 用 `COALESCE(?, default_branch)` 覆寫，`src/core/db/git-repo.ts:180`） | 已處理，限制已揭露 |

### 需求、架構、安全、品質
- 需求：計數範圍、tag 點名與「sync 範圍不變」都符合核准的 SCN 與 README「關鍵差異」，沒有超出範圍的行為。
- 架構：邏輯留在 `src/core/git/scan-lag.ts`；`queryBrief` 仍然只讀資料庫（只是佔位 `unscanned_tags: null`），由 `MemoriaCore.attachScanLag` 事後帶入，與原設計一致。CLI、HTTP、doctor 共用 `measureScanLag`。沒有 schema 變更，也沒有新依賴。
- 安全：只用白名單內的唯讀 git 子命令，參數不經 shell。
- 文件：OPERATIONS 寫「沒有預設分支或本機沒有該分支時與 `new_commits` 相同」，經查 sync 的 `excludeShas`（`src/core/memoria.ts:1126`）與 scan-lag 的 tips 都取自 `is_current` 的 refs，敘述成立。doctor 的 repo scan 文字針對提交數仍然正確（tag 的落差見 SHOULD FIX 2）。英文「checked out」的措辭見 SHOULD FIX 1。根目錄 `AGENTS.md` 的 HTTP 段沒有列 `unscanned_*`；issue-38 之前的 `unscanned_commits` 也沒列，與既有慣例一致，不列為缺漏。
- 公開 repo 規則：diff 與提交訊息中沒有個人絕對路徑或外部專案真名；盤點表只用 downstream-a／b 代稱。
- 跨 Task 重複與過度設計（code-simplify 標準）：`Lag`／`UNMEASURED` 收斂了原本分散的 null 回傳，沒有過度抽象。只有兩次 `for-each-ref` 可以合併（NICE TO HAVE 4），沒有已經分歧的重複邏輯。

### 豁免、待確認與限制
- 沒有 Gate 豁免。TBD-1 已解決（使用者選擇更正，結論寫在 README）；它的殘餘影響（其他使用者的登記不一致時會漏報）已經寫進 CLI、API、OPERATIONS 與 CHANGELOG。
- README `**狀態**` 目前是「實作中」，Timeline 寫「待審查」。這屬記帳區段，由協調者在保存報告的提交更新，不影響判定。
- 限制：verify-artifact 要在報告提交後由協調者執行；本報告沒有提交，也沒有跑。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
