# 審查報告
- 範圍：完整交付範圍（issue-36，分級 Small、風險 Low，只改文件；1 個提交、5 個檔）
- Reviewed BASE SHA：53e93bea1d58f4debedcaff326ba02f349feff9d
- Reviewed HEAD SHA：88b341cf5d9e2802a0ac8442a8ef8d5cd9fd8679
- Reviewed patch-id：8ebb7861d18f38c1144e9f643599c919ad8afce0（`git diff 53e93be..88b341c | git patch-id --stable`）
- 獨立 reviewer：Claude Code 獨立 subagent（非實作者），2026-11-26

`main` 與 HEAD 的 merge-base 為 Reviewed BASE；審查時工作樹乾淨。README 沒有 `**核准 commit**`：Small + Low 不需要（acceptance.md「規格修訂的查核」），所以不推導核准基線。

## 問題與風險

- **SHOULD FIX `需決策`**：`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:68`（以及 CHANGELOG.md:11 的同一說法）。AC-3 要求測試用的 recall「不標 `--used`」，但 CLI 的 `--used` 不影響任何東西：`src/cli/commands/feedback.ts:41` 是 `used: options.used ?? true`，沒帶旗標時也當成 true；`src/core/db/telemetry.ts:99-101` 只在沒有 `utility_score` 時才用 `used` 推算分數，而 CLI 一定會傳分數（`--score` 預設 `'1'`，feedback.ts:23）；`recall_telemetry` 也沒有 used 欄位。實測（隔離資料根）：兩次 recall 各用 `--score 0.4 --hits <同一 id>` 回報，一次帶 `--used`、一次不帶，`recall_telemetry` 兩列同為 `0.4|explicit`，`memory_utility` 累加兩次、結果相同。所以「不標 `--used`」寫出了一個程式沒有的區別，既有的 `:68` 前一句「`--score 0` without `--used`」也一樣。文字本身照核准的 AC-3 寫，不會造成錯誤寫入，不擋 PASS。待決問題：要不要處理這個 no-op？可選做法：(a) 文件維持原樣，另開 issue 讓 CLI 沒帶 `--used` 時傳 `used:false`（或拿掉這個旗標），這是行為變更；(b) 改寫 skill，只說照命中品質給 `--score`、不提 `--used`。這屬於改寫已核准的 AC-3 措辭，要重新核准並重新審查；(c) 接受現況，記入待確認事項。建議 (a)：AC-3 的用意（讓測試查詢的回報一致）已經達到，`--used` 的語意留給另一個 issue 決定。
- **NICE TO HAVE**：`DEPLOYED_SKILL.md:53`。命中欄位列了 `id`、`type`、`project`、`timestamp`、`snippet`，沒提 `score`。實際 `--json` 在 keyword 模式下是 `"score": 2.2278430715011485e-06, "relevance": 1`，vector 融合後約 0.016～0.033。只看 JSON 的 agent 可能把 `score` 當成分數，誤判為「幾乎沒命中」，這正是本 issue 要避免的誤讀。建議在該 bullet 補半句「`score` only orders the hits」，`docs/CLI.md` 已經這樣寫。
- **NICE TO HAVE**：`DEPLOYED_SKILL.md:53-56`。「只靠語意索引找到 → 沒有 `relevance`」出現三次（:53 bullet、:54 confidence、:56 的 `[ n/a ]` 段）。可以把 :56 併進 :53 的 bullet（例如 "…except one the semantic index alone found; the listing prints that one as `[ n/a ]`: no lexical score, not a low score."），讓定義只放在一處（writing-rules「單一真相來源」與共置）。
- **NICE TO HAVE**：`docs/CLI.md:62`、`docs/CLI.zh-TW.md:62`。(1)「each has `id`, `type`, `project`, `timestamp`, `snippet` and `score`」漏了每筆都有的 `session_id`；只在部分情況出現的除了 `source`、`verify`，還有 `node_id`、`reasoning_path`（tree／hybrid）與 `retention`、`superseded_by`。建議補 `session_id`，並把「`source` and `verify` appear when they apply」改成泛稱，例如「other fields such as `source` and `verify` appear when they apply」。(2)「`score` … is not on a 0–1 scale」：實測值都落在 0～1 之間（2e-06、0.016），這句的意思應該是「不是 0–1 的品質分數」。建議改成「is not a 0–1 match quality」，中文版「不是 0–1 的分數」可以照改成「不是 0–1 的比對品質」。
- **NICE TO HAVE（可不處理）**：`docs/issues/issue-36/README.md` 的 `## 涉及檔案` 沒列 `CHANGELOG.md`。這是例行更新、影響很小；這一節是凍結內容，現在改會讓 PASS 失效，建議不改。

