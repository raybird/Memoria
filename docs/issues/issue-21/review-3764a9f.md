# Issue 21 審查報告：dismissed 摘要狀態

- **保存位置**：`docs/issues/issue-21/review-3764a9f.md`
- **審查日期**：2026-10-20
- **Reviewed BASE SHA**：`ac76109`（ac76109 docs(issue-19～22): 回填核准紀錄的核准 commit）
- **Reviewed HEAD SHA**：`3764a9f150b7cf37a2c3ca4329a389d4f5ac7ad6`（分支 `issue-21-dismissed-summaries`，單一提交）
- **Reviewed patch-id**：`9682b44ffd5e7a1e6fa68d743373dd05c2954a2b`（`git diff ac76109 3764a9f | git patch-id --stable`）
- **獨立 reviewer**：Claude subagent（general-purpose，未參與實作）
- **判定**：`RETURN TO execute-task`（1 項 MUST FIX）

## 審查範圍與風險

- 範圍：`ac76109..3764a9f` 共 20 個檔案（+317/−27）：`src/core/{types,memoria,index}.ts`、`src/core/db/{git-summary,git-promote,brief,index}.ts`、`src/core/git/summary-schema.ts`、`src/cli/commands/repo.ts`、`src/server.ts`、`src/sdk.ts`、`scripts/{test-repo-summary.sh,test-repo-promotion.sh,pure-fn-driver.mts}`、`CLAUDE.md`、`AGENTS.md`、`README.md`、`README.zh-TW.md`、issue-21 README 與 implementation-plan。
- 規則依據：`3764a9f:docs/agents/{review-evidence,verification,acceptance,project}.md`、`3764a9f:CLAUDE.md`。
- 規格：`3764a9f:docs/issues/issue-21/README.md` SCN-001～SCN-007，核准 commit `a79d3be`，七項皆「已核准」（2026-10-20）。`git diff a79d3be 3764a9f -- docs/issues/issue-21/README.md` 只改了步驟狀態、待確認事項狀態與 Timeline，Gherkin 本身沒動，所以原核准仍然有效。
- 風險：Medium。這次動到促升閘門 `isPromotable`（GitNexus 評為 CRITICAL，實作者已揭露），改動同時影響 brief 與 HTTP 路由順序。最大風險是讀取端把 dismissed 誤當 pending 或 enriched。

## 證據（命令與結果）

所有命令都在以 `3764a9f` 建立的獨立 detached worktree 內執行，`node_modules` 以 symlink 共用。測試一律加 `env -u LIBSQL_URL -u MEMORIA_HOME`。完成後 worktree 已移除，主工作區沒有讀取也沒有修改。

