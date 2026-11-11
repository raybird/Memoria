# 審查報告
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main），第三輪；前兩輪為 review-5657988、review-4e78e45
- Reviewed BASE SHA：c35df0bac4429bdf003f1781fd8687ac99ec8c74（`git merge-base main HEAD`）
- Reviewed HEAD SHA：95eeb7c0335ad933b7594785167cf6eaf44461bf
- Reviewed patch-id：8029d2b8d0f1d6fefa3d269cbc590633510a346f（`git diff c35df0b 95eeb7c | git patch-id --stable`，審查時重算一致）
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-32/review-95eeb7c.md
- 核准基線：95eeb7c0335ad933b7594785167cf6eaf44461bf。README 的 `**核准 commit**` 是 `待提交`，依 acceptance.md §規格修訂的查核，以 `git log -1 --format=%H -G '^[[:space:]]*([-*+][[:space:]]+)?\*\*核准來源\*\*[[:space:]]*(:|：)' 95eeb7c -- docs/issues/issue-32/README.md` 推導，輸出就是被審查提交本身。符合 pattern 的提交只有兩個：ccc4b7a（原規格）與 95eeb7c（併入 2026-11-11 修訂來源）。保存本報告的記帳提交可把 `**核准 commit**` 回填為 `95eeb7c`

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE

- **N-13 「涉及檔案」漏列 `src/core/db/index.ts`**（`docs/issues/issue-32/README.md:31-58`）。完整 diff 共 26 個檔案，只有這個檔案不在清單裡。它只在 barrel 多匯出 `normalizeVerifyCommand`、`hasVerifyDurableConflict`、`VERIFY_DURABLE_CONFLICT` 三個名稱，沒有行為。「涉及檔案」屬於凍結內容，審查後不能用記帳提交補。建議不處理，只在這裡揭露，不值得為它重審。

## 已查核維度

### 上一輪問題的處理

`git diff --stat 4e78e45 95eeb7c -- src skills package.json pnpm-lock.yaml scripts/fixtures` 沒有輸出。95eeb7c 只改了 `docs/agents/architecture.md`、issue-32 的 README 與 implementation-plan、`scripts/test-memory-attributes.sh`，另外新增第二輪報告。所以第二輪對程式行為的結論（SCN-001～012 的證據與變異測試）在目前 HEAD 仍然成立。

| 編號 | 處理 | 查核 |
|---|---|---|
| M-1 核准紀錄未展開 | README `## Gherkin 核准紀錄` 已改成核准表：SCN-005、011、012 為 2026-11-11，其他 9 個為 2026-11-10，全部 `已核准`。原本的單行摘要與獨立段落拿掉，修訂來源（S-3 選「B 加一行固定說明」→ SCN-011、N-1「擋其他換行字元」→ SCN-005、N-2「常駐區也印查證行」→ SCN-012）併進 `**核准來源**` 欄位行。`**核准 commit**` 改為 `待提交` | 成立。和第二輪建議的三步一致，也符合 acceptance.md「出現分批或修訂時展開表格」與「重新核准後更新日期、狀態、核准來源與基線提交」。基線推導見下節 |
| N-8 Unicode 格式字元 | 使用者選維持現有範圍，記為 TBD-9 | 成立。TBD-9 狀態是 `不影響本次交付`，寫了「追蹤：無」、日期，以及和交付範圍相關的具體理由（不會換行、無法偽造新的一行），符合 docs/AGENTS.md 對待確認事項的要求。SCN-005 沒有被改動 |
| N-9 前後換行被 trim | 同上，併入 TBD-9 | 成立。理由「trim 後存下的是單行值」與第二輪實測一致 |
| N-10 issue 文件沒跟上 | 關鍵差異表的 brief 列補上常駐區與固定說明；「涉及檔案」的 `db/brief.ts` 補上常駐項與固定說明，`test-memory-attributes.sh` 補上 011、012，新增 `memory-browser-driver.mts`；Timeline 把「審查 review-5657988 PASS…」移到「TBD-7 選 A…」之後，新增步驟 10 與第二輪審查那一列 | 成立。Timeline 順序現在和提交順序一致。另外還漏一個 `src/core/db/index.ts`，見 N-13 |
| N-11 note 與查證行的順序沒有測試 | (V) 的常駐項用 SQL 加上 `note='自檢：先跑查證命令'`，`grep -A2` 取三行，斷言第 2 行是常駐說明、第 3 行是查證行 | 成立。期望值是手寫的字面值，不是從實作重算的。變異測試結果見下方 m1、m3 |
| N-12 architecture.md 的措辭 | 改成「`brief` adds `截至 <date>；據以行動前先跑 <command>`, with the command in a code span」 | 成立。和 `brief.ts:396-401` 的 `verifyLine` 一致：沒有 `⟳`，沒有全形冒號，命令放在 code span 裡 |

