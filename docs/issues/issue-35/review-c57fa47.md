# 審查報告
- 範圍：完整交付範圍（925d272..c57fa47）；分級 Medium、風險 Medium
- 增量覆審：上一份 review-14b4625.md，增量範圍 8b2a886..c57fa47
- Reviewed BASE SHA：925d27202317134ea8cf8d89db424be9fdf292dd
- Reviewed HEAD SHA：c57fa47c75523ecbb1bb46b3b5492501437b17bc
- Reviewed patch-id：857e17fd337831e91d2ae00f15ceef680afd29ef（`git diff 925d272 c57fa47 | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（不是原實作者，也不是上一份報告的 reviewer 對話）
- 核准基線：README `**核准 commit**` 已回填 fec4368。在 c57fa47 重跑推導命令仍得到 fec43685891593f5449b16766f4ae177951dbdb6；`git diff fec4368 c57fa47 -- docs/issues/issue-35/README.md` 的 Gherkin 劇本與核准紀錄都沒有變動，原核准仍有效。
- 增量覆審的前提：14b4625 是 c57fa47 的祖先，中間沒有 merge 提交，也沒有改寫歷史；`git merge-base main c57fa47` 仍是 925d272；8b2a886 只保存上一份報告與記帳，這次增量只處理使用者選了修正的建議（S1、N1、N2、N4、N5），所以照流程契約 2.8 的規則審查：新建議只限增量引入的問題。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
1. **`vector_hits: 0` 不再只出現在 `route_mode` 為 `keyword` 的時候**（`src/core/memoria.ts:877-880`；文件：`docs/API.md:69-70`、`docs/API.zh-TW.md:66-67`、`AGENTS.md:255`、`docs/CLI.md:60`、`docs/CLI.zh-TW.md:60`）。這是這次增量造成的。現在算數前會先扣掉被取代的記憶，但決定 `route_mode` 的是 `v.rows.length`，那時還沒扣。所以如果 helper 回的語意命中全都已經被取代，結果就是 `route_mode=vector`（有字面命中時是 `hybrid_vector`）配上 `vector_hits=0`。我用 5 則筆記、全部被取代的資料實測：`route=vector data=0 vh=0`，人讀輸出照樣印出「語意查詢有執行，沒有命中；列出的是字面查詢的結果」。這行說明本身還是對的，因為語意路由確實沒有提供任何記憶；不對的是文件，「`0` 就是 `route_mode` 顯示 `keyword` 的情況」從等價變成只有單向成立（`keyword` 一定是 0，0 不一定是 `keyword`）。要遇到這種情況，得是所有語意命中都被取代，而且沒帶 `include_superseded`，很少見。可以把這幾處改成「`route_mode` 顯示 `keyword` 時一定是 0」，或補半句說明被取代的情況。
2. **補位測試的註解與實際觀察不符，舊程式碼上的紅燈不是每次都會出現**（`scripts/test-vector-recall.sh:870-872`、`:896-902`）。註解說 top_k 5 的前 5 列最多只有 3 則筆記，所以一定會補位。但用 14b4625 的 `memoria.ts` 跑，三次裡有兩次 `vector_hits=4`，表示前 5 列有 4 則筆記。也就是說，近似搜尋下同一則筆記的兩列不一定相鄰。對新程式碼沒有影響，因為不論有沒有補位，斷言要的都是 5／4／5，我在 HEAD 跑都是綠燈。但舊程式碼只有在前 5 列不滿 5 則時才會紅燈；被取代那一段在舊程式碼上也可能剛好等於 4，我實測一次得到 4，不是計畫步驟 2 記的 5。這不影響測試的真偽，下面的變異測試證明它抓得到這次要修的兩個缺陷。可以把註解改成「至少有一對相鄰時就會補位」，計畫步驟 2 的「被取代時為 5」也可以註明是單次觀察。

## 已查核維度

### 上一份報告的建議逐項確認
- **S1（TBD-3）已修好。**
  - `runRoutes` 在 vector 模式、helper 回 ok 時帶出 `vectorRows`。有命中時是 `v.candidates.slice(0, limit)`，也就是實際交給 `rrfFuse` 的那一份；沒有命中時是 `[]`。降級與非 vector 模式是 `undefined`，欄位不出現。
  - `rows = candidates.slice(0, max(1, topK))`，所以 `v.rows` 是空的時候 `candidates` 一定也是空的，給 `[]` 正確。
  - 補位時 `route` 換成 `runRoutes(topK*2)` 的結果，`vectorRows` 就是 2 × top_k 那一份，`vector_hits` 取的是最後一輪的 `route`。
  - 計數是 `collapseNoteHits(applyMemoryAttributes(...))`：`applyMemoryAttributes` 只依 `include_superseded` 過濾，它對 durable 記憶重算 score 並重新排序，不會改變列數。`collapseNoteHits` 的結果數量和順序無關（每個指紋算一次，其他列各算一次），所以排序變了不影響計數。
  - `applyMemoryAttributes` 是 fail-open：表不存在或拋例外時原樣回傳，被取代的記憶會被算進去。`rank()` 開的是同一個資料庫，那時 `data` 也同樣不會過濾，兩邊一致。
  - 成本是 helper 回 ok 時多開一次唯讀連線、查一次屬性。vector 模式本來就要啟動 helper 行程（約 1 秒），這點成本可以忽略。
  - 補位後 `vector_hits` 最多可以到 2 × top_k，比 `data` 的上限多，這就是上一份報告建議 (a) 的定義，API 文件也寫了「算的是那一輪用的 `2 × top_k` 視窗」，不另列。
- **`toHits` 沒有改變 `rank()` 的行為。** 逐行比對過，對映的欄位和運算式與原本 `rank()` 裡的 `rawHits` 完全相同，只是搬到外層；`rank()` 改成 `applyMemoryAttributes(..., toHits(rows), ...)`，其他都沒動。下面的基準比對也證明了這一點。
- **N1（TBD-4）已修好。** `build_full_index35` 的前提檢查用 `topK:15`，和 recall 實際送給 helper 的 `5 × OVERFETCH_FACTOR` 相同。重建迴圈和斷言的強度都和原本一樣（最多重建 5 次，失敗就 `exit 1`），只是參數化，讓 SCN-002（4 列）與補位測試（10 列）共用。query 直接內插在 JSON 字串裡，兩個呼叫端傳的都是固定的英文字，沒有跳脫問題。
- **N2（TBD-5）已修好，SCN-003 仍然成立。** `recall.ts` 的提示條件加上 `hits.length === 0`。SCN-003 的情況是 0 筆，所以照樣會印；`test-cli-memory.sh:478-480` 的提示斷言在 HEAD 是綠燈。`project_known` 欄位本身沒有改。`docs/CLI.md` 本來就把這行描述成「0 筆時的原因」，不用另外改。
- **N4（TBD-7）已修好，和實作相符。** 資料庫不存在時，`memoria.ts:666-668` 回 `{ data: [], evidence: [], confidence: 0 }`，沒有 extra；adaptive skip 時回 `extra: { route_mode: 'skipped', fallback_used: false }`。兩份 API 文件新加的句子和這兩條路徑一致。
- **N5（TBD-8）已修好。** 計畫步驟 1 的證據補上了「CRITICAL 的結果與上述理由已於 2026-11-26 在對話中告知使用者」。
- **N3（TBD-6）不修**，是使用者的決定，這次增量也沒有動到相關程式。

### 測試真偽（自己重現）
- **舊程式碼的紅燈**：在 scratchpad 用 `git worktree` 檢出 c57fa47，把 `src/core/memoria.ts` 換成 14b4625 的版本後建 bundle，整支 `test-vector-recall.sh` 跑 3 次都在新的這一段失敗：「補位後 5 則都來自語意命中，vector_hits 應為 5，實際 3」一次、「實際 4」兩次。前面的段落都通過。
- **被取代那一段**：舊程式碼在補位那條斷言就會停下，跑不到被取代的斷言。所以我另外寫了一支 probe，用同一份資料（5 則筆記、兩半同文字、同樣的前提檢查），在舊程式碼與 HEAD 各跑一次：
  - 舊程式碼：refill 4、被取代 4、`--include-superseded` 4、全部被取代 4（`data` 依序是 5／4／5／0）。
  - HEAD：refill 5、被取代 4、`--include-superseded` 5、全部被取代 0。
- **變異測試**：只拿掉 `applyMemoryAttributes` 這層包裝（改成 `collapseNoteHits(toHits(route.vectorRows))`），跑 2 次，被取代那一段都是 `vh=5`、`data=4`，會被斷言抓到。推理也成立：如果沒有補位，表示前 5 列是 5 則不同的筆記，一定包含第 5 則；如果有補位，10 列的視窗也一定包含第 5 則。所以這條斷言對「沒有扣掉被取代的」這個缺陷是穩定的紅燈。
- **`build_full_index35` 抽出來合理**：它處理的是 helper 近似搜尋的不穩定（`recall-vector.ts` 不在可改範圍），被測的斷言沒有放寬。

### 「只加欄位」的承諾（抽查）
用 `git worktree` 建出 925d272 的 bundle，和 HEAD 的 bundle 一起放到 worktree 的 `dist/`（它的 `node_modules` 用 symlink 指向主工作樹，讓依賴可以解析）。用 `evidence/seed.sh` 建種子資料，`evidence/run.mjs` 各跑 24 組。刪掉 `meta.vector_hits` 與 `meta.project_known` 之後 **24/24 逐位元組相同**，BASE 的輸出完全沒有這兩個欄位。HEAD 的 vector 模式各案：有命中時 `vh=2`，沒有命中時 `vh=0`，和上一份報告記的值相同。這份種子資料沒有觸發補位，也沒有被取代的記憶，所以結果不變符合預期。

### 增量範圍內每個檔案的結論
| 檔案 | 結論 |
|---|---|
| `src/core/memoria.ts` | S1 正確，`toHits` 抽出後行為不變；邊界見上，NICE TO HAVE 1 |
| `src/core/types.ts` | 註解和新定義一致 |
| `src/cli/commands/recall.ts` | N2 正確，SCN-003 成立 |
| `scripts/test-vector-recall.sh` | 新測試在 HEAD 綠燈，抓得到這次要修的兩個缺陷；註解不精確，NICE TO HAVE 2 |
| `docs/API.md`、`docs/API.zh-TW.md` | 新定義（以 `data` 的單位計數、扣掉被取代的、補位時算 2 × top_k）和實作相符，兩種語言內容一致；N4 的句子正確；「`0` 就是 `keyword`」見 NICE TO HAVE 1 |
| `AGENTS.md`、`docs/agents/architecture.md` | 和 API 文件一致；architecture.md 寫的「the semantic rows the final pass fused — `2 × top_k` after a refill — counted like `data`」很精確 |
| `docs/issues/issue-35/implementation-plan.md` | 設計方案的修訂紀錄寫清楚了 TBD-1 → TBD-3 的過程；步驟 1、2 的證據補齊（「被取代時為 5」見 NICE TO HAVE 2） |
| `docs/issues/issue-35/README.md` | 只改了待確認事項（TBD-1 狀態欄、新增 TBD-3～8）與 Timeline 一列。狀態值都是合法值（`已解決`、`不影響本次交付`），結論、日期與去向都寫在狀態欄；TBD-6 寫了「追蹤：無」並附理由。整節沒有 `<`，每一行的行首都是 `\|`。Gherkin 與核准紀錄沒有動 |

### 受影響之處的重新查核
- `rank()` 的呼叫端（第一輪與補位那一輪）：行為不變，由基準比對與 test-utility-ranking、test-memory-attributes、test-prune 證明。
- `RecallFilter`／`MemoriaResult` 的使用者（HTTP、SDK、UI router、adapter）：只是同一個欄位的值換了算法，型別不變。test-http-api、test-ui-http、test-memory-browser、test-mcp-e2e 與三支 adapter 腳本都重跑了。
- 在 HEAD 重跑的項目（依地雷 M-4 清掉環境變數，`pnpm run build` 之後；`./cli` 用的是 HEAD 的 `dist/cli.mjs`）：`pnpm run check` 0、`node dist/cli.mjs --help` 0；test-pure-functions、test-smoke、test-cli-memory、test-memory-attributes、test-prune、test-utility-ranking、test-memory-browser、test-ui-http、test-http-api、test-mcp-e2e、test-vector-recall、test-adapter-runtime、test-claude-code-adapter、test-codex-adapter 全部 exit 0。

其餘沿用 review-14b4625.md。

### 限制
- test-antigravity-adapter、test-utility-shadow、test-bootstrap、test-setup-onboarding、test-brief-scope、test-migrations 沒有重跑，沿用實作者的紀錄。這次增量沒有動到它們依賴的程式。
- 被取代那一段在舊程式碼上的紅燈不是每次都出現（見 NICE TO HAVE 2），我改用變異測試證明這條斷言有效。
- GitNexus impact／detect_changes 沒有重跑。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