MUST FIX：無。

## 已查核維度

- **驗收與證據**
  - AC-1：符合。我用隔離資料根（scratchpad 內 `mktemp -d`，`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS`；`dist/cli.mjs` 的建置時間晚於最後一次 src 提交）跑 `./cli remember …` 與 `./cli recall "pnpm lockfile" --project Demo --json`。頂層鍵是 `data`／`meta`／`ok`，`data` 是 list；每筆有 `id`、`type`、`project`、`timestamp`、`snippet`、`score`、`session_id`、`relevance`；`meta` 有 `recall_id`、`route_mode`、`confidence`、`confidence_basis`。tree、hybrid（`hybrid_tree`）、vector（`vector_unavailable`）三個模式的形狀相同，tree／hybrid 多了 `node_id`、`reasoning_path`。skill :51-54 的欄位名稱與位置和這些輸出一致。人讀輸出的最後一行是 `- recall_id: rt_…`（`src/cli/commands/recall.ts:95`），和 :51 的描述一致。
  - AC-2：符合。我用 stub embedder 在隔離資料根做了一筆語意單獨命中：`vector-ingest.mjs` 把 session C 索引成和查詢相符的文字，再跑 `recall "quantum flux capacitor" --mode vector --project vec`。人讀輸出是 `[ n/a ] session | vec | …`，對應的 JSON 那筆沒有 `relevance`，字面命中那筆有 `"relevance": 1`，`route_mode: hybrid_vector`。skill :56、CLI.md:60、CLI.zh-TW.md:60 寫的「沒有字面分數，不代表分數低」和 `recall.ts:71-76` 的註解（"prints as unmeasured instead"）一致。README 已註明行號從 57-63 移到 71-76，我核對過屬實。
  - 「`relevance` 除了語意單獨命中以外每筆都有」：屬實，包含 tree／hybrid。keyword 路由兩條路徑都設 `relevance`（`src/core/db/recall.ts:493`、`:602`），tree 路由設 `relevance: scoreNode(...)`（`recall.ts:368`），hybrid 只合併這兩者；vector 路由的型別是 `relevance?: never`（`src/core/recall-vector.ts:34`）。`rrfFuse` 依 lists 順序 `[keywordRaw, vectorRows]` 保留第一次看到的 row 物件，兩路都命中時留的是帶 `relevance` 的字面 row。`applyMemoryAttributes` 與 `applyUtilityWeighting` 只 spread 或改 `score`，不會去掉 `relevance`。`toHits` 用 `Number.isFinite` 過濾，字面路由的值都是有限數（`tokenCoverage`、`scoreNode` 在 tokens 為空時回 0）。
  - 「top 命中只來自語意索引時，`confidence` 為 `null`、basis 為 `unavailable`」：和 `src/core/memoria.ts:869-872` 一致，`scripts/test-vector-recall.sh:239-259` 也有斷言。我沒有另外做出 top 為語意命中的實例，這部分靠程式與既有測試。
  - AC-3：措辭符合，收尾判準 :70 原樣保留。實際效果見上方 SHOULD FIX。
  - AC-4：符合。開頭 :18 寫明主機記憶是另一份，照下列時機 recall；recall 段 :49 寫明預期沒有結果、或主機記憶看似已涵蓋時照樣執行，沒有結果就回報 `--score 0`。兩處都是正面表述。
  - AC-5：符合，我在 HEAD 重跑了全部檢查。`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/test-bootstrap.sh` → exit 0、`[bootstrap] ok`；`test-setup-onboarding.sh` → exit 0、`[setup-onboarding] ok`；`test-npm-install.sh` → exit 0、`[npm-install] ok`。三份 log 的 `✗` 都是 0 個。`node scripts/check-deployed-skill-sync.mjs` → `deployed_skill_check=ok version=1.39.0`；`pnpm run release:docs-check` → `Release doc sync check passed for v1.39.0`；用 grep 找禁用字串（`./cli`、`bash skills/`、`node skills/`、`git clone`），在 DEPLOYED_SKILL.md 中都沒有出現。
  - README 的完成證據寫了命令、結果與日期，算是純文件任務的等價證據（verification.md「不改變可觀察行為的任務」）。實作者的證據 (b) 用維護者資料根，無法在公開環境重現；我用 stub embedder 取得了等價的獨立重現。
