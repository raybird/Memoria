# Issue 22 獨立審查報告（第三輪）

- **Reviewed BASE SHA**: ac7610985fc07c068e284f4dc02b05c53e680576（`ac76109`，`main`）
- **Reviewed HEAD SHA**: cfcbc0d931d2032e7a17b7959f19e934c2ee3a33（`cfcbc0d`，分支 `issue-22-skill-deployment`）
- **Reviewed patch-id**: `a990ab51fd68319c04054760efee158184adae54`（`git diff ac76109 cfcbc0d | git patch-id --stable`）
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-20
- **報告位置**: `docs/issues/issue-22/review-cfcbc0d.md`
- **判定**: **PASS**

## 審查範圍與風險

完整範圍是 `ac76109..cfcbc0d`。前兩輪已審過 `ac76109..ccf0d94`（第二輪 patch-id `74cc85cc…`），本輪新增兩個提交：`1f62d32`（只新增第二輪報告）與 `cfcbc0d`（修正第二輪 M-1）。本輪重點是 `git diff ccf0d94 cfcbc0d`。

第二輪唯一的 MUST FIX 是測試可靠性問題：`scripts/test-bootstrap.sh` 用 `find | head -1` 挑備份，在 ext4 上約半數會挑到前一段 refresh 留下的舊備份，結果變成假紅燈。所以本輪要確認三件事：修正是否不再依賴目錄順序；第二輪那些變異是否仍然抓得到；產品程式碼有沒有被順手改到。

安全措施：所有 `setup` 都在隔離的 `HOME` 下執行（測試自己會再切換成 `$TMP` 底下的 H3、H4、H6），`COREPACK_HOME` 先固定好，命令一律用 `env -u LIBSQL_URL -u MEMORIA_HOME` 執行。worktree `rv22c` 建在 scratchpad 內，`node_modules` 用 symlink 指到主 repo，用完後 `worktree remove --force`。ext4 的 `TMPDIR` 用完已經刪除。整個過程沒有執行 `git worktree prune`。真實 `~/.claude/skills/memoria/` 的 4 個檔案，審查前後 sha256 完全相同（E12）。主 repo 工作區只剩審查前就有的 `.serena/project.yml` 修改。

## 證據

