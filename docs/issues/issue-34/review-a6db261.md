# 審查報告
- 範圍：完整交付範圍（`eb654e2..a6db261`，本 repo 不開 PR，審查後 fast-forward 進 main）
- Reviewed BASE SHA：eb654e292eb097507f3782e903be715c038545e4（= main，`git merge-base`）
- Reviewed HEAD SHA：a6db26188daac0d579e2ee51e263cd250b825b2f
- Reviewed patch-id：a2ea9c735d40b4e998865b4465376742771ad1b2（審查者以 `git diff eb654e2 a6db261 | git patch-id --stable` 重算，結果相同）
- 獨立 reviewer：Claude subagent（general-purpose），與實作者不同 context
- 核准基線：fec4368（README `**核准 commit**`）。`git diff fec4368 a6db261 -- docs/issues/issue-34/README.md` 只動到「涉及檔案」、`**核准 commit**` 的值、實作步驟的證據、新增 `## 待確認事項` 與 `**狀態**`；`## 驗收條件` 的 AC-1～3 文字、檢查方式與失敗路徑都沒有改動。

審查日期：2026-11-25

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

**S1. `需決策`：TBD-1 要讓使用者決定，而且 README 的描述低估了影響範圍** — `src/core/memoria.ts:808-816`；`docs/issues/issue-34/README.md:57`

- 現況：補滿時直接採用第二輪（2 × top-k）的整條管線結果，所以第一輪結果裡不是成對筆記的命中，可能被換掉，也可能換位置。TBD-1 把原因寫成 hybrid 的 utility 重排與 superseded。審查者另外發現，keyword 模式在沒有任何標記、也沒有 utility 時就會發生：`queryRecallFts` 先用 bm25 取 `4 × limit` 筆（`src/core/db/recall.ts:479`），再依「bm25 × 時間衰減」重排後截斷；LIKE 路徑則先依時間取 `4 × limit` 筆（`src/core/db/recall.ts:552`）。兩者都不是隨 limit 加深而保持前綴不變的排序。
- 重現（審查者實測，隔離資料根）：用 `sync` 匯入 8 筆 2024 年的舊 session（含 `aardvark zygote`）、10 筆近期 session（只含 `aardvark`），再 `remember` 一則含兩個詞的筆記。`recall "aardvark zygote" --mode keyword --top-k 3`：舊版回 `note-446b… noteev-446b… new_02`，新版回 `note-446b… new_04 new_09`。原本在結果裡的非筆記命中 `new_02` 被換掉了，不是只換位置。舊版 `--top-k 6` 本身就不含 `new_02`，所以新結果確實是「加深視窗的管線結果減去成對那筆」，和 architecture.md 寫的一致。
- 與 AC-3 的關係：AC-3 寫「不是成對筆記的命中……順序與數量和改動前相同」。有成對筆記的查詢一旦補滿，補進來的列本身就可能是非筆記命中，所以照字面 AC-3 和 AC-2 在這類查詢上無法同時成立；AC-3 核准的檢查方式（三支腳本全綠）與失敗路徑都已滿足。沒有成對筆記的查詢，審查者以舊、新建置對照，id、順序與 `route_mode` 都相同（見「相關失敗面」）。
- 待決問題：有成對筆記而觸發補滿時，非筆記命中可以換位置，甚至被換掉嗎？
  - 做法 (a)：接受現行語意，也就是「補滿後的結果 = 2 × top-k 視窗的管線結果去掉成對那筆」。把結論記進 TBD-1，並寫明 AC-3 的「改動前相同」適用於沒有成對筆記的查詢。不用改程式。
  - 做法 (b)：保留第一輪合併後的結果當前綴，只用第二輪裡還沒出現過的列補空位。這樣比較符合 AC-3 字面與 issue 標題「空出的名額由下一則補上」，但補進來的列可能比前綴分數高、結果不再依分數排序，hybrid 標籤的計算也要跟著改。要改程式、重測、重審。
  - reviewer 建議 (a)：第二輪的排序就是同一條管線在更深視窗下的結果，第一輪的順序反而受 bm25 取數視窗影響（上例的 `new_02` 和 `new_04` 分數幾乎相同，只差在誰落在 `4k` 視窗內）。不論選哪個，TBD-1 的描述都要補上「keyword 模式也會發生，而且非筆記命中可能被換掉，不只換位置」，使用者才有正確的資訊可以判斷。