| # | 命令 | 被測版本 | 結果 |
|---|------|---------|------|
| E1 | `pnpm run check` | 3764a9f | exit 0 |
| E2 | `pnpm run build`、`node dist/cli.mjs --help` | 3764a9f | exit 0、exit 0 |
| E3 | `node dist/cli.mjs repo summarize --help` | 3764a9f | 列出 `--dismiss <summaryId>`、`--dismiss-pending` 與改寫後的 `--type` 說明 |
| E4 | `bash -n scripts/test-repo-summary.sh`、`bash -n scripts/test-repo-promotion.sh` | 3764a9f | 通過 |
| E5 | `bash scripts/test-repo-summary.sh` | 3764a9f | exit 0；SCN-001～004 共 12 條 ✓，無 ✗ |
| E6 | `bash scripts/test-repo-promotion.sh` | 3764a9f | exit 0；SCN-005 5 條、SCN-006 2 條、SCN-007 7 條 ✓ |
| E7 | `bash scripts/test-pure-functions.sh` | 3764a9f | exit 0；`[pure] isPromotable` 4 條 ✓ |
| E8 | `bash scripts/test-brief-scope.sh`、`test-http-api.sh`、`test-repo-noninvasive.sh` | 3764a9f | 三支皆 exit 0，無 ✗ |
| E9 | 紅燈重現：worktree 內 `git checkout ac76109 -- src` 後重 build，再跑 E5～E7 | ac76109 的 src 加上 HEAD 的測試 | summary 與 promotion 都是 exit 1，原因是 `error: unknown option '--dismiss'`；pure 是 exit 1，`✗ dismissed merge is not: expected false, got true`、`✗ dismissed release is not: expected false, got true`。與 plan 紀錄一致 |
| E10 | 變異測試：只把 `isPromotable` 改回 `status === 'pending'`，其餘維持 HEAD，再跑 `test-repo-promotion.sh` | HEAD 但 isPromotable 用舊版 | **exit 0**，SCN-005 端到端斷言測不出閘門修正（見 S-2） |
| E11 | 在 `test-repo-summary.sh` 的副本中，於 SCN-003 批次前印出 fixture | 3764a9f | `milestones=2 ranges=4 enriched=1 promoted_before=2`；全部摘要為 `commit_range:pending ×4、merge:dismissed、release:pending ×2、release:enriched、branch:pending`。**批次執行前已經沒有 pending merge**（見 M-1） |
| E12 | 臨時探針：自建 repo，依序測 dismiss、重複 dismiss、未知 id、壞型別、跨 repo | 3764a9f | 重複 dismiss → ok、no-op；`sum_nope` → `summary_not_found`、exit 1；`--type merge,bogus` 與 `--type ' , '` → `invalid dismiss types`、exit 1；用另一個 repo 的 ref 去 dismiss → `summary_not_found`；跨 repo 批次回 0 筆 |
| E13 | 臨時探針：`--tag --promote` 打在 dismissed release 上；pending release 先強制促升再 dismiss | 3764a9f | 前者 `promoted 1`，結果 `release|dismissed|memory_sources=1`，brief 顯示「已略過: 1」；後者 dismiss 成功，結果 `dismissed|memory_sources=1`（見 S-1） |
| E14 | 臨時探針：起 server 打 HTTP 錯誤路徑 | 3764a9f | `types:"merge"` → 400；`types:[]` → 400；壞 JSON → 400；陣列 body → 400；未知 repo（批次與單筆）→ 404；未知 summary → 404；`/summaries/pending/dismiss` → 404 `summary_not_found: pending`；`types:["merge","merge"]` → 200（去重後 0 筆）；`GET /summaries/pending` → 200 |
| E15 | `git diff ac76109 3764a9f \| grep -iE '<外部真名、帳號、本機路徑樣式>'` | diff | 沒有命中 |
| E16 | `git diff ac76109 3764a9f -- package.json pnpm-lock.yaml` | diff | 0 行，依賴沒有變動 |

## 獨立盤點：`git_summaries.status` 的讀取點

我在 HEAD 對 `src/`、`skills/` 獨立 grep `git_summaries`、`'enriched'`、`'pending'`、`.status` 比較、`listSummaries`、`getSummaryById`、`isPromotable`、`promotionExists`，並逐一分類：

| 位置 | 行為 | 結論 |
|------|------|------|
| `git-promote.ts` `isPromotable` | 已改為 `!== 'enriched'` → false | 正確 |
| `memoria.ts` `promoteEligible` 補促升池 | `status:'enriched'` | 不含 dismissed，正確 |
| `memoria.ts` sync candidates | 只有新建的摘要，加上 `--from/--to` 的明確範圍 | 盤點表說 `--from/--to`「可能回傳既有的 dismissed 摘要」。但 range fingerprint 含 `summary_type`，而 `--from/--to` 一律是 `commit_range`，所以實際能帶回的只有 dismissed 的 **commit_range**，帶不回 merge 或 release。commit_range 骨架的 importance 上限是 0.85，可以 ≥ 0.7 門檻，所以這條路徑存在，修正確實必要 |
| `memoria.ts` `repoSummarize --promote` | `force` 不經閘門 | **盤點表標「不改」，但漏記了副作用**：促升後狀態仍是 dismissed，形成「dismissed 但已在 recall」（E13，見 S-1） |
| `memoria.ts` `repoPendingSummaries` | `status:'pending'` | 正確 |
| `memoria.ts` `repoSubmitSummary`、`submitAgentSummary` | 無條件設為 enriched | dismissed → enriched 可行（SCN-006） |
| `git-summary.ts` `insertSummaryIfMissing` | 既有列原樣回傳 | 重跑 sync 不會把 dismissed 改回 pending，有 E6 佐證 |
| `brief.ts` 最新摘要、待增強、已略過 | 分別以 `= 'enriched'`、`= 'pending'`、`= 'dismissed'` 篩選 | 正確；全域 totals 只算 pending，也正確 |
| `git-promote.ts` `lookupGitSources`（recall 的 git source） | 從 `memory_sources` JOIN 回 `git_summaries`，不看 status | 只有已促升的才會出現。在 S-1 的狀態下，dismissed 摘要也可能帶著 source 出現在 recall |
| `git-repo.ts` repo remove | 依 repository 刪除，不看 status | 無影響 |
| `prune-export.ts` | 刻意保留 `git_summaries`，不讀 status | 無影響 |
| `telemetry.ts`（stats）、doctor、verify、wiki-* | 不讀 `git_summaries` | 無影響 |
| `skills/memoria-memory-sync/scripts/*.mjs`（MCP bridge payload、ingest） | 只讀 `sessions`、`memory_nodes`，沒有 `git_summaries` | 無影響；dismissed 不會促升，所以不會進 sessions（S-1 例外） |
| `skills/memoria-vector` | 沒有 `git_summaries`、`enriched` 字樣 | 無影響 |
| `server.ts` 路由順序 | 批次與單筆 dismiss 都排在 `/summaries/:id` 之前 | 正確（E14 加上 plan 的紅燈） |

