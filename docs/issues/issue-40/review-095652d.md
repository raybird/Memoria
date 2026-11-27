# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：3b2a32c4bba74f02cd8723fdb2b37121dcd3cc73
- Reviewed HEAD SHA：095652d78ec0193ba5055179feb136d72ef72612
- Reviewed patch-id：8b4a2771cb4ebb3068619f100eaed77e30600f06
- 獨立 reviewer：Claude Code 隔離 subagent（Claude Opus 5.5），未參與 issue-40 實作
- 核准基線：dc1f192abe58cb13329624a52702ddd2a6b98693（README 沒有 `**核准 commit**` 欄位，依 acceptance.md「規格修訂的查核」的推導命令以被審查提交為 ref 取得；`git diff dc1f192..095652d` 的 README 差異沒有動到 `## 驗收條件`，只在 `## 涉及檔案` 多列兩支測試檔，原核准有效）

## 問題與風險

MUST FIX：無

SHOULD FIX：
- S1 `scripts/test-prune.sh:202`、`CHANGELOG.md:7`：consolidate prune 的行為也變了，但沒有測試，CHANGELOG 也沒提。`loadUtilityMeans` 由 stale 與 consolidate 共用（`src/core/db/prune-export.ts:134` 的 `orderChildrenForRetention`），所以效用記在 `noteev-` 的筆記子節點，現在也會在 consolidate 時被保留。reviewer 用隔離資料根實測：同一主題下三個 `note-` 子節點，最舊那則只對 `noteev-old` 回報 explicit 0.9，BASE 留下 `n:note-new`，HEAD 留下 `n:note-old`。行為方向正確，architecture.md 也寫了 consolidate，但 repo 裡沒有測試擋回歸，CHANGELOG 的 Fixed 與升級注意只寫 recall、stale prune 與 brief。建議在 test-prune.sh 的 issue-40 段補 consolidate 斷言，並在 CHANGELOG 補一句。
- S2 `scripts/test-utility-ranking.sh:90`：AC-1 反方向（recall 留下 `noteev-`、效用只回報在 `note-`）沒有端對端測試。README AC-1 的檢查方式明寫兩個方向都要成立，(E) 段的第二個斷言測的卻是「效用記在留下的那一半」（既有行為），反方向只靠 `pure-fn-driver.mts` 證明 `mergeNoteUtility` 是對稱的。reviewer 實測反方向（把 session 時間戳調早一年讓 recall 留下 `noteev-`，再對 `note-` 回報 0）：BASE 分數比 ≈1.0，HEAD 為 0.5，行為正確。這是證據持久力的缺口，不是假綠燈。建議比照 test-cli-memory.sh 調時間戳的做法，在 (E) 補上反方向。
- S3 `docs/issues/issue-40/README.md:43` `需決策`：風險 Medium 的 Small issue 依 acceptance.md 要記 `**核准 commit**`，README 沒有這個欄位。本報告已記下推導出的基線 dc1f192，不影響這次判定。待決問題：要不要補上這個欄位。做法 (a)：把基線 dc1f192 記在 `## 待確認事項` 或 Timeline（屬記帳區段，PASS 沿用）；做法 (b)：在 `## 驗收條件` 補 `- **核准 commit**: dc1f192`，但這一節是凍結內容，補了 PASS 就失效、要重審。建議 (a)。
- S4 `docs/issues/issue-40/README.md:57`、`:60`、`:63`：紅綠重構證據的寫法不完整。完成證據只寫腳本名稱與結果摘要，沒有實際命令與 exit code，也沒有記下重構階段（code-simplify 的結果或 no-op 理由）。reviewer 已獨立重現紅燈與綠燈（見下方「驗收與證據」），所以不算缺證據，只是 issue 文件的寫法問題。之後的 issue 照 verification.md 記四段。