### 驗收與證據（SCN-001～SCN-012）

規格查核：

- **核准基線**是 95eeb7c，就是被審查提交，所以 `git diff 95eeb7c 95eeb7c -- docs/issues/issue-32/README.md` 是空的，核准基線之後沒有任何 Gherkin 變動。
- **Gherkin 區塊**：`4e78e45` 與 `95eeb7c` 逐字相同（用 awk 取兩節標題之間的內容後 diff）。也就是說，95eeb7c 只改了核准紀錄，沒有改劇本。
- **`ccc4b7a` → `95eeb7c` 的 Gherkin 差異**只有三處：SCN-005 多一個 `Or`（U+2028、U+2029、U+0085、控制字元，Tab 除外），新增 SCN-011，新增 SCN-012。三處都對應 `**核准來源**` 欄位行裡 2026-11-11 的三題決策，也和 review-5657988 的 S-3 選項 B、N-1、N-2 的建議內容一致。沒有找到沒有來源的變動。
- **集合相等**：Gherkin 裡的 `@SCN-*` 與核准表的 `| SCN-* |`，排序後 diff 為空，都是 SCN-001～SCN-012。Gherkin 共 12 個 `Scenario:`。
- **追溯**：SCN-001、003、004、006、007 → 2026-11-10 的方向與 Q1～Q3；SCN-008 → project.md 本地 gate；SCN-002、005（原版）、009、010 → TBD-1「核准，提交文件」；SCN-005 的修訂、SCN-011、SCN-012 → 2026-11-11 的 N-1、S-3、N-2。使用者原話我無法直接查證，只核對了 README、TBD-1、TBD-8 與前兩輪報告是否彼此一致。

| SCN | 證據位置 | 結論 |
|---|---|---|
| SCN-001 | `test-memory-attributes.sh` (R) | 成立。src 沒變，第二輪的紅燈與變異結論仍適用；本輪 HEAD 綠燈 |
| SCN-002 | (R) `--json`、`test-http-api.sh` issue-32 段 | 成立（沿用第二輪；src 與 HTTP 測試都沒變） |
| SCN-003 | (S)、(J) golden | 成立。本輪 HEAD 綠燈；golden 沒變 |
| SCN-004 | (P) | 成立。本輪 HEAD 綠燈 |
| SCN-005（含修訂） | (Q) | 成立。本輪 HEAD 綠燈；第二輪的 m4、m5、m6b、m8 仍適用。範圍外的字元已記為 TBD-9 |
| SCN-006 | (T)、`test-http-api.sh` SCN-006 段 | 成立。本輪 HEAD 綠燈；src 沒有新增任何執行外部程序的路徑 |
| SCN-007 | `test-cli-memory.sh` (P)、(G) | 成立（沿用第二輪） |
| SCN-008 | `test-migrations.sh` | 成立（沿用第二輪；schema 沒變） |
| SCN-009 | plan 步驟 2 的手動證據；第一輪 reviewer 補測 | 成立（手動）。本輪沒動讀寫路徑 |
| SCN-010 | plan 步驟 8 的觀測紀錄 | 成立（依紀錄，我無法重跑兩個 host）。skill 本輪沒變 |
| SCN-011 | (U)、(V)、(J) | 成立。本輪 HEAD 綠燈；第二輪 m1～m3 仍適用 |
| SCN-012 | (V) | 成立，而且證據更強了。本輪新增了順序斷言，m1、m3 都紅燈（見下表） |

本輪的變異測試在 scratch 的 `git ls-files` 副本進行（`node_modules` 用 symlink；副本沒有 `dist/`，`./cli` 會走 tsx，用的是改過的原始碼）：