盤點結論：沒有漏掉會把 dismissed 誤算進「待增強」或自動促升的讀取點。漏掉的只有 `--promote` 強制路徑造成的狀態不一致（S-1）。盤點表第 3 列對可達型別的描述不精確（N-3）。

## 失敗面

| 失敗面 | 具體輸入或狀態 | 預期 | 覆蓋 | 結論 |
|--------|---------------|------|------|------|
| 對 enriched 摘要做 dismiss | 已促升的 enriched release | 非 0 結束或 409；status 與 `memory_sources` 不變 | E5 SCN-002（`promoted_before=2` 前後相等）、E6 409 | 通過 |
| 重複 dismiss | 已經是 dismissed 的摘要 | no-op、ok | 只有 E12 探針，沒有測試釘住 | 行為合理但規格沒寫（N-1） |
| 批次型別過濾 | `--type merge,release`，含 pending 的 merge、release、commit_range、branch | 只有 merge 與 release 變 dismissed | E5 只覆蓋 release 與 commit_range，**不含 pending merge**（E11） | 覆蓋缺口（M-1） |
| 批次沒給型別、空型別、壞型別 | `--dismiss-pending`、`' , '`、`merge,bogus`、HTTP `{}`、`[]`、`"merge"` | 拒絕、不改任何資料 | E5 SCN-004、E6、E12、E14 | 通過；Zod 驗證位於 core 邊界（`parseDismissTypes`），CLI 與 HTTP 共用同一規則 |
| 批次的交易性 | 多筆 pending | SELECT 與 UPDATE 在同一個 `db.transaction` 內 | 讀程式碼確認 | 通過 |
| 跨 repo 越權 | 用 repo B 的 ref dismiss repo A 的摘要 | 404 `summary_not_found` | E12 | 通過（沒有測試釘住，N-2） |
| 重新 sync 復活 dismissed | 先 dismiss 再 sync | 維持 dismissed、不促升 | E6 SCN-005 | 通過 |
| 閘門被繞過 | dismissed 的 commit_range、importance ≥ 0.7，再 `sync --from/--to` | 不促升 | 只有 E7 純函式；端到端測試對這項修正不敏感（E10） | 通過，但證據持久力不足（S-2） |
| 強制促升與 dismissed 交互 | `--tag X --promote` 打在 dismissed 上；或 pending 先 `--promote` 再 dismiss | 未定義 | E13：產生「dismissed 且已在 recall」 | 需決策（S-1） |
| HTTP 路由遮蔽 | `POST /summaries/dismiss` | 走批次路由，而不是 submit | plan 紅燈加上 E6、E14 | 通過 |
| 錯誤碼對應 | `summary_not_pending` → 409；`invalid dismiss types` → 400；`*_not_found` → 404 | 如左 | E6、E14；`gitErrorStatus` 先判 `not_found`，`summary_not_pending` 不含該字串，不會誤判 | 通過 |
| schema 相容 | 舊 DB 加新狀態 | 不需要 migration | `status TEXT NOT NULL DEFAULT 'pending'`，migration 12 與基礎 DDL 都沒有 CHECK；`idx_git_summaries_repo_status` 正好支援批次查詢 | 通過；不需 migration 的理由成立 |

## 發現

### MUST FIX

**M-1　SCN-003 的「pending merge 經批次變成 dismissed」沒有任何斷言覆蓋，實作紀錄高估了覆蓋範圍**