| 編號 | 命令／動作 | 結果 |
|---|---|---|
| E1 | `git diff --name-status ccf0d94 cfcbc0d` | 只改 5 個檔案：`docs/issues/issue-22/README.md`（多 1 列歷程）、`implementation-plan.md`（多步驟 7）、`review-ccf0d94.md`（新增）、`scripts/test-bootstrap.sh`、`src/cli/runtime.ts`。`runtime.ts` 只動到 doc comment 的一行，把 "moved" 改成 "copied" |
| E2 | `git diff --name-status ccf0d94 1f62d32`；`cmp` 比對該報告在 `1f62d32` 與 `cfcbc0d` 的內容 | `1f62d32` 只新增報告；`cfcbc0d` 沒有改動這份報告 |
| E3 | worktree `rv22c` @cfcbc0d：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n scripts/test-bootstrap.sh` | 全部 exit 0，build 印出 `✓ Built dist/cli.mjs` |
| E4 | `node scripts/check-deployed-skill-sync.mjs` | `deployed_skill_check=ok version=1.29.1` |
| E5 | 隔離 HOME，`TMPDIR` 指向 **ext4**，連跑 `bash scripts/test-bootstrap.sh` 8 次 | **8／8 exit 0**。log 有兩行 `✓ SCN-005`（refresh 與備份）以及最後的 `[bootstrap] ok`；`TMPDIR` 目錄裡出現 `node-compile-cache`，確認測試確實跑在 ext4 上 |
| E6 | 同樣條件，`TMPDIR` 指向 **tmpfs**，跑 1 次 | exit 0 |
| E7 | 對照組：同一個 worktree、同一個 ext4 `TMPDIR`，把測試換成 `ccf0d94` 版連跑 6 次（跑完以 `git checkout` 還原） | **4／6 失敗**，訊息都是 `✗ SCN-005: replaced copy was not backed up`。這證明測試環境足以重現第二輪的不穩定，E5 的 8／8 綠燈確實代表問題已修正 |
| E8 | 變異檢查，全部在 ext4 上跑（腳本先用 perl 改程式，接著 build、跑測試，最後 `git checkout` 還原） | 見下表，8 個變異全部讓測試變紅 |
| E9 | 把 `/bin/bash -c 'set -euo pipefail; X=$(find <不存在的目錄> … 2>/dev/null \| wc -l)'` 單獨執行 | 不印任何訊息就 exit 1，說明 N-1 的成因 |
| E10 | `detect_changes(scope=compare, base_ref=ccf0d94)` | `changed_count: 0`、`affected_count: 0`、`risk_level: low`；`changed_files: 6` 是 E1 的 5 個檔案加上工作區的 `.serena/project.yml` |
| E11 | 比對 `a79d3be` 與 `cfcbc0d` 的 Gherkin 區塊；`git log --format=%B ccf0d94..cfcbc0d` grep `co-authored`／`claude`；新增行 grep 本機路徑 | Gherkin 完全相同；commit 訊息沒有 AI 署名；新增行裡唯一的命中，是第二輪報告 E16 自己列出的搜尋詞 |
| E12 | 審查前後對真實 `~/.claude/skills/memoria` 跑 `find -type f -exec sha256sum`，排序後 `cmp` | 完全相同 |

### E8 變異檢查（ext4）

| 變異 | 結果 |
|---|---|
| 拿掉備份的 `fs.cp`（第二輪同名變異） | `✗ SCN-005: expected exactly one new backup (before: 0)` |
| 備份改放在目標旁邊，也就是 `~/.claude/skills/` 底下（第二輪同名變異） | `✗ SCN-005: text output does not name the backup path` |
| 同上，但先拿掉測試的文字模式斷言，確認後面還有防線 | exit 1（被 `count_backups` 擋下，但沒有印訊息，見 N-1） |
| 文字模式不印備份路徑（第二輪同名變異） | `✗ SCN-005: text output does not name the backup path` |
| `--json` 的 step log 不帶 `backup` 欄位 | `✗ SCN-005: replaced copy was not backed up` |
| `--json` 回報錯的備份路徑（實際備份照常進行） | `✗ SCN-005: replaced copy was not backed up` |
| 備份目錄名固定為 `claude-code-latest`，每次覆蓋或合併到同一個目錄 | `✗ SCN-005: expected exactly one new backup (before: 1)` |
| 先 `writeSkillCopy` 再備份（第二輪同名變異） | `✗ SCN-005: replaced copy was not backed up` |

## 審查結論

### 1. `ccf0d94..cfcbc0d` 的內容與確定性

- **範圍**：產品程式碼只改了一行註解（E1、E10）。用詞改成 "copied" 才符合實作：實作是先 `fs.cp`，再由 `writeSkillCopy` 執行 `rm`。這也處理了第二輪的 N-3 前半。
- **不再依賴目錄順序**：備份路徑改從這次 `setup --json` 的 step log 讀取（找 `step === "agent-skill"` 那一行的 `backup` 欄位），不再列舉目錄。另外兩個斷言（數量剛好 +1、路徑以 data root 的 `skill-backups/` 開頭）只用到 `wc -l` 和前綴比對，跟檔案系統的列舉順序無關。E5 在 ext4 上 8／8 綠燈，E7 的對照組則有 4／6 失敗，佐證修正有效。
- **斷言強度**：只要這次 setup 沒有在 data root 新增**恰好一份**、內容等於被覆蓋前版本的備份，或沒有如實回報路徑，測試就會失敗（E8 的 8 個變異都被抓到）。refresh 段改成文字模式後，第二輪「文字模式不印備份路徑」的變異仍然被抓到，所以 JSON 與文字兩種輸出都有斷言。文字模式只比對到 `claude-code-` 這個前綴，沒有比對完整路徑；不過完整路徑已由 JSON 段驗證，而兩種模式共用同一個 `deployed.backup`，可以接受。
- **文件**：`implementation-plan.md` 步驟 7 的描述（從 `--json` 讀路徑、斷言 +1、refresh 改文字模式、"moved" 改 "copied"、ext4 對照組 3／6 失敗，修正後 6／6 綠燈）與 diff 及本輪重現的結果一致。README 歷程多的那一列也如實記錄。

### 2. 測試執行

ext4 跑 8 次、tmpfs 跑 1 次，全部 exit 0（E5、E6）；`check`、`build`、`--help` 也都通過（E3）。本輪沒有重跑整套 CI。理由是程式碼的差異只有一行註解，bundle 的行為沒有變；其他 33 支測試在第二輪與實作者的紀錄裡都已通過，這次也沒有被觸及。

### 3. 漏跑 `detect_changes` 的流程疏漏

這是違反 repo 規範的流程疏漏：CLAUDE.md 要求 commit 前必須跑 `detect_changes`。但它**不影響判定**，理由有三：(a) 實作者事後已經補跑；(b) 本輪獨立以 `base_ref=ccf0d94` 重跑，結果仍是 `changed_count 0`、`low`（E10）；(c) 逐行檢視 diff 也確認 `src/` 只有一行註解（E1）。這個規範要防的是「改到預期之外的 symbol 或執行流程」，從結果來看並沒有發生。建議下次在 commit 前就跑，不需要退回。

### 4. patch-id 與前兩輪結論的延續

完整範圍的 patch-id 從 `74cc85cc…` 變成 `a990ab51…`，差異完全來自 E1 列出的 5 個檔案。前兩輪審過的產品程式碼（預檢順序、只認自有鍵的 `Object.hasOwn`、雙標記判定、`lstat`、備份的時機、位置與失敗路徑）、模板與文件，在這兩個提交裡都沒有改動。E8 裡沿用第二輪的變異全部仍然被抓到，`check-deployed-skill-sync` 也是 ok（E4），Gherkin 沒有變（E11），所以前兩輪通過的部分可以沿用，沒有被破壞。`test-no-clone-install.sh` 沒有重跑，因為打包內容只差一行註解。

## 發現

### MUST FIX

無。第二輪 M-1 已修正（E5、E7、E8）。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-1（失敗時沒有訊息）**：`count_backups` 裡的 `find … | wc -l` 在 `set -o pipefail` 底下執行，如果 `skill-backups/` 目錄不存在，`find` 會回傳非零，`BACKUPS_BEFORE=$(count_backups)` 因此讓 `set -e` 直接結束腳本，什麼都不印（E8 第三列、E9）。產品行為正確時，前一段 refresh 一定會建出這個目錄，所以這條路只有在產品已經壞掉時才會走到。而且結果仍然是紅燈，不會變成假綠燈，只是少了診斷訊息。可以在 `find` 後面加 `|| true`，或先判斷目錄是否存在。
- **N-2（沿用第二輪）**：第二輪 N-1（重跑 setup 會累積備份）、N-2（備份失敗的訊息是 Node 原始錯誤，失敗後還會留下不完整的目錄）、N-3 後半（`DEPLOYED_REFERENCE.md` 對拒絕條件的描述不夠精確），以及首輪沿用下來的 NICE 項目都還沒處理，不影響這次判定。

## 判定

**PASS**：沒有 MUST FIX，也沒有 SHOULD FIX。修正只動到測試、一行註解與文件，新的斷言是確定性的：ext4 上 8／8 通過，舊版對照組在同一環境 4／6 失敗。第二輪列出的變異，加上本輪新增的 JSON 回報與固定名稱變異，全部都會讓測試變紅。漏跑 `detect_changes` 已經補跑，獨立重跑的結果也是 changed_count 0，不影響判定。依 README 的相依說明，這個分支要等 issue-20 與 issue-21 合併後才能合併；rebase 之後 HEAD 會改變，屆時要重新確認（TBD-3）。