NICE TO HAVE：
- N1 `scripts/test-cli-memory.sh:438`：失敗訊息還寫「utility favours $HI」，但排序現在是由時間戳決定。建議改成「recency favours」。
- N2 `src/core/db/recall.ts:40-52`、`src/core/db/prune-export.ts:21-39`：兩處現在是一模一樣的四步流程（展開 pair id、查 `memory_utility`、`mergeNoteUtility`、`effectiveUtility`）。可以抽成一個共用的 `loadEffectiveUtility(db, refIds): Map<string, number>`，下次再改合併規則就不用改兩處。
- N3 `src/core/db/prune-export.ts:25`：stale prune 的 `IN (...)` 參數數量對筆記加倍。better-sqlite3 的上限實測是 32766，之前 3 萬多個候選才會失敗，現在 16384 個左右的過期筆記候選就會讓整個 `prune --stale-days` 丟出例外。既有的 `staleNodes`、`loadAttributes` 本來就沒有分批，這次只是餘裕少了一半，資料量要非常大才會碰到。可以順手分批。
- N4 `CHANGELOG.md:10`：升級注意可以多寫一個合併後的語意。一半只有 explicit、另一半只有 reuse 時，explicit 會覆蓋兩半（依 `effectiveUtility` 原有的「explicit 覆蓋 reuse」）。brief 的觀察次數這時改成只看 explicit 的次數，所以原本靠 reuse 次數上榜的那一半可能掉出高效用區塊。這和單一列的既有語意一致，只是使用者會看到變化。
- N5 `docs/issues/issue-40/README.md:51`：「完成證據：待驗收條件核准後補上。」已經過時。它在凍結章節，PASS 之後改了就要重審，留到下次修訂再改即可。

## 已查核維度

