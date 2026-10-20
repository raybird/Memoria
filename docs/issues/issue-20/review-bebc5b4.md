# Review — issue-20 `repo summarize --merge` 與 sync 共用 sourceRef 解析

- **Reviewed BASE SHA**: `ac76109`（`ac76109` 為 issue 文件核准 commit 回填後的提交）
- **Reviewed HEAD SHA**: `bebc5b4fa3aafb80042f1ef209a268dd7b9adb1f`（分支 `issue-20-merge-source-ref`，審查結束時分支仍指向此 SHA）
- **Reviewed patch-id**: `dd1e4cd8cb9ead984c38bb4502de586ab2cbe403`（`git diff ac76109 bebc5b4 | git patch-id --stable`）
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-20
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-20/review-bebc5b4.md`（審查時暫存於本機，以只新增報告的提交持久化）

## 審查範圍與風險

diff 範圍（4 檔，+58／-8）：

| 檔案 | 變更 |
| --- | --- |
| `src/core/git/summary-pipeline.ts` | 新增 `export function parseMergeSourceRef(message)`（regex 原樣從 sync 搬出）；sync 的 merge 段改呼叫它；`summarizeMergeCommit` 以 `runGit(['log','-1','--format=%B', mergeSha])` 讀 message，傳 `sourceRef: parseMergeSourceRef(message)` |
| `scripts/test-repo-summary.sh` | AC-1（先 sync 再 `--merge`）與 AC-2（先 `--merge` 再 sync）兩段，共 6 條斷言 |
| `scripts/pure-fn-driver.mts` | `parseMergeSourceRef` 四條字面值斷言（AC-3） |
| `docs/issues/issue-20/README.md` | 回填紅綠燈證據、狀態改「待審查」 |

規格：`bebc5b4:docs/issues/issue-20/README.md`，Small／Low，AC-1～AC-3 於 2026-10-20 以「照建議」核准。

主要風險面：(1) 兩條路徑 fingerprint 輸入（base、head、sourceRef、targetRef）是否真的一致；(2) 抽函式後 sync 路徑既有 fingerprint 是否完全不變（變了會讓所有既有 merge 範圍重複）；(3) 新的 git 呼叫是否在唯讀白名單內；(4) 測試是否真的會失敗。

## 正確性核對（fingerprint 四個輸入）

fingerprint = `sha256(repositoryId|summaryType|baseSha??''|headSha|sourceRef??''|targetRef??'')`（`src/core/db/git-summary.ts` `upsertSummaryRange`，本次未動）。

| 輸入 | sync 路徑 | `--merge` 路徑 | 結論 |
| --- | --- | --- | --- |
| headSha | event `after_sha`（完整 sha） | `rev-parse <ref>^{commit}` | 一致 |
| parents | `git_commits.parent_shas_json`，來源為 scanner `%P` | `rev-list --parents -n 1`，順序與 `%P` 相同 | 一致（octopus 都取 `[0]`、`[1]`） |
| baseSha | `mergeBase(p0,p1) ?? parents[0] ?? null` | `mergeBase(p0,p1) ?? parents[0]` | 一致（`--merge` 已先擋 parents<2） |
| sourceRef | `parseMergeSourceRef(fact.message)`；fact 是 scanner 存的 `%B`，只去掉結尾一個 `\n`，沒有截斷 | `parseMergeSourceRef(git log -1 --format=%B)`，帶結尾換行 | 一致：regex 沒有錨點，結尾空白不影響；同一份 `%B`、第一個符合處 |
| targetRef | `found.repository.default_branch ?? null` | `resolveManagedRepo` → 同一欄位 | 一致 |

- **白名單**：`log` 在 `ALLOWED_SUBCOMMANDS`（`git-exec.ts`），第 0 個參數就是子命令，`mergeSha` 已先解析成 sha，不會被當成選項注入。`GIT_OPTIONAL_LOCKS=0` 照常套用。
- **既有資料 fingerprint**：sync 路徑原本是 `fact ? /…/.exec(fact.message) : null` 再取 `?.[1] ?? null`，現在是 `fact ? parseMergeSourceRef(fact.message) : null`，兩者語意相同；下面 E-5 用 BASE 與 HEAD 的 bundle 對同一個 fixture 做 sync，比對結果每個 byte 都一樣。
- **呼叫端影響範圍**（人工查核）：`summarizeMergeCommit` 只有 `memoria.ts:1121` 呼叫（加上 `core/index.ts` re-export）；`runSummaryPipeline` 在 `memoria.ts:987`、`:1124`。新 export `parseMergeSourceRef` 沒有其他呼叫者。

## 證據（實際命令與結果）

Worktree：`git worktree add --detach .../scratchpad/rv20 bebc5b4`，`node_modules` symlink，HEAD = `bebc5b4fa3aa…`。審查後已 `worktree remove --force`，主 repo 與分支都沒動。

| # | 命令 | 結果 |
| --- | --- | --- |
| V-1 | `pnpm run check` | exit 0（`tsc --noEmit` 無輸出錯誤） |
| V-2 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| V-3 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-repo-summary.sh` | exit 0，`[repo-summary] PASS`；issue-20 的 6 條全 ✓ |
| V-4 | `bash scripts/test-pure-functions.sh` | exit 0，`[pure] parseMergeSourceRef` 4 條 ✓，`[pure] ok` |
| V-5 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-repo-noninvasive.sh` | exit 0，`byte-identical`、`.git/index untouched`、`[noninvasive] PASS` |

### 紅燈重現（`git checkout ac76109 -- src/core/git/summary-pipeline.ts` 後 `pnpm run build`，讓 `./cli` 跑 BASE 的 bundle）

| # | 命令 | 結果 | 與 README 證據比對 |
| --- | --- | --- | --- |
| R-1（AC-1） | 正式 `scripts/test-repo-summary.sh` | exit 1，`✗ --merge after sync creates nothing: expected '0', got '1'` | 相符 |
| R-2（AC-2） | 暫存副本：拿掉 AC-1 段，GitLab 格式的 source_ref 斷言改成 `true` | exit 1，`✗ sync after --merge adds no second summary for that merge: expected '1', got '2'` | 相符 |
| R-3（AC-3 整合面） | 暫存副本：只拿掉 AC-1 段 | exit 1，`✗ --merge parses source_ref from a GitLab-style message: expected 'feature/coupons', got 'null'` | 相符 |

三個紅燈都直接出自目標行為（`--merge` 沒解析 message），不是環境或語法錯誤。R-2 同時證明 AC-2 那條計數斷言不是空轉：BASE 的 sync 真的會處理這個 merge 並多建一筆。暫存副本跑完已刪，src 已還原成 HEAD 並重新 build。

### 邊界探測（reviewer 自寫 `.../scratchpad/probe/edge.sh`，跑 HEAD 與 BASE 的 bundle，不在 repo 內）

一個 fixture 有四個 `--no-ff` merge：
- M-a `Merge branch 'feat-a' of example.com:org/repo`（`git pull` 的預設格式）
- M-b subject 是 `integrate pricing work`，內文寫 `Merge branch 'stale-note' mentioned in body`
- M-c `Merge remote-tracking branch 'origin/feat-c'`
- M-d `Merge branch 'feat-d' into 'main'\r\n`（CRLF 結尾）

| # | 失敗面／輸入 | 預期 | 實際 | 結論 |
| --- | --- | --- | --- | --- |
| E-1 | 順序 A：四個都先 `--merge`，再 sync | sync 不再新增 merge 摘要，每個 head 恰 1 筆 | 四個 `--merge` 都是 `created 1`；sync 後每個 head 1 筆（feat-d／null／stale-note／feat-a） | 通過 |
| E-2 | 順序 B：先 sync，四個再 `--merge` | 四個都 `created 0` | 四個都 `created 0`，每個 head 1 筆 | 通過 |
| E-3 | 內文含 `Merge branch '…'` 的自訂 subject（M-b） | 兩條路徑結果一致 | 兩條都得到 `stale-note`（不是 null） | 一致。這是 sync 原有的 regex 行為；改成錨定 regex 會改掉既有 sync 範圍的 fingerprint，所以維持原樣才對。見 N-1 |
| E-4 | 升級情境：BASE `--merge` 建立舊列（sourceRef null，從未 sync），再用 HEAD `--merge` | 規格寫明「已產生的重複列不回溯合併」 | HEAD `--merge` `created 1`，同一 head 有兩個範圍（`<null>` 與 `feat-a`） | 不算回歸：BASE 下一次 sync 本來就會多建 `feat-a` 那筆，最後列數一樣。屬於已揭露的殘留，見 S-2 |
| E-5 | fingerprint 穩定性：固定 author／committer date，同一個 fixture 分別用 BASE 和 HEAD bundle sync | ranges 完全相同 | 兩邊 5 列（type、source_ref、base、head、target）的 hash 都是 `07363cb46792d7b5`，fixture HEAD 相同 | 通過，既有資料 fingerprint 不變 |
| E-6 | remote-tracking（M-c）與 CRLF（M-d） | null／`feat-d`，兩條路徑一致 | 相符 | 通過 |
| E-7 | 白名單與非侵入 | 新呼叫只用 `log` | 原始碼核對，V-5 PASS，test-repo-summary 結尾 `git status clean` ✓ | 通過（noninvasive 沒有跑 `--merge`，見 N-2） |

## 測試真偽

- **AC-1**：期望值 `SYNC_MERGE_ID` 是用 SQL 從 DB 查 sync 建的那筆，`--merge` 的 id 是從 CLI JSON 讀，兩邊不共用實作，斷言可能不一致，所以不是同義反覆；列數斷言比對的是執行前的實際計數。R-1 確認它會紅。
- **AC-2**：計數斷言 R-2 確認會紅，sync 也確實處理了該 merge，不是空轉。
- **AC-3**：純函式四條都用字面值期望，不是同義反覆。兩條路徑結果一致是靠「同一個函式」在結構上保證的；整合面另有 `--merge`（GitLab 格式，R-3 會紅）和 sync（既有的 `merge source_ref recovered`）兩條。remote-tracking 與自訂訊息兩條在 BASE 時函式還不存在，沒辦法取得目標行為紅燈，實作者已在 README 主動揭露這是 characterization，依 verification.md 不算缺失。
- 沒有發現刪除、弱化或略過既有測試。

## 範圍與 project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴 | 符合（`package.json`／lockfile 沒動） |
| 不改 CLI 命令名 | 符合（沒動 `src/cli/`） |
| 非侵入性 | 符合（只多一次白名單內的 `log`；V-5 PASS） |
| schema 向後相容 | 不適用（沒動 schema；fingerprint 公式不變，E-5） |
| 版控文件只用代稱 | 符合：README 用 `external-repo`、`<base>`、`<merge sha>`、`<feature-branch>`；commit 訊息沒有外部名稱。`sum_…` 是 Memoria 本機 DB 的內部 id，不是外部 sha |
| 提交格式／無 AI 署名 | 符合：`fix(repo): …`，沒有尾行 |
| 常青文件 | 不適用（沒有新命令、旗標或測試腳本，CLAUDE.md Tests 清單和 ci.yml 不用改） |
| GitNexus impact／detect_changes | README 沒記錄執行證據；reviewer 改以人工查呼叫端（見上），影響面很小。見 N-3 |

## 發現

### MUST FIX

無。

### SHOULD FIX

- **S-1 README「實作與驗證步驟」第 3 步重複兩行**：`bebc5b4:docs/issues/issue-20/README.md` 有兩條 `3. 📝 **新版發布後移除本機繞道**`，一條帶「（相依：含本修正的版本發布；不屬本 repo 交付內容）」，一條是舊的，看起來是編輯時新增了一行卻沒刪舊行。只影響文件，建議刪掉舊那行。
- **S-2 升級殘留要寫明**（E-4）：舊版 `--merge` 建的列（sourceRef null），如果 sync 從來沒處理過那個 merge，升級後再跑一次 `--merge` 會 `created: 1`，多出一個帶 sourceRef 的範圍。這不是回歸（舊版下一次 sync 也會建出同一筆），也合乎「不回溯合併」，但 README「風險」段寫的是「只影響 `--merge` 新建範圍」，沒提到「重跑舊的 `--merge` 一次會多一筆」。建議在 README 或 issue-21 的清理範圍補一句。

### NICE TO HAVE

- **N-1** `parseMergeSourceRef` 沒有錨點，所以 subject 是自訂文字、內文卻引用了 `Merge branch '…'` 的 merge 會得到非 null（E-3）。AC-3 的「自訂訊息得到空值」只驗了純自訂訊息。為了 fingerprint 穩定，維持現狀是對的；可以在函式註解補一句「刻意不錨定，因為 sync 既有範圍的 fingerprint 依賴這個行為」，避免以後有人「修正」它。
- **N-2** `test-repo-noninvasive.sh` 沒有跑 `repo summarize --merge`，新加的 git 呼叫靠 runtime 白名單和 test-repo-summary 的 `git status clean` 守著。可以在 noninvasive 流程補一次 `--merge`，增加證據持久力。
- **N-3** project.md 要求改 symbol 前跑 GitNexus impact、commit 前跑 detect_changes，README 沒留執行紀錄。這次影響面很小（見人工查核），只是流程留痕的改善。

## 判定

**PASS**：獨立審查完成，沒有 MUST FIX；AC-1～AC-3 各有可失敗的斷言，紅燈已由 reviewer 重現；fingerprint 不變性與兩種執行順序都有實測。報告目前在協調者指定的暫存位置，持久化進 repo 要另外以「只新增報告」的提交完成。