- 規格：Background 要求 merge、release、commit_range 各有一筆 pending。SCN-003 Then 是「只有 pending 的 merge 與 release 變為 dismissed，並回報筆數 2」。
- 實際狀態（E11）：`test-repo-summary.sh` 的 SCN-001 先把唯一一筆 pending merge dismiss 掉。輪到 SCN-003 時，pending 的里程碑是 **2 筆 release、0 筆 merge**。因此：
  - `"no pending merge/release left"` 的 merge 那一半本來就成立；
  - 「回報筆數 2」湊巧等於 2，但組成是 release ×2，不是 merge 加 release；
  - SCN-007 的 HTTP 批次只用 `["commit_range"]`。
  
  整個交付裡，批次 dismiss 從來沒有對一筆 pending merge 執行過。假設實作只套用型別清單的最後一項（只處理 release），這組斷言仍然全綠。
- implementation-plan S3 的完成證據寫「回報筆數等於事前查得的 pending merge+release 數」，沒有揭露 merge 為 0。這屬於覆蓋描述不精確，不是刻意不實；但依 review-evidence.md 的「必要驗收……覆蓋缺口」條款要退回。
- 事前查詢期望值本身不算同義反覆：它是獨立的 SQL 加上事後狀態斷言，有機會與程式碼不一致。問題出在 fixture 沒有重現 Background。
- 建議修法：在 SCN-003 前新增一筆 pending merge，例如再 merge 一個分支後 sync；或者把 SCN-001 改成使用另一筆 merge。然後斷言回報筆數為字面值 2（或是逐一列出的 id 集合），並斷言那筆 merge 的 id 變成 dismissed。也建議補上「branch 骨架不變」的斷言。從程式碼判斷（`IN (?, ?)` 參數化），行為本身大概是正確的，缺的是證據。

### SHOULD FIX

**S-1　`需決策`：`--promote` 強制路徑會產生「dismissed 但已在 recall」的狀態，與文件寫的「never promoted」矛盾**

- 輸入（E13）：
  - (a) release 先 dismiss，再 `repo summarize <repo> --tag v1.0.0 --promote`。結果 `memories_promoted=1`，狀態仍是 `dismissed`，`memory_sources=1`，brief 顯示「已略過: 1」。
  - (b) pending release 先 `--tag … --promote` 強制促升，再 `--dismiss`。dismiss 被接受，結果一樣是 dismissed 且已在 recall。`--dismiss-pending` 也會把這種列一起改掉。
- 影響：
  - CLI help（`never promoted`）、`AGENTS.md`（`never promoted`）、README 兩份（`never promoted`／`不促升`）、issue README 重構後流程（「不促升」）的描述，在這兩條路徑下不成立。
  - brief 的「已略過」會把已經在 recall 的摘要算進去。
  - `dismissSummary` 的註解把「enriched 可能已在 recall」當成拒絕理由，但強制促升過的 pending 同樣已在 recall，卻能 dismiss。SCN-002 的標題是「拒絕略過已寫進記憶的摘要」，這條路徑的精神與它相違；不過 When 只寫了 enriched，所以算不上違反已核准的 Then。
- 盤點表把 `--promote` 標成「可促升 dismissed，設計的唯一逃生口」。這是規劃時推導出的行為，沒有出現在核准原話裡（acceptance.md 要求推導出的可觀察行為須另行詢問，或標為待核准）。
- 待決問題：dismiss 與強制促升的關係要怎麼定？
  - (A) dismiss 改以 `promotionExists` 為不變量：已促升的單筆回 409，批次則跳過；強制促升 dismissed 時順便把狀態改回 pending 或 enriched，或直接拒絕。
  - (B) 維持現狀，只把文件改成「不會被自動促升（`--promote` 仍可強制）」，並承認 brief 的「已略過」可能含已促升的摘要。
- reviewer 建議 (A) 的 dismiss 守門：以 `promotionExists` 判斷，比以 status 判斷更貼近「已寫進記憶」的語意。強制促升的部分可先採 (B) 的文件修正。

**S-2　SCN-005 的端到端斷言測不出 `isPromotable` 修正，閘門只有純函式測試守著**

- E10：把 `isPromotable` 還原成舊版，`test-repo-promotion.sh` 仍然 exit 0。原因是 dismissed 的 merge 既不是新建摘要，也不在 enriched 補促升池，sync 根本不會把它送進閘門。
- 這不算假綠燈：「dismissed 不會經 sync 促升」的可觀察結果確實成立，而且純函式測試有真實的紅轉綠（E9）。問題在證據持久力：盤點表第 3 列描述的那條唯一可達路徑（dismissed 的 commit_range 加 `sync --from/--to`）沒有端到端測試。
- 建議：補一條端到端斷言。做法是 dismiss 一筆 importance ≥ 門檻的 commit_range 骨架，或調低 config 門檻，再 `repo sync --from <base> --to <head>`，斷言 `memory_sources` 為 0。

