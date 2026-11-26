# 審查報告
- 範圍：完整交付範圍（第一次審查，不是增量覆審）；分級 Medium、風險 Medium
- Reviewed BASE SHA：925d27202317134ea8cf8d89db424be9fdf292dd
- Reviewed HEAD SHA：14b4625a95e612646395027e6f46fbd03b9b711b
- Reviewed patch-id：87ad51486b3202158080ed5a6c911556ae9b0a25（`git diff 925d272 14b4625 | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（不是原實作者）
- 核准基線：fec43685891593f5449b16766f4ae177951dbdb6。推導命令：`git log -1 --format=%H -G '^[[:space:]]*([-*+][[:space:]]+)?\*\*核准來源\*\*[[:space:]]*(:|：)' 14b4625 -- docs/issues/issue-35/README.md`。`git diff fec4368 14b4625 -- docs/issues/issue-35/README.md` 只有新增 `## 待確認事項`、一列 Timeline 與 `**狀態**` 改成「實作中」，Gherkin 劇本與核准紀錄都沒動，原核准仍有效。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
1. **`vector_hits` 在 issue-34 補位時少算，和文件寫的定義對不起來**（`src/core/memoria.ts:909`；文件：`docs/API.md:65`、`docs/API.zh-TW.md:64`、`AGENTS.md:254`）。`需決策`
   - 現象：這個值算的是 `collapseNoteHits(vectorOutcome.rows)`，而 `rows` 是 helper 結果切到 top_k **列**之後的結果（`recallVector` 回 `candidates.slice(0, topK)`）。補位那一輪改用 `v.candidates.slice(0, 2×topK)`，所以語意路由實際送進結果的筆記可能比 `vector_hits` 多。實測：5 則筆記、每則有兩列相鄰的向量，`--mode vector --top-k 5` 連跑 3 次都是 `route_mode=vector`，`data` 有 5 則筆記（全部只靠語意命中），但 `vector_hits=3`。API.md 寫的是「語意路由在融合前找到幾則記憶（…算法和 `data` 相同）」，這裡就和輸出矛盾。另一個比較少見的情況：語意命中的記憶已經被取代時，`vector_hits` 會算到它，`data` 不會。
   - 影響：最主要的用途「0 和非 0」不受影響。`rows` 是空的，`candidates` 一定也是空的，所以 `vector_hits===0` 剛好就是 `route_mode` 顯示 `keyword` 的情況，SCN-001、SCN-002 都對。但這是新的公開欄位，發版後再改定義就是改契約。
   - 待決問題：`vector_hits` 要表示什麼？
     - (a)（建議）表示最後一輪路由實際用到的語意候選有幾則筆記：讓 `runRoutes` 帶出 `collapseNoteHits(vectorRows).length`，或改算 `v.candidates.slice(0, limit)`。這樣只靠語意命中的筆數永遠不會超過 `vector_hits`，大約多 3 行。
     - (b) 維持現在的值，把文件改成「helper 前 top_k 列裡有幾則筆記；補位時可能比 `data` 裡的語意命中少」。
     - 不論選哪個，TBD-1 的結論都要一起改寫。TBD-1 是實作時自己決定的單位，使用者沒有核准過。

### NICE TO HAVE
1. **SCN-002 的前提檢查和 recall 實際送給 helper 的 k 不一樣**（`scripts/test-vector-recall.sh:795-803`）。前提檢查用 `topK:5` 問 helper，recall 實際送的是 `topK × OVERFETCH_FACTOR = 15`。我重建索引 20 次，有 1 次是 k=5 只回 2 列、k=15 回滿 4 列。換句話說，前提檢查比實際條件嚴格，只會多重建幾次，不會掩蓋缺陷。改成用 `topK:15` 會更貼近實際的失敗原因。重建迴圈本身合理：它處理的是 helper（DiskANN 近似搜尋）的不穩定，`recall-vector.ts` 本來就在範圍外，被測的斷言（`vector_hits===2`、`data.length===2`）也沒有放寬。
2. **`project_known` 在 tree 路由的極端情況可能和命中矛盾**（`src/core/db/recall.ts:425-428`、`src/cli/commands/recall.ts:65-67`）。tree 路由過濾的是 `memory_nodes.project`，它在建索引時取 `trim(sessions.project) || 'default'`。舊 DB 的 `sessions.project` 是 NULL 時，`--project default --mode hybrid` 可能有 tree 命中，但 `projectHasMemories('default')` 是 false，人讀輸出會一邊列出命中、一邊說「這個 project 沒有任何記憶」。目前寫入路徑都會補 `'default'`，也沒有任何地方改寫 `sessions.project`，所以實際上幾乎遇不到。可以考慮只在 `hits.length === 0` 時印這行提示，或把程式註解的「same rule as the routes」改成只指 keyword 與 vector 路由。
3. **提示「已登記的名稱見 `memoria repo list`」只涵蓋已登記的 repository**（`src/cli/commands/recall.ts:66`）。用 `remember --project X` 寫入、不屬於任何 repository 的環境類 project 不會出現在 `repo list`，打錯這種名稱時，照提示去查也找不到。這是 SCN-003 核准過的寫法，所以只記下來；以後可以考慮讓提示也指向能列出所有 project 的命令。
4. **兩條早退路徑沒有新欄位，文件也沒寫**：資料庫不存在時，以及觸發 adaptive skip（`route_mode:"skipped"`）時，都沒有 `project_known`、`vector_hits`。後者已經由 `route_mode` 說明原因，行為可以接受；API.md「各自只在適用時出現」可以補半句，提到這兩種情況。
5. **計畫步驟 1 的完成判準寫了「HIGH／CRITICAL 已告知使用者」**，證據裡只記了 impact 結果是 CRITICAL，沒有寫什麼時候告知了使用者。這是寫法上的缺口，不影響判定。