**S2. `需決策`：視窗裡有 superseded 的成對筆記時，補滿後仍不足 top-k；TBD-1「superseded 的空位也會一起補上」的說法不成立** — `src/core/memoria.ts:808-816`；`docs/issues/issue-34/README.md:57`

- 機制：補滿只跑一次 2 × top-k，前提是「k 則不同的筆記最多佔 2k 列」。superseded 過濾（`rank()`，`src/core/memoria.ts:795`）在路由截斷之後才執行，`--supersedes` 又會把一則筆記的兩列一起標記，所以被取代的那則筆記仍會佔掉視窗裡的兩列。被取代的記憶通常和取代它的新記憶文字相近，排名也常相鄰，這不是罕見情境。
- 重現（審查者實測）：寫 6 則含 `ocelot` 的筆記，再寫一則 `--supersedes` 其中一則（共 6 則可見）。`recall ocelot --mode keyword --top-k 5`：新版回 4 則不同筆記（舊版 3 筆、2 則不同）；`--top-k 3` 新版回 2 則（舊版 2 筆、1 則）。結果有改善，但還有沒列出的相關筆記，正好是 AC-2 失敗路徑描述的情況。hybrid、vector（降級）模式相同。
- 範圍判斷：不足的名額來自 issue-5 的 superseded 過濾，沒有成對筆記時（例如 `--top-k 2` 第一輪就是 `[新版, 舊版]`）改動前後都只回 1 筆。要徹底補滿，就得讓沒有成對筆記的查詢也因 superseded 觸發補滿，這會改變 AC-3 要求維持不變的結果。所以這是需求邊界的問題，不是單純的實作缺陷，列 SHOULD FIX，不阻擋 PASS。
- 待決問題：AC-2 的「仍是 top-k 則不同的記憶」要不要涵蓋視窗內有 superseded 列的情況？
  - 做法 (a)：接受。把 TBD-1 的「superseded 的空位也會一起補上」改成「補滿時視窗加深，superseded 的空位可能部分補上，但不保證」，並寫明 AC-2 不處理 issue-5 過濾造成的不足。
  - 做法 (b)：只在已經觸發補滿時，第二輪的深度改用 `2 × topK + 第一輪被 superseded 過濾掉的列數`，或改成有上限的倍增迴圈（例如最多到 4 × top-k；vector 受 helper 的 3 × top-k 候選限制）。沒有成對筆記的查詢完全不受影響，AC-3 不變。要改程式、補測試、重審。
  - 做法 (c)：superseded 過濾造成的不足一律補滿，另開 issue 處理，因為這會改變沒有成對筆記的查詢。
  - reviewer 建議 (a)，另把 (c) 記為後續追蹤；(b) 只修了一半，而且多出一條只有成對筆記才會走到的分支。不論選哪個，TBD-1 的這句都要更正。

**S3. AC-1「只留排名較前的那一筆」沒有被測試鎖住** — `scripts/test-cli-memory.sh:409-422`

- 現況：AC-1 的斷言只檢查指紋出現一次。審查者做了一個變體，把 `collapseNoteHits` 改成保留排名**較後**的那筆，`test-cli-memory.sh` 仍然 exit 0。依 verification.md，這屬於證據持久力不足，不是假綠燈：AC-1 核准的檢查方式本來就只要求「這個指紋只出現一次」，紅燈也是真的。
- 審查者手動驗證現行程式碼是對的：對一則筆記的 `note-` 半邊回報 4 次 `feedback --signal explicit --score 0`，讓 `noteev-` 排到前面。keyword 模式下，新版回 `noteev-…`，舊版回 `noteev-… note-…`，變體回 `note-…`；hybrid 模式下，新版回 `note-…`（tree 列分數較高），變體回 `noteev-…`。
- 建議：在 AC-1 段加上這個 utility 情境，並斷言保留的是 `noteev-`。期望值來自舊版的排名，是獨立的真相來源。

**S4. 有成對筆記的 hybrid 查詢，`route_mode` 從 `hybrid_fallback` 變成 `hybrid_tree`，README 沒有記錄這個變化** — `src/core/memoria.ts:836-841`