**S-3　project.md 的 GitNexus gate 證據不完整**

- implementation-plan 檢查清單的「改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes」仍是 `[ ]`。步驟 7 記錄了 impact，沒有記錄 detect_changes 的結果。
- 建議：補上 detect_changes 的結果並勾選；若沒有跑，依 docs/AGENTS.md 的 Gate 豁免紀錄留痕。

### NICE TO HAVE

- **N-1**：重複 dismiss 的 no-op 行為（ok、`updated_at` 不變）只有註解，Gherkin 與測試都沒有。建議補一條斷言，或寫進 CLAUDE.md 的三態轉移描述。
- **N-2**：跨 repo 的 `summary_not_found` 守門（E12 已驗證可用）沒有測試釘住。
- **N-3**：盤點表第 3 列可改成「只有 commit_range 型別會經 `--from/--to` 回到 candidates，因為 fingerprint 含 `summary_type`」，以免讀者誤以為 merge 也會走這條路。
- **N-4**：issue README「涉及檔案」與 plan「測試策略」表仍把 SCN-005 寫在 `test-brief-scope.sh`、SCN-007 寫在 `test-http-api.sh`；兩支實際上都沒有改，斷言都在 `test-repo-promotion.sh`。步驟敘述已說明原因（只有它有 repo fixture 與 HTTP server，而 CLAUDE.md 的 Tests 清單本來就把 `/v1/repos/*` 契約歸給它），但表格沒有同步更新。另外，project.md「HTTP 端點契約 → `scripts/test-http-api.sh`」這條責任表也與實際做法不同，建議在 plan 明記這是偏離。
- **N-5**：SCN-004 只比對 dismissed 的總數。可改為比對整份 `id:status` 快照，更貼近「沒有任何摘要被改動」。
- **N-6**：CLI 同時給 `--dismiss` 與 `--submit` 或 `--pending` 時，dismiss 會默默優先。可以考慮在旗標互斥時報錯。
- **N-7**：`docs/OPERATIONS.md` 與 project.md 的 M-2 地雷列，可以補一句「issue-20 造成的重複 pending 列可用 `--dismiss <id>` 清掉」，plan 的使用方式表已經有這個情境。

## 其他查核結論

- **依賴與 CLI 名**：沒有新增依賴（E16）；沒有改命令或子命令名稱，只在 `repo summarize` 新增兩個旗標。
- **schema**：沒有 migration 的理由成立（沒有 CHECK 約束，既有索引也可沿用）。
- **常青文件**：
  - CLAUDE.md 的 Git-Aware 段落正確描述了三態、可轉移的方向，以及「只動 pending」的理由。
  - AGENTS.md 與 README 兩份的 HTTP 表都新增了兩列，README 也新增了命令範例。
  - 「never promoted」一詞在 `--promote` 路徑下不精確，見 S-1。
- **版控文件無外部真名**：E15 沒有命中；issue 文件用的是 `external-repo` 代稱，數量資料保留。
- **SCN-006 記為特性測試**：合理。`submitAgentSummary` 本來就無條件寫 enriched，這次沒有改程式；而 dismissed 狀態在 BASE 不存在，拿不到「目標行為失敗」的紅燈。在 BASE 上的紅燈（unknown option）來自前置步驟，不是 SCN-006 本身的紅燈，plan 也照實揭露了。
- **SCN-002、SCN-007**：斷言與 Then 一一對應。409、400、封包形狀、`meta.evidence[0]`、批次筆數都有斷言。測試把讀取路徑修成 `meta.evidence` 是改正測試的讀法，不是放寬行為，判斷合理。
- **紅綠重構證據**：外迴圈紅燈（unknown option）與單元紅燈（isPromotable）都已在 E9 重現。S1 併入 S3 的單迴圈合併有寫明理由。重構 no-op 有記錄。

## 判定

`RETURN TO execute-task`

- 必修：M-1，在 SCN-003 補上 pending merge 的 fixture 與斷言。
- 建議同輪處理：S-2、S-3。
- S-1 需使用者決定 dismiss 與強制促升的關係，結論記入 README `## 待確認事項`。