## 已查核維度

### 驗收與證據
- **基準比對（README「首要驗證」與計畫步驟 1、6）**：我自己重跑一次。在 scratchpad 用 `git worktree` 檢出 925d272 並建出 bundle，再把它和 HEAD 的 bundle 都放到 repo 的 `dist/`。用 `evidence/seed.sh` 建種子資料，`evidence/run.mjs` 對兩份 bundle 各跑 24 組查詢（keyword、hybrid、vector 三種模式各 8 組）。刪掉 `meta.vector_hits` 與 `meta.project_known` 之後，**24/24 逐位元組相同**；BASE 的輸出裡完全沒有這兩個欄位。兩次執行的 `recall_telemetry`（`route_mode, fallback_used, hit_count, top_confidence`）md5 也相同（`7fa5f189…`），可見 telemetry 與 routeUtility 的分組沒有變。新欄位的值逐案看過：vector 模式有命中時 `vh=2`，沒有命中時 `vh=0` 且 `route=keyword`；非 vector 模式沒有 `vh`；`--project beta` 時 `pk=false`，`alpha` 時 `pk=true`；沒帶 project 時沒有 `pk`。結論：只加了欄位，承諾成立。
- **SCN-001**：`scripts/test-vector-recall.sh` 斷言 `route_mode=keyword`、`fallback_used=false`、`vector_hits=0`，也斷言人讀輸出的說明行。fixture 的 0 筆來自 project 過濾（helper 回 ok，但對映後是空的），和「helper 沒有回任何命中」走的是同一個分支（`v.rows.length === 0`）。結論：成立。
- **SCN-002**：同一支腳本斷言 `vector_hits=2`、`route_mode=vector`、`data=2`；keyword、hybrid、tree 三種模式與降級（`vector_unavailable`）時都沒有這個欄位。結論：成立。定義上的邊界見 SHOULD FIX 1。
- **SCN-003、SCN-004**：`scripts/test-cli-memory.sh` 對 keyword 與 hybrid 斷言 `project_known=false`，對有記憶的 project 斷言 `true`，沒帶 project 時沒有欄位，人讀提示也有斷言。紅燈我自己重現了：拿 HEAD 的測試腳本配 BASE 的 bundle，結果是「mode=keyword project_known 應為 false，實際 undefined」。結論：成立。
- **SCN-005**：test-cli-memory 逐行比對「是否標示」和 `relevance<0.3`，也斷言人讀行數等於 `--json` 的筆數；只有語意命中、印 `n/a` 的那一行不標，斷言在 test-vector-recall。紅燈我自己重現了：同一份 fixture 用 BASE 的 bundle 跑，印出 `[0.250]` 沒有標示，HEAD 印出 `[0.250 弱命中]`。說明：這份 fixture 的第 3 筆在 BASE 和 HEAD 都會在 `session 0.25` 與 `decision 0.5` 之間跳動，這是改動前就有的不確定性；斷言是逐筆依實際 relevance 判斷，第 2 筆固定是 0.25，所以這不影響測試的真偽。`--json` 不變由上面的基準比對證明。結論：成立。
- **SCN-006**：`project_known` 在 `test-http-api.sh` 比對 HTTP 與 CLI（true／false／沒有欄位），紅燈我自己重現了（「HTTP project=http project_known 應為 true，實際 undefined」）。`vector_hits` 在 `test-vector-recall.sh` 起 server 比對 0 筆與 2 筆兩種情況。斷言放在這支腳本的理由成立：`.github/workflows/ci.yml` 的 http-mcp 組依序跑 memory-browser → ui-http → http-api → mcp-e2e → vector-recall，helper 的 `@libsql/client` 是 `test-vector-recall.sh:45-46` 才 `npm install` 到 `skills/memoria-vector/node_modules`，CI 是乾淨的 checkout，test-http-api 執行時還沒有 helper 依賴。結論：成立。
- **我在 HEAD 重跑的項目**（依地雷 M-4 清掉環境變數，`pnpm run build` 之後）：`pnpm run check` 0；test-pure-functions、test-smoke、test-cli-memory、test-memory-attributes、test-utility-ranking、test-memory-browser、test-ui-http、test-http-api、test-mcp-e2e、test-vector-recall 全部 exit 0。adapters 組與 core 組的其他腳本沒有重跑，沿用實作者的紀錄。