- **相關失敗面**
  - 各路由的 `relevance` 有無：keyword、tree、hybrid、vector_unavailable、hybrid_vector 都實跑過，結果和文件一致。
  - 沒有 `recall_id` 的情況：adaptive skip 只在沒有 `mode` 時生效（`memoria.ts:1606`），skill 一律帶 `--mode vector`，所以不會遇到；telemetry 寫入失敗時沒有 `recall_id`，人讀輸出也不印（recall.ts:95 有判斷）。文件說「印在最後一行」，在有 `recall_id` 時成立，不構成誤導。
  - feedback 沒帶 `--used`：實測和帶 `--used` 的結果相同，見 SHOULD FIX。
  - 部署一致性：`test-setup-onboarding.sh` 以 `cmp` 比對各 host 的 SKILL.md 與範本，結果相同；版本 frontmatter 仍是 1.39.0，和 `package.json` 一致。
  - 與其他文件是否矛盾：`DEPLOYED_REFERENCE.md:63`、`docs/INTEGRATIONS.md:44`（`meta.recall_id`）和新內容一致，沒有矛盾。
- **需求、架構、安全、品質**：只改文件，不涉及架構、安全與權限。新增段落都有對應的失敗分支（9 個下游 session 中，5 個解析錯誤、3 個以主機記憶取代 recall），需要的分支都會讀到，放在 in-file 合理，措辭精簡、正面表述。重複只有上方 NICE TO HAVE 那一處，沒有分歧到造成矛盾。CHANGELOG 把 `### Changed` 放在 Added 與 Fixed 之間，順序正確。提交訊息格式是 `docs(issue-36): …`，沒有 AI 署名。
- **公開 repo 規則**：diff 裡沒有 `/home/`、`/Users/` 這類個人絕對路徑，也沒有外部專案的真名（我用本機已知的下游專案名逐一 grep，沒有命中）。「Claude auto-memory」是產品名，不是外部專案。
- **流程文件格式**：Small 的 `## 驗收條件` 有 AC 編號、檢查方式、核准日期與來源；三個步驟都標 ✅ 並附證據；Timeline 有補列；`**狀態**: 實作中` 對應審查前的狀態。README 還沒有 `## 現況`（流程契約 2.8 ≥ 2.5）：保存本報告的提交要依 document-types.md 在 `## 概述` 之後建立 `## 現況`，寫 `**現行 review**：review-88b341c.md`，同時更新 `**狀態**`。`**風險**: Low\` 行尾的反斜線換行在 BASE 就有，不在本次範圍。
- **豁免、待確認與限制**：沒有豁免。上方 `需決策` 項要由協調者依 acceptance.md「逐題確認」取得答案，記入 README `## 待確認事項`；這件事決定前，`**狀態**` 不能寫成 `已完成`（還有待決定的建議）。限制：「top 命中為語意單獨命中」只核對了程式與既有測試，沒有另外構造實例；真實 local embedder 的輸出沒有重跑（實作者的證據 (b) 有這一份）。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