- 現況：審查者實測，一則筆記、`recall platypus --mode hybrid`：舊版回 `hybrid_fallback`／`fallback_used:true`（`noteev-` 是只有 keyword 找到的列），新版回 `hybrid_tree`／`false`。依 issue-16「標籤依實際回傳的列決定」的規則，新標籤是正確的，architecture.md 與 commit 訊息也寫了「hybrid 標籤只計入實際回傳的列」。不過 README 的「最大風險」點名 `routeUtility` 依 route 分組，而步驟 3 的真實資料對照只說「沒有成對筆記的組 `route_mode` 相同」，沒有交代有成對筆記的組裡標籤變了多少。升級前後的 `hybrid_fallback`／`hybrid_tree` 比例會因此不連續。
- 建議：在步驟 3 的證據或 TBD-1 補記這項變化（建議併入 S1 一起讓使用者確認），發版時寫進 CHANGELOG，提醒解讀 routing telemetry 時以升級日為界。

### NICE TO HAVE

- **N1. 負數與小數的 `top_k`** — `src/core/memoria.ts:816`；`src/server.ts:77`。HTTP／SDK 的 `top_k` 是 `z.number()`，負數和小數都會被接受（CLI 會擋掉 ≤0 的值）。新增的 `distinct.slice(0, topK)` 會讓 `top_k:-1` 在沒有成對筆記的查詢上比舊版少一筆。審查者實測：舊版 `note old_03 old_02`，新版 `note old_03`。`top_k:2.5` 時，因為 `route.rows.length >= topK` 不成立，所以不會補滿。這是本來就沒有意義的輸入，建議另外在邊界驗證正整數，不必在本 issue 處理。
- **N2. 補滿時，hybrid 標籤會把排在截斷點後面的 superseded 列也算進去** — `src/core/memoria.ts:837-839`。`dropped` 只排除 `ranked` 裡沒回傳的列，superseded 列不在 `ranked` 裡，所以 2 × top-k 視窗內位在 k 之後的 superseded keyword-only 列，也會把標籤變成 `hybrid_fallback`。這和註解「plus superseded ones as before」的意圖一致，只是補滿時視窗變大了。情境很窄（hybrid + superseded + 成對筆記 + 補滿），影響只在 telemetry 標籤，記一筆即可。
- **N3. 筆記前綴的解析有兩份** — `src/core/memoria.ts:294` 的 `notePairOf` 和 `src/core/utils.ts:69` 的 `noteFingerprintOf` 各自解析 `note-`／`noteev-` 前綴。現在後者已經是共用函式，`notePairOf` 可以改用它推導。規模很小，目前兩者行為一致。

## 已查核維度

### 驗收與證據