### 相關失敗面
| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| vector 模式，helper 回 ok 但對映後 0 列 | `route_mode=keyword`、`vector_hits=0`，印說明行 | SCN-001 測試 | 通過 |
| vector 模式降級（沒有 LIBSQL_URL） | 沒有 `vector_hits` | test-vector-recall 降級斷言 | 通過 |
| vector 模式觸發 issue-34 補位（成對筆記多於 top_k 列） | `vector_hits` 不少於語意送進結果的筆記數 | 沒有測試；我實測 data=5、vh=3 | 見 SHOULD FIX 1 |
| `projectHasMemories` 拋例外 | 不放欄位，recall 照常回傳 | 程式有 try/catch（`memoria.ts:871-875`），沒有測試 | 可接受（寫法和 lookupGitSources 的 fail-open 相同） |
| project 是空字串、只有空白、大小寫不同 | 和路由規則一致 | 空字串時 `if (filter.project)` 與 `buildScopeClause` 一樣視為沒帶；其他情況兩邊都是完全比對 | 一致 |
| tree 路由與舊 DB 的 NULL project | `project_known` 不和命中矛盾 | 沒有 | NICE TO HAVE 2 |
| 資料庫不存在、adaptive skip | 沒有欄位 | 沒有 | 可接受，NICE TO HAVE 4 |
| 效能 | 多一次有索引的查詢 | `idx_sessions_project_timestamp(project, timestamp)` 的第一欄就是 project，`LIMIT 1`；多開一個 readonly 連線，和既有 enrichment 的作法相同 | 可接受 |
| 人讀輸出的解析者 | 不破壞既有格式 | 用 grep 搜過 skills、scripts、docs，沒有人解析 `- [x.xxx]`；說明行以 `- 語意…`／`- 這個…` 開頭，和命中行的 `- [` 可以區分 | 通過 |

### 需求、架構、安全、品質
- **需求**：三種情況都處理了，`route_mode` 沒有新增值，符合 issue-18 的決定。`confidence`、`confidence_basis`、`fallback_used`、命中順序與 telemetry 都沒動（基準比對與 telemetry md5 證明）。
- **架構**：判定邏輯在 `src/core/db/recall.ts`，由 `db/index.ts` barrel 匯出，`memoria.ts` 組 meta，CLI 只負責呈現；HTTP 與 SDK 透過共用的 `MemoriaResult` 型別自動帶出欄位。`recall-vector.ts` 沒有動，符合 README 的「不可觸及」。
- **型別**：`types.ts` 加了兩個選用欄位，和既有的 recall 專用欄位（`route_mode`、`recall_id`）寫在同一處，作法一致。
- **安全**：只讀 DB，使用 prepared statement；人讀提示原樣印出使用者輸入的 `--project`，只輸出到終端，沒有注入面。
- **公開 repo**：diff 新增的行裡沒有個人路徑或外部專案的真名。
- **文件**：CLI.md 與 CLI.zh-TW.md、API.md 與 API.zh-TW.md、AGENTS.md、architecture.md、CHANGELOG [Unreleased] 都和實作一致，只有 `vector_hits` 的定義在補位時不精確（SHOULD FIX 1）；architecture.md 寫的「distinct memories in `recallVector().rows`」是精確的。各文件的最後驗證日期都改成 2026-11-26。
- **重複與過度設計**：沒有。新增的程式約 20 行，門檻是同檔的常數，沒有多餘的抽象。測試在三支腳本各寫各的 fixture，屬於隔離資料根的常見作法，可以接受。

### 豁免、待確認與限制
- 沒有 Gate 豁免。
- TBD-1 已解決，是實作時決定的單位，Gherkin 文字沒有改，可以接受；但這項決定和 SHOULD FIX 1 有關，建議一起交給使用者決定。
- TBD-2 的寫法合理（不影響本次交付、沒有追蹤項目），重建迴圈的評估見 NICE TO HAVE 1。
- README `**狀態**` 是「實作中」，還沒有 `## 現況`，兩者都屬記帳區段，可以在保存報告的提交一起更新。
- 限制：GitNexus impact／detect_changes 沒有重跑，沿用計畫的紀錄；SCN-001、SCN-002 的紅燈沒有在 BASE 重跑整支 test-vector-recall，改以基準比對證明 BASE 的輸出完全沒有 `vector_hits`，斷言在 BASE 必定失敗；adapters 組沒有重跑。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
