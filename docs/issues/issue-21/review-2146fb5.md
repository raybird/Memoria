# Issue 21 第三輪審查報告：dismissed 摘要狀態（第二輪 SHOULD FIX 修正後）

- **保存位置**：`docs/issues/issue-21/review-2146fb5.md`
- **審查日期**：2026-10-20
- **Reviewed BASE SHA**：`ac7610985fc07c068e284f4dc02b05c53e680576`（ac76109 docs(issue-19～22): 回填核准紀錄的核准 commit）
- **Reviewed HEAD SHA**：`2146fb5403fcfe03a56552bce6f1d44b3e98c101`（分支 `issue-21-dismissed-summaries`）
- **Reviewed patch-id**：`6181a99f796e5831778cdfbbc290c90474ebc244`（`git diff ac76109 2146fb5 | git patch-id --stable`）
- **獨立 reviewer**：Claude subagent（general-purpose，未參與實作）
- **判定**：`PASS`（無 MUST FIX；1 項 SHOULD FIX 不阻塞）

## 審查範圍與風險

- 完整範圍 `ac76109..2146fb5`：5 個提交、22 個檔案（+711/−30）。
  - `3764a9f`（實作）、`7f47d18`（只新增第一輪報告）、`1f3d692`（修正）：第二輪 `review-1f3d692.md` 判定 PASS，附 S-1、S-2 兩項 SHOULD FIX。
  - `e0a6c91`：`git diff --name-status 1f3d692 e0a6c91` 只有 `A docs/issues/issue-21/review-1f3d692.md`。
  - `2146fb5`：本輪重點。共 6 個檔案：`AGENTS.md`、`README.md`、`README.zh-TW.md`、`docs/issues/issue-21/README.md`、`docs/issues/issue-21/implementation-plan.md`、`src/cli/commands/repo.ts`。
- `src/` 的改動只有 `repo.ts` 中 `--dismiss`、`--dismiss-pending` 兩個 `.option()` 的說明字串，沒有行為變更。
- 前兩輪已通過的程式部分沿用其結論；本輪確認這些部分沒有被新提交動到，並重跑相關測試。
- 規則依據：`2146fb5:docs/agents/acceptance.md`（核准 commit、規格修訂的查核）。
- 風險：Low（本輪只改文件與 help 字串）。整體 issue 的風險仍為 Medium，與前兩輪相同。

## 證據

命令都在 `2146fb5` 的獨立 detached worktree 內執行，`node_modules` 以 symlink 共用。所有命令一律加 `env -u LIBSQL_URL -u MEMORIA_HOME`；測試與探針的 `MEMORIA_HOME` 都放在 `mktemp -d` 下。完成後 worktree 用 `worktree remove --force` 移除，移除前 `git status --porcelain` 只剩 `?? node_modules`。主工作區沒有讀取任何檔案，也沒有改動；分支 HEAD 在審查前後都是 `2146fb5`。

| # | 命令 | 被測版本 | 結果 |
|---|------|---------|------|
| E1 | `git diff --name-status e0a6c91 2146fb5` 與 `git diff e0a6c91 2146fb5 -- src` | diff | 6 個檔案。`src` 只有 `repo.ts` 的 2 行 option 說明字串改動 |
| E2 | `git diff ac76109 2146fb5 -- package.json pnpm-lock.yaml` | diff | 0 行，依賴沒有變動 |
| E3 | `pnpm run check` | 2146fb5 | exit 0 |
| E4 | `pnpm run build`；`node dist/cli.mjs --help` | 2146fb5 | 兩者皆 exit 0 |
| E5 | `node dist/cli.mjs repo summarize --help` | 2146fb5 | `--dismiss` 的說明為 `not auto-promoted (explicit --promote still can), not counted as 待增強`；`--dismiss-pending` 的說明為 `(--type required); ones already in recall are skipped` |
| E6 | `bash scripts/test-repo-summary.sh` | 2146fb5 | exit 0，55 ✓ / 0 ✗，結尾為 `[repo-summary] PASS`。與第二輪相同（含 SCN-003、SCN-008） |
| E7 | `bash scripts/test-repo-promotion.sh` | 2146fb5 | exit 0，52 ✓ / 0 ✗，結尾為 `[repo-promotion] PASS`。與第二輪相同 |
| E8 | `bash scripts/test-http-api.sh` | 2146fb5 | exit 0，結尾為 `[http] ok` |
| E9 | `bash scripts/test-smoke.sh` | 2146fb5 | exit 0，19 ✓ / 0 ✗，結尾為 `[smoke] ok` |
| E10 | 每個提交的 issue README 中 `@SCN-008` 的出現次數 | a79d3be／3764a9f／7f47d18／1f3d692／2146fb5 | 依序為 0／0／0／1／1。SCN-008 第一次出現在 `1f3d692` |
| E11 | `git diff 1f3d692 2146fb5 -- docs/issues/issue-21/README.md` | diff | 只改了 `**核准 commit**` 那一行，並新增一列 Timeline。Gherkin 區塊與核准表都沒有變動 |
| E12 | 臨時探針：pending merge 先 `--dismiss`，再 `repo sync`，再 `--submit` 一份合法 payload | 2146fb5 | dismiss 後狀態為 `dismissed`，`memory_sources=0`；sync 後仍為 0；submit 回 `promoted=true`，狀態變成 `enriched`，`memory_sources=1`（見 S-1） |
| E13 | `git diff ac76109 2146fb5` 的新增行，以 grep 搜尋本機路徑、帳號與內部網域樣式 | diff | 沒有命中 |