| 變異 | 改法（`src/core/db/brief.ts` 常駐區） | `test-memory-attributes.sh` |
|---|---|---|
| m1 | note 與查證行對調 | exit 1，`✗ 常駐說明不在主行之後`，輸出依序是主行、查證行、note。打到新加的斷言 |
| m2 | 拿掉 note 那一行 | exit 1，`✗ note 沒有被印出來`。被既有的 issue-17 斷言先攔下 |
| m3 | 拿掉常駐區的查證行 | exit 1，`✗ 常駐區的狀態類記憶沒有查證行`，第 3 行變成下一則常駐項。改用 `grep -A2` 之後，原本的覆蓋還在 |

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| 常駐項同時有 note 與 verify | 主行、note、查證行 | (V) 新斷言，m1 紅燈 | 成立（第二輪 N-11 的手動證據已改成自動化） |
| 常駐項有 verify、沒有 note | 主行、查證行 | 寫法由構造保證（兩個 `if` 各自獨立）；第二輪 (V) 測過 | 成立。(V) 現在一定帶 note，這個組合沒有自動化的斷言，但兩個 `if` 互不相依，風險低 |
| 常駐項有 note、沒有 verify | 主行、note，沒有查證行 | issue-17 既有斷言、(V) 的 `PIN_PLAIN` | 成立 |
| 審查之後的記帳提交 | 只新增本報告、`**核准 commit**` 由 `待提交` 改成 `95eeb7c`（被審查提交本身）、可改 `**狀態**` 與 Timeline | review-evidence.md 流程契約 2.4（docs/AGENTS.md:194 為 2.4） | 可沿用 PASS。核准紀錄現在已經正確，不需要再動凍結內容 |
| 核准基線推導 | 找得到、HEAD 的 README 還有符合 pattern 的欄位行 | 第 162 行符合 | 成立 |

### 需求、架構、安全、品質

- **範圍**：`git diff --stat c35df0b 95eeb7c -- src/adapter src/cli/commands/service.ts src/ui src/server.ts src/core/db/recall.ts src/core/db/prune-export.ts src/core/db/memory-browser.ts package.json pnpm-lock.yaml` 沒有輸出。沒碰 adapter、hooks、service、UI，沒有新依賴，沒有改命令名稱，schema 只有 migration 17。
- **安全**：本輪沒有程式變更；Memoria 仍然沒有任何執行查證命令的路徑（第二輪已確認 src diff 沒有 `child_process`、`spawn`、`exec`）。
- **測試真偽**：新斷言的期望值是手寫字面值，而且順序錯誤時確實會紅燈（m1），不是假綠燈。
- **文件**：architecture.md 的措辭與實作一致；`release:docs-check` 通過。本輪改的文件都沒提到外部專案的真實名稱。
- **品質**：測試只多一個 SQL 欄位和一行斷言，沒有過度設計。

### 豁免、待確認與限制

- 沒有 Gate 豁免紀錄，也不需要：M-1 已照建議修正，使用者沒有走豁免的路。
- 待確認事項：TBD-1、7、8 是 `已解決`；TBD-2～6、9 是 `不影響本次交付`，都有追蹤去向或理由；沒有 `待確認` 的項目，也沒有待核准的 Scenario。
- 限制：
  - 使用者原話無法直接查證。
  - SCN-009、SCN-010 依維護者機器上的手動證據。
  - 本輪只跑了下列命令，沒有重跑完整 CI。理由是 src 沒有變動，依 plan 步驟 10 與第二輪的紀錄。
- 我實際執行的命令（都先 `unset LIBSQL_URL MEMORIA_EMBED_PROVIDER MEMORIA_EMBED_MODEL`，`MEMORIA_HOME` 指到 scratch）：
  - 範圍與規格：`git merge-base main HEAD`、`git diff c35df0b 95eeb7c | git patch-id --stable`、上面的核准基線推導、`git diff 4e78e45 95eeb7c --stat`、Gherkin 區塊的 diff，以及集合相等的比對。
  - 靜態檢查，全部 exit 0：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`pnpm run release:docs-check`（`Release doc sync check passed for v1.37.0`）、`bash -n scripts/test-memory-attributes.sh`。
  - 測試：`bash scripts/test-memory-attributes.sh` 在 HEAD exit 0（`✓ all checks passed`，(V) 印出「常駐區的狀態類記憶依序帶常駐說明與查證行…」）；m1、m2、m3 三個變異都 exit 1。
- 審查期間：
  - 沒有讀寫 `~/.memoria`，沒有碰任何 host skill 目錄，沒有跑 `setup`，沒有用 pkill。
  - 暫存檔與變異副本都放在 scratchpad 的 `r3/`，那是我自己建立的目錄。
  - 除了本報告，沒有修改任何受版控的檔案；`dist/` 由 build 重新產生，不受版控。

## 流程判定
PASS

沒有 MUST FIX。第二輪退回的唯一原因 M-1 已依 acceptance.md 修正：核准表與現存的 12 個 Scenario 集合相等，每個 Scenario 都追得到核准來源，核准基線 95eeb7c 之後沒有 Gherkin 變動。N-8、N-9 依使用者決定記為 TBD-9，N-10、N-12 已修正，N-11 已補成會紅燈的自動化斷言。95eeb7c 沒有改 `src/`，前兩輪對程式行為的結論仍然成立。保存本報告的提交可把 `**核准 commit**` 回填為 `95eeb7c`。