審查者實際執行（HEAD a6db261 的 `pnpm run build`，全部以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 執行，地雷 M-4）：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help` 都是 exit 0；`test-cli-memory`、`test-vector-recall`、`test-utility-ranking`、`test-repo-promotion`、`test-http-api`、`test-memory-browser`、`test-ui-http`、`test-smoke`、`test-brief-scope` 都是 exit 0。

紅燈重現：在 scratchpad 用 `git archive a6db261` 建副本，再把 `src/` 換回 eb654e2 的版本後 build（腳本用新版，程式用舊版）。`test-cli-memory.sh` exit 1，`✗ mode=keyword: fingerprint ba33996087373d1a appears 2 times (want 1)`；`test-vector-recall.sh` exit 1，`--top-k 3 應回 3 則不同筆記，實際 note-68f580e02f5c2fab noteev-68f580e02f5c2fab noteev-017e900a65db44c2`。內容與 README 記載的紅燈相符（後者三筆的順序不同，但同樣是 2 則不同的筆記）。

變體測試（審查者在 scratchpad 副本修改程式碼後執行）：

| 變體 | test-cli-memory | test-vector-recall | 結論 |
|---|---|---|---|
| A：拿掉補滿（條件改成 `if (false)`） | exit 1，`--top-k 3 over 5 notes: got hits/distinct=2 2 (want 3 3)` | exit 1，`實際 note-68f5… note-017e…` | AC-2 斷言抓得到「只合併、不補滿」 |
| B：合併時保留排名較後的那筆 | exit 0 | 未跑 | AC-1 的「排名較前」沒有被測試鎖住（S3） |
| C：vector 補滿時不用 `candidates`，只用截斷後的 `v.rows` | 未跑 | exit 1，`實際 noteev-68f5… noteev-500f…` | vector 補滿確實依賴 `candidates`；計數 wrapper 會擋住重跑 helper |

| AC | 測試位置 | 證據位置 | 判定 |
|---|---|---|---|
| AC-1 | `scripts/test-cli-memory.sh:409-422`（keyword／hybrid／tree 各一次，前提先確認查詢在 `recall_fts` 會命中兩列） | README 步驟 2 紅綠；審查者重現紅燈；HEAD 綠 | 通過，附 S3。期望值是字面值 1，不是同義反覆；「兩筆都消失」時計數為 0，也會轉紅。tree 原本就只回 session 那筆，只是守門用 |
| AC-2 | `scripts/test-cli-memory.sh:424-441`（5 則時 `3 3`、2 則時 `2 2`，keyword／hybrid）；`scripts/test-vector-recall.sh` issue-34 段（vector、helper 只跑一次） | 步驟 2 紅綠；審查者重現紅燈與變體 A、C | 通過，附 S2。核准的檢查方式成立；視窗內有 superseded 成對筆記時仍會不足，屬於需求邊界問題 |
| AC-3 | `test-utility-ranking`、`test-repo-promotion`、`test-vector-recall` | 步驟 1 基準、步驟 3 回歸與真實資料對照；審查者重跑三支都是 exit 0 | 依核准的檢查方式與失敗路徑判定為通過；字面範圍見 S1 `需決策` |

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| 沒有成對筆記的查詢（`sync` 匯入的 session） | 與舊版逐筆相同，`route_mode` 也相同 | 審查者實測 `aardvark zygote` 資料根（N=12，沒有成對列進入 k=3）：舊、新版都是 `note old_11 old_10`；README 78 組真實資料對照；AC-3 三支腳本 | 通過。程式路徑上，沒有合併時 `weighted = ranked`，hybrid 的 `dropped` 是空集合，標籤輸入與舊版的 `finalRows` 相同 |
| 有成對筆記並觸發補滿 | 每則筆記一格，補到 top-k | AC-1／AC-2 測試；審查者實測 | 通過；非筆記命中可能被換掉（S1）、遇到 superseded 時不足（S2） |
| `top_k` = 1 | 一筆，不補滿 | 審查者實測 `--top-k 1` 回 1 筆 | 通過。一列之內不可能出現成對 |
| `top_k` = 2 且命中成對 | 合併後補到 2 | 程式路徑：distinct 1 < 2、rows 2 ≥ 2，以 4 補滿 | 通過 |
| `top_k` = 0、負數、小數（HTTP／SDK） | 不崩潰 | 審查者用 tsx 直接呼叫 core：0 回空集合；-1 比舊版少一筆；2.5 不補滿 | 不崩潰；無意義輸入的行為改變記為 N1 |
| `include_superseded` | 被取代的筆記也只佔一格 | 審查者實測 `--top-k 10 --include-superseded`：7 則筆記 7 筆，沒有重複指紋（keyword／hybrid／vector） | 通過 |
| superseded 成對筆記在視窗內 | 補滿 | 審查者實測 `--top-k 5` 只回 4 則（還有 2 則沒列出） | 見 S2 |
| utility 重排讓 `noteev-` 排在 `note-` 前面 | 留下 `noteev-` | 審查者實測（4 次 explicit 0 分）；變體 B 會反過來 | 行為正確；測試缺口見 S3 |
| `time_window` | 兩輪都套用同一個 `afterDate` | 程式查核（`runRoutes` 共用 `afterDate`）；審查者實測 `--time-window P1D` | 通過 |
| vector 降級（沒有 `LIBSQL_URL`） | `vector_unavailable`、`fallback_used:true`，keyword 底層照樣合併與補滿 | 審查者實測：`--mode vector --top-k 3` 回 `vector_unavailable true`，沒有重複指紋 | 通過 |
| vector ok，只有語意路由命中 | `route_mode=vector`，從同一次 helper 的 `candidates` 補滿 | `test-vector-recall.sh` 新段落、變體 C | 通過。`candidates` 上限是 3 × top-k 個名稱，比 2 × top-k 深，足夠補滿 |
| vector 第一輪 `limit = topK` | 與舊版的 `v.rows` 相同 | 程式查核：`v.rows = candidates.slice(0, max(1, topK))`，第一輪的 `candidates.slice(0, max(1, limit))` 結果相同 | 通過 |
| tree 模式 | 不受影響（tree 只回 session 列） | AC-1 tree 守門、審查者實測 | 通過 |
| hybrid 的 `route_mode`／`fallback_used` | 依實際回傳的列決定 | 程式查核；審查者實測成對筆記時從 `hybrid_fallback` 變成 `hybrid_tree` | 符合 issue-16 規則；揭露缺口見 S4，邊界見 N2 |
| `searchMemories` 以 top_k 50 呼叫（environment 模式會對每個 project 各呼叫一次） | 去重後最多 50 筆 | `test-memory-browser`、`test-ui-http` exit 0；程式查核：觸發補滿時以 100 重跑一次路由（FTS LIMIT 400），tree 本來就會載入全部節點 | 通過；成本最多加倍，而且只在有成對筆記時發生，可以接受。UI 搜尋改成一則筆記一列，是預期中的改善 |
| `fileQuery` | 寫入的頁面不重複列出同一則筆記 | 程式查核（直接使用 `recall` 的 hits）；`test-wiki-query-fileback` 由實作者在 CI 五組中跑過 | 通過 |
| telemetry 的 `hitCount`／`top_confidence` | 以合併後的 hits 計算 | 程式查核：`hits.length`、`hits[0].relevance`；合併保留第一個出現的列，所以 `hits[0]` 只會在 S1 的重排情境下改變 | 通過 |
| `routeUtility` 依 route 分組 | 標籤正確 | 同 S4 | 見 S4 |
| `setup --vector` 的探測（`verifyVectorReadiness`） | 只看 `route_mode` 與 hits 非空 | 程式查核 `src/cli/setup-plan.ts:555-572` | 不受影響 |
| UFL 回報只記到實際回傳的半邊 | 不退化 | 程式查核：`utilityFactor` 最大值是 1，只會往下調。被回傳的半邊被調低後，另一半會以原分數頂上，舊版那一半本來也會以原分數出現 | 不是退化，不列發現 |

### 需求、架構、安全、品質（含重複與過度設計）

- 需求：實作與使用者選的做法「留排名較前那筆並補滿」一致。AC-3 的字面範圍與 superseded 的邊界待使用者決定（S1、S2）。
- 架構：改動都在 `src/core/`，CLI／HTTP／SDK 共用同一條路徑。`runRoutes`／`rank` 只是把原本內聯的流程包成兩個 closure，沒有新增抽象層。`recallVector` 回傳值多了 `candidates`，唯一的呼叫端是 `recall()`。`noteFingerprintOf` 移到 `utils.ts` 後，`brief.ts` 的行為不變（`test-brief-scope` exit 0）。recall 合併時保留排名較前的那筆，brief 的 `collapseNotePairs` 則偏好 session 半邊，兩邊的策略刻意不同，各自都有註解。
- 常青文件：`docs/agents/architecture.md` 的 recall 段與程式一致（沒有成對筆記時完全相同；有成對時等於加深視窗的結果減去成對那筆；hybrid 標籤只計回傳的列加上 superseded）。`AGENTS.md` 的「freed slots are refilled」是概略的描述，遇到 superseded 時不完全成立，可以在 S2 定案後一併調整。這次的變更不涉及 project.md 對照表的其他文件（CLI 旗標、HTTP 契約都沒變）。
- 安全：沒有新的輸入面，也沒有權限或檔案系統的變更。
- 品質：沒有需要合併的重複，只有 N3 這個小重複。只補滿一次、深度 2k 是有理由的設計，不算過度設計。註解準確。
- commit 訊息：`fix(recall): 同一則筆記只佔一個名額，空出的名額由下一則補上（issue-34）`，符合 `type(scope): 中文摘要`，沒有 `Co-Authored-By` 或 AI 署名。
- issue 文件格式：`**狀態**`、`**核准 commit**`、`## 待確認事項` 的表格格式與狀態值都正確，不會讓 verify-artifact 或懸置掃描判斷錯誤。TBD-1 的描述不完整、有一句不正確（S1、S2），屬於內容問題，已列 SHOULD FIX。

### 豁免、待確認與限制

- 沒有 Gate 豁免。
- TBD-1 仍是 `待確認`。S1、S2 是兩個 `需決策` 項目，協調者應在合併前依 acceptance.md 的「逐題確認」取得答案並記入 README 的 `## 待確認事項`。如果選了要改程式的做法（S1 (b)、S2 (b)），就需要重新實作與重審。
- 限制：README 步驟 3 的真實資料對照（25 個查詞 × 3 種模式 × 2 種 k）是用維護者的資料庫做的，審查者沒有重跑（依指示不碰 `~/.memoria`），改用隔離資料根的構造案例佐證。CI 五組 32 支腳本中，審查者只重跑了上列 9 支加上 check／build，其餘沿用實作者的紀錄。local embedding 模式沒有測試（CI 也不跑），vector 只驗證了 stub provider。

## 流程判定

PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