## 逐項核對

### 1. 第二輪 SHOULD FIX 的處理

| 第二輪項目 | 本輪修正 | 結論 |
|-----------|---------|------|
| S-1：`--promote` 例外只寫在 CLAUDE.md，plan 第 8 步描述多於實際 | 例外與批次跳過的說明補進 AGENTS.md 的單筆列、兩份 README 的兩列、CLI help 的兩個 option。plan 第 8 步刪掉「並寫明 `--promote` 是唯一可越過閘門的路徑」，另加括號更正說明 | **已修正**。第二輪建議的兩種做法這次都做了。細節見下方第 2、3 點 |
| S-2：核准 commit 沒有反映 SCN-008 的基線 | 改成 `a79d3be（SCN-001～007）；1f3d692（SCN-008，規格修訂與核准紀錄同一提交）` | **已修正**。符合 acceptance.md 的規定，見下方第 4 點 |

### 2. 各處描述是否一致、是否符合程式行為

| 位置 | 不自動促升 | `--promote` 例外 | 已在 recall：單筆 409／批次跳過 |
|------|-----------|-----------------|-------------------------------|
| CLAUDE.md（上一個提交就已寫好，這次沒動） | `isPromotable` rejects every status but `enriched` | `--promote` stays the one override…can still promote a dismissed summary | 單筆為 error；批次 skips…reports `skipped_promoted` |
| AGENTS.md | not auto-promoted | an explicit `summarize --promote` still can | `409` if enriched or already in recall；批次 skipped and counted in `skipped_promoted` |
| README.md | not auto-promoted | **only** an explicit `--promote` puts it in recall | `409` if already there；批次 skipped (`skipped_promoted`) |
| README.zh-TW.md | 不自動促升 | **只有**明確的 `--promote` 能讓它進 recall | 已在 recall 時回 `409`；批次會跳過（`skipped_promoted`） |
| CLI help | not auto-promoted | explicit --promote still can | `--dismiss-pending`: ones already in recall are skipped |

對照程式：

- `isPromotable` 只接受 `enriched`；`promoteEligible(force=true)` 會略過這道閘門。`git-summary.ts:326-328` 依序丟出 `summary_not_pending`（摘要已是 enriched）與 `summary_already_promoted`；`server.ts:204` 把兩者都對應成 409。這些在本輪範圍內都沒有改動，表中「不自動促升」「`--promote` 例外」「409／批次跳過」三欄的描述都符合程式行為（E6、E7，以及第二輪的 E15～E18）。
- 例外：兩份 README 寫「只有 `--promote`」，與 `--submit` 的路徑不符（見 S-1）。
- 兩份 README 的 409 只寫「已在 recall」，沒有寫 enriched 也會回 409。這不算寫錯，只是少寫一種情況；AGENTS.md 兩種都有寫（N-2）。

### 3. plan 的更正是否如實

- 更正後的第 8 步寫：「`1f3d692` 只有 CLAUDE.md 寫明 `--promote` 例外，其餘四處在下一個提交才補上例外與批次跳過的說明」。
- 例外的部分屬實：AGENTS.md、兩份 README、CLI help 共四處，都在 `2146fb5` 才補上。
- 批次跳過的部分有一處不精確：AGENTS.md 的批次列在 `1f3d692` 就已經寫了 `skipped_promoted`，這次補上的只有兩份 README 與 CLI help（N-1）。不影響結論。
- 原句是用括號更正，沒有直接改寫原本的完成證據，所以歷史仍然看得出來。issue README 新增的 Timeline 列也如實記錄了第二輪 PASS 與這次的修正內容。