- 驗收與證據：
  - AC-1：`scripts/test-utility-ranking.sh` (E)。reviewer 把 HEAD 的測試腳本放進 BASE 的 worktree、build 之後執行，exit 1（「AC-1：效用記在 noteev-… 時，留下的 note-… 沒有被加權」）。HEAD 上 exit 0，分數 3.92e-6 → 1.96e-6，比例為 0.5。反方向由 reviewer 另外實測（S2）：BASE 比例 ≈1.0，HEAD 0.5。結論：成立。
  - AC-2：`scripts/test-prune.sh` issue-40 段，BASE exit 1（`note-keep` 與 `N_note` 都沒被豁免，對應 README 的兩項失敗），HEAD exit 0；0.2 的 `note-drop` 照舊刪除，所以「低分因合併而被保留」的失敗路徑也有覆蓋。結論：成立。
  - AC-3：`scripts/test-brief-scope.sh` (J)，BASE exit 1（「兩半各回報一次的筆記應合併成 2 次觀察、列一次」），HEAD exit 0。`grep -cF … = 1` 同時擋住「沒列出」與「列兩次」；`note-once` 只有一半、一次觀察，照舊不列。結論：成立。
  - AC-4：`git diff 3b2a32c..095652d -- src/core/db/telemetry.ts` 為空。HEAD 上 test-utility-ranking、test-prune、test-brief-scope、test-memory-attributes 都 exit 0，`pure-fn-driver.mts` 直接斷言非筆記 ref 不受影響、也不會多出 pair。部署 skill 那句效用敘述由 AC-1 兩個方向證明。結論：成立。
  - 假綠燈：pure-fn 的期望值是手算的字面值（0.9、0.2、2、0.8、0.3），不是同義反覆。AC-1 用比例判斷，不綁實作細節。
  - reviewer 在 HEAD 執行（前綴 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`）：`pnpm run check`、`pnpm run build`、`release:docs-check` 都通過；以下腳本都 exit 0：test-pure-functions、test-utility-ranking、test-prune、test-brief-scope、test-cli-memory、test-memory-attributes、test-smoke、test-migrations、test-setup-onboarding、test-http-api、test-mcp-e2e、test-memory-browser、test-ui-http、test-repo-promotion、test-adapter-runtime、test-claude-code-adapter、test-utility-shadow、test-wiki-query-fileback、test-vector-recall（第一次失敗、重跑通過，見「限制」）。
- 相關失敗面：
  - 兩半都有列：`memory_utility` 以 `ref_id` 為主鍵，每列只加一次。三個讀取點的 id 都先去重（recall、prune 用 `Set`，brief 讀整張表），沒有重複加總。pure-fn「observations add／mean unchanged」有覆蓋。
  - 只有一半有列：`mergeNoteUtility` 把合併結果放在該列的 ref 與它的 pair 底下，兩個 id 都拿得到。pure-fn 有覆蓋兩個方向，AC-1、AC-2 端對端也有覆蓋。
  - 非筆記 ref（`gitdec-`、`gitsum-`、一般 session）：`noteFingerprintOf` 回 null，key 就是自己，`notePairOf` 回空陣列，行為不變。pure-fn 與既有 gitsum/gitdec 的 brief 斷言都有覆蓋。`noteev-` 不會被 `note-` 前綴誤判。
  - 一半只有 explicit、另一半只有 reuse：合併後 explicit 次數 ≥1，所以 explicit 覆蓋兩半。這符合「同一則記憶 explicit 覆蓋 reuse」的既有語意，結論是合理（見 N4）。
  - recall：`factorById` 多出的 pair id 只在 `h.id` 查詢時用到，不在 hits 裡的 id 沒有副作用。沒有任何效用列時仍回傳原陣列；排序以原索引決定同分，是穩定的。四種模式都經過 `rank()` → `applyUtilityWeighting`（`src/core/memoria.ts:789-799`），vector 與 hybrid 一致。`vector_hits` 的計數不經過效用加權。兩半在收合前拿到相同的係數，所以留哪一半改由原始分數決定，符合 issue-34。
  - brief：收合移到觀察門檻之前。非筆記 ref 不受 `collapseNotePairs` 影響，所以 gitsum/gitdec 的合併、topK、專案範圍過濾的順序都沒變。兩半拿到相同的合併計數，收合留下 `note-`，`utility_unproven` 對一則筆記只算一次（原本兩半各一次觀察時算兩次，屬於 issue 要修的行為）。pinned／superseded 仍是逐 ref 過濾；`remember --durable`、`--supersedes` 與 `mark`（5f44111 起）都會標兩半，只有極早期只標一半的資料可能讓另一半出現在高效用區塊，風險很低，不列為問題。
  - prune：stale 經「節點 → session `note-` → pair `noteev-`」的路徑有 AC-2 斷言；consolidate 的行為變了但沒有測試（S1）；`IN` 參數加倍（N3）。
  - test-cli-memory.sh 的 issue-34 AC-1 改成以時間戳決定排序：reviewer 在 BASE worktree 對 `collapseNoteHits` 注入兩種錯誤，分別是「保留排名較後那一半」與「一律保留 session 那一半」，重新 build 後都 exit 1（「… recall returned: note-…」）。所以這個測試仍抓得到「收合留下排名較低那一半」。這次修改既有測試，是因為核准的行為改了（兩半共用效用之後，原本的操控手段失效），理由記在 README 步驟 3 與測試註解，符合 verification.md。
- 需求、架構、安全、品質（含跨 Task 重複與過度設計）：
  - 寫入端沒有改動，讀取時合併，符合 TBD-1 (b)；觀察次數與總和直接相加，符合 TBD-2。`notePairOf` 移到 `src/core/utils.ts`，與 `noteFingerprintOf`、`collapseNoteHits` 放在一起，消除了 memoria.ts 裡的私有重複。新呼叫點仍在 core 內部，`src/core/index.ts` 沒有新的公開面。
  - 沒有 schema、CLI 旗標或 HTTP 契約的變更；`MemoriaResult` 封裝不受影響。brief JSON 的 `observations`／`signal` 改為合併後的值，與 AC-3 一致。
  - 安全：沒有新的輸入面，SQL 仍用 prepared statement 的 placeholder。
  - 文件：architecture.md 的 UFL 段、OPERATIONS.md 的保留規則與 CHANGELOG 描述的行為與程式相符（consolidate 的遺漏見 S1）。`git diff 3b2a32c..095652d` 裡沒有個人絕對路徑或外部專案真名。
  - 重複與過度設計：`mergeNoteUtility` 很精簡，沒有多餘的抽象；有兩處讀取流程重複（N2）。
- 豁免、待確認與限制：
  - 沒有 Gate 豁免；TBD-1、TBD-2 已解決。S3 有一題 `需決策`。
  - 限制：`test-vector-recall.sh` 在 HEAD 第一次執行時，issue-35 SCN-006 失敗（HTTP 的 `vector_hits` 是 1，預期 2），單獨重跑 exit 0。這段 fixture 沒有任何 feedback，`memory_utility` 沒有列，`applyUtilityWeighting` 原樣回傳，和 BASE 的路徑相同，判斷是與本變更無關的時序抖動。
  - reviewer 沒有重跑 wiki 組的 ingest、build、lint，repo 組除了 promotion 以外的腳本，test-bootstrap、test-codex-adapter、test-antigravity-adapter，以及 npm-install、node18 這些 CI 工作，這幾項沿用 README 步驟 3 的紀錄。
  - BASE 紅燈與錯誤注入都在暫時的 detached worktree 進行，結束後已移除。工作分支的檔案與提交都沒動，HEAD 的 `dist/` 由 HEAD 的原始碼 build。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