### 4. 核准 commit 的寫法（acceptance.md）

- acceptance.md 規定：核准 commit 是「承載當次核准規格的提交」；增刪條件並重新核准後，要「更新日期、狀態、核准來源與基線提交」。
- E10 顯示 `a79d3be` 承載 SCN-001～007，`1f3d692` 是 SCN-008 第一次出現的提交，所以分項寫法的兩個 SHA 都指向正確的基線。依「規格修訂的查核」執行 `git diff 1f3d692 -- docs/issues/issue-21/README.md` 時，Gherkin 區塊沒有差異（E11）。
- 核准表仍是 SCN-001～SCN-008 共 8 列，皆為「已核准」，與現存的 Scenario 集合完全相等。
- 回填發生在合併前，不違反「合併後不為回填單獨製造提交」的規定。這次回填與文件修正放在同一個提交，所以才需要本輪重新審查，流程正確。

### 5. 先前通過的程式部分沒有被破壞

- `ac76109..2146fb5` 中，`1f3d692` 之後的 `src/` 改動只有 E1 的兩行說明字串，前兩輪審查過的 core、db、server、sdk 程式碼都沒有變動。
- 四支指定測試全部通過，✓ 數與第二輪相同（E6～E9）。依賴沒有變動（E2）。

## 發現

### MUST FIX

無。

### SHOULD FIX

**S-1　兩份 README 寫「只有 `--promote` 能讓 dismissed 摘要進 recall」，與 `--submit` 的路徑不符**

- README.md 的單筆 dismiss 列寫 `only an explicit --promote puts it in recall`，README.zh-TW.md 寫「只有明確的 `--promote` 能讓它進 recall」。
- 實際上有兩條路：
  - `--promote` 越過閘門強制促升。
  - SCN-001～007 核准來源中寫明的「dismissed 之後仍可再 `--submit` 回到 enriched」：`repoSubmitSummary` 先把摘要改成 enriched，接著就通過 `isPromotable`，自動促升。E12 實測：`promoted=true`，`memory_sources` 從 0 變成 1。
- CLAUDE.md（a later `--submit` still flips it to enriched）與 AGENTS.md、CLI help（`still can`，沒有說「只有」）都沒有這個問題，只有兩份 README 多寫了「只有」。
- 影響低：兩條路都需要使用者或 agent 明確操作，也不違反任何 Scenario。但讀者照 README 會以為 `--submit` 不會讓 dismissed 摘要進記憶。
- 建議：把「只有」拿掉，改成與 AGENTS.md 相同的寫法（例如 `an explicit --promote still can`／「明確的 `--promote` 仍可讓它進 recall」），或補上「再 `--submit` 也會」。可以和下一次必要的變更一起處理；如果另外提交，依 review-evidence.md 需要重新審查，或依 Gate 豁免留下紀錄。

### NICE TO HAVE

- **N-1**：plan 第 8 步的更正說「其餘四處在下一個提交才補上例外與批次跳過的說明」，但 AGENTS.md 的批次跳過說明在 `1f3d692` 就已存在。可以改成「例外說明補在四處，批次跳過說明補在兩份 README 與 CLI help」。
- **N-2**：兩份 README 的單筆列只寫「已在 recall 時回 `409`」，沒有寫 enriched 也會回 409（AGENTS.md 有）。可以補成「enriched 或已在 recall 時回 `409`」。
- **N-3**：第二輪的 N-1～N-4 仍維持原狀。其中 N-2 是指再次 dismiss「dismissed 但已在 recall」的摘要時，實際行為與「Re-dismissing is a no-op」的描述不一致；N-3 是指 HTTP 409 與 `skipped_promoted` 沒有測試釘住。這些都不阻塞。

## 判定

`PASS`

- 第二輪的 S-1、S-2 都已修正：例外與批次跳過的說明補進 AGENTS.md、兩份 README 與 CLI help；plan 如實更正，也保留了原本的描述；核准 commit 改為分項寫法，兩個基線都可以用 git 驗證（E10、E11）。
- 最新提交沒有行為變更（E1），check、build 與四支指定測試全部通過（E3～E9）。SCN-001～SCN-008 的狀態維持已核准，對應的測試證據與第二輪一致。
- S-1 是兩份 README 的一處措辭寫得過頭，不影響程式行為，也不構成驗收缺口，可以和下一次必要的變更一起修正。
