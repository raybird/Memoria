# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：6a1b490a391756a1b9805e61d8ef76cd028da82f
- Reviewed HEAD SHA：28ec168c6abd71f864823d14556d9346db67cba5
- Reviewed patch-id：d91e8f16c35573ea1e52daff6426382a18d8f06e
- 獨立 reviewer：Claude Code 隔離 subagent（由協調者另外啟動，沒有參與 issue-42 的實作），2026-11-27 第一次審查

## 問題與風險

- MUST FIX：`src/core/db/recall.ts:184`～`:226`（`buildMemoryIndex` 用 session 第一個 `DecisionMade` 當 topic 標題）、`src/core/db/git-promote.ts:220`～`:223`、`scripts/test-repo-promotion.sh:442`。**被取代的 decision 是第一筆時，tree index 和向量 payload 還留著它的舊文字，doctor 也看不出缺口**，正好落在 AC-3 的失敗路徑。`buildMemoryIndex` 取 session 的事件時依 `timestamp ASC` 排序，第一個 `DecisionMade` 的文字成為 topic 節點（level 1）的 `title`，查詢時沒有排除已取代的事件。原本的 decision 0 會比重送時新增的事件早，所以重送拿掉 decision 0，或改了它的文字（這就是最常見的「更正第一個 decision」），`dropSessionFromIndex` 加上 `buildMemoryIndex` 重建後，topic 標題仍是那筆已取代的 decision。我在隔離資料根重現過：先用 `[採用 zebrawrong 方案, 保留 B]` 促升，再重送 `[保留 B]`。結果是 `updated`，`gitdec-…-0` 標成已取代，但 `memory_nodes` 的 topic 節點 title 還是「採用 zebrawrong 方案」。`recall zebrawrong --mode tree` 仍命中 `gitsum-…`，`reasoning_path` 是 `["demo","採用 zebrawrong 方案"]`；bridge payload 也產出 `mem_node:node:topic:…`，name 就是這段舊文字。`vector-ingest.mjs:50` 會把 name 一起 embed，`recall-vector.ts:357` 把 mem_node 命中對回 session，所以語意召回也會被已取代的內容帶到這筆 session。`stats` 的 `memoryIndex.missing` 是 0。現有測試保留的是 decision 0（A），而且 `:442` 只查 session 節點，沒有查 topic 節點，所以抓不到。建議：`buildMemoryIndex` 選 topic 用的事件時排除 `memory_attributes.superseded_by` 不為 NULL 的列（舊 DB 沒有這張表時要防護）。這個函式會影響 issue-5 筆記的取代，也影響每一次 index 重建，先跑 impact。另外補一段測試：拿掉或改寫 decision 0 後，斷言 topic 節點 title 不含舊文字，tree recall 用舊文字查不到這筆 session。如果使用者認為 topic 標題可以留舊文字，就要修訂 AC-3 並重新核准，這是另一條路，不建議。
- MUST FIX `需決策`：`docs/issues/issue-42/README.md:73`（TBD-4）。實作者的處理本身是對的，見「已查核維度」。問題在狀態欄：寫成 `已解決`，結論卻是「結論待使用者確認」，兩者互相矛盾。dev-cycle 讀到 `已解決` 就不會向使用者確認，也就是 review-evidence.md 列為 MUST FIX 的「待確認事項狀態寫錯」。待決問題：AC-4 失敗路徑「既有測試的斷言需要改值才能通過」，是否排除 AC-1 明文要反轉的那一條 issue-41 斷言？可選：(a) 使用者確認排除，把答案記在 TBD-4，狀態維持 `已解決`，不改規格；(b) 修改 AC-4 的措辭，把受影響的條件標成 `待重新核准`；(c) 得到答案前先把狀態改回 `待確認`。建議 (a)。這只動記帳區段，可以和保存報告、回填核准 commit 併在同一個提交。
- SHOULD FIX：`src/core/db/git-promote.ts:165`。`updatePromotedSummary` 用的是 deferred 交易，第一個陳述式是 SELECT，之後才 UPDATE 或 INSERT。資料庫是 rollback journal（沒有設定 WAL）。另一個程序持有 RESERVED lock 時，從 SHARED 升級的那一方為了避免死結，SQLite 會直接回 SQLITE_BUSY，不走 5 秒的 busy timeout，結果就是寫回得到假的 `failed`。2026-11-27 的實際用法就是多個 agent 平行寫回，這條比 `promoteSummary`（第一個陳述式就是寫入）容易撞到。資料會整筆 rollback，不會毀損，重送就能恢復。建議比照 `git-sync-lease.ts:57` 改成 `.immediate()`。
- NICE TO HAVE：`src/core/db/memory-attributes.ts:61`～`:77`。「已被手動 `remember --supersedes` 取代的 decision，重送時不覆寫、也不解除」沒有直接的測試。我做了變異測試：拿掉 `WHERE memory_attributes.superseded_by IS NULL` 之後，測試在 `:160`（相同內容重送應為 `already_promoted`）失敗，所以有被抓到，但只是透過 idempotency 間接抓到。建議補一段：先用 `remember --supersedes gitdec-…` 撤下一筆，重送不含它的 payload，再重送含它的 payload，兩次 `superseded_by` 都應該維持指向那則筆記的 session。
- NICE TO HAVE：`src/core/memoria.ts:1312`～`:1335`。新增的 `reindexPromotedSession` 插在 issue-7 的 JSDoc 和 `indexPromotedSession` 中間，兩段 JSDoc 疊在一起，那段 issue-7 的說明現在掛在錯的方法上。建議把新方法移到 `indexPromotedSession` 後面。
- NICE TO HAVE：`src/core/memoria.ts:1476` 的註解「a resubmit or the next sync retries promotion」，對更新失敗已經不成立（sync 不會重試更新）。`src/core/types.ts:835` 的 `SummaryPromotion` 說明沒有提到 `updated`。
- NICE TO HAVE：`src/core/memoria.ts:1327`～`:1334`。拿掉節點和重建是兩個交易。重建失敗時 session 沒有任何節點來源，`stats` 會顯示缺口（這部分有寫進文件）。但 `prune --stale`（`src/core/db/prune-export.ts:240`～`:245`）會把超過 180 天、沒有節點的 session 連同全部事件刪掉，而 promoted session 的 `timestamp` 是第一次促升的時間。機率很低，但後果是整筆 git 記憶消失，包括已取代 decision 的資料列。可以考慮讓重建和拿掉在同一個交易內完成，或者至少在 architecture.md 記下這個交互作用。
- NICE TO HAVE：`src/core/db/git-promote.ts:162`、`:169`。`summary.range` 為 null 時，就算沒有新 decision、不需要 range 也直接拋錯，回 `failed`。另外 session 已被 prune 或手動刪掉時回 `already_promoted`，CLI 印「先前已進入 recall，這次沒有更動」，但 recall 裡其實已經沒有這筆。這兩種情況都罕見，對使用者的說法可以更精確。

## 已查核維度

- 驗收與證據：
  - SHA 與 patch-id 已核對：`git merge-base HEAD main` 是 `6a1b490…`，patch-id 相符。
  - 規格修訂：依 acceptance.md 執行 `git diff fec7d1b 28ec168 -- docs/issues/issue-42/README.md`。驗收條件 AC-1～4 與核准來源沒有改動。差異只有涉及檔案新增「可改」列、回填核准 commit、完成證據、步驟勾選、TBD-4、Timeline 與狀態，都沒有改變條件、動作或結果，原核准有效。`fec7d1b` 是 BASE 的祖先。
  - 紅燈：開暫時 worktree 檢出 BASE `6a1b490` 並 build，用 HEAD 的 `scripts/test-repo-promotion.sh` 做成斷言失敗不中止的副本（第 47 行 `exit 1` 改成 `return 0`），以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash` 執行。結果正好 18 項失敗，全是 issue-42 斷言：`already_promoted`、session 舊文字、recall 新舊文字、A 的理由、B 沒有標記且仍在 recall 與 brief、C 不存在、tree 節點、向量沒有重新 embed。數量與形態和 README 步驟 1 相符，跑完已移除 worktree。
  - 綠燈：HEAD 上 `pnpm run check`、`pnpm run build` exit 0，`node dist/cli.mjs --help` 正常。`test-repo-promotion.sh` exit 0（109 個 ✓）。`test-repo-summary`、`test-vector-recall`、`test-brief-scope`、`test-memory-attributes`、`test-prune`、`test-repo-sync`、`test-smoke` 都 exit 0。結束時已在 HEAD 重新 `pnpm run build`。
  - AC-1、AC-2 在測試情境下確實成立。AC-3 對 session 節點、FTS 和向量的 session 與 decision 列成立，對 topic 節點不成立，見 MUST FIX 1。AC-4 的測試與雙語文件成立，TBD-4 見 MUST FIX 2。
- 相關失敗面：
  - 文字比對：兩邊都 trim、區分大小寫。重複文字靠 `matched` 集合一對一配對，多出來的同文字 decision 會新增一筆。只差空白時沿用原 id，原本存的 decision 文字不改寫，可以接受。
  - `nextSeq`：取這個 session 現有事件的最大序號加 1。prune 只會整個 session 刪除（`prune-export.ts:279`），不會單獨刪事件；session 不存在時整個更新直接跳過，所以「被 prune 掉的序號被重用」的情況不存在。其他 session 用同前綴 id 的事件，會在 INSERT 時撞 PK、整筆 rollback、回 `failed`，不會靜默覆蓋。
  - 理由更新用 `{...existing.content, rationale}`，保留 `impact_level` 等欄位。`event_count` 改成目前列出的 decision 數，和 `promoteSummary` 的語意一致。
  - 標記：`markSupersededBy` 只在 `superseded_by IS NULL` 時寫入，`clearSupersededBy` 只清除指向本摘要 session 的標記，所以手動 `--supersedes` 的更正不會被重送覆蓋，和 issue-5/17「標記的人說了算」一致。`superseded_by` 指向 session id，也是 `remember --supersedes` 原本的寫法（`memoria.ts:575`）。UI 的「查看取代它的記憶」接受 session id，沒有讀者會誤解。`memory_attributes` 由 `repoSubmitSummary` 開頭的 `init()` migration 建立，舊 DB 不會缺表。
  - 被取代的 decision：recall 的 keyword、tree、hybrid、vector 都經過 `applyMemoryAttributes` 過濾（`memoria.ts:797`、`:876`），brief 的三個區段排除，export 與 utility 列保留，prune 是以 session 為單位，不受影響。漏掉的是 topic 標題這條間接路徑，見 MUST FIX 1。
  - tree index：`dropSessionFromIndex` 依 level 由深到淺刪除，共用的 topic 與 root 會保留，FK 沒有開啟，不會有約束問題。prune consolidate 拿掉 session 節點之後，topic 的來源列還在。更新會把 session 節點重建回來，因為內容已經變了，這樣合理。
  - 失敗路徑：更新在單一交易內，失敗時 recall 保持舊內容並回 `failed`。CLI 提示「重送同一份內容會再試」是正確的：交易 rollback 後 session 仍是舊文字，重送會再比對出差異。sync 不重試更新的事 DEPLOYED_REFERENCE 已經寫明，只有程式註解過時（NICE TO HAVE）。並行寫回的假 `failed` 見 SHOULD FIX。
  - 變異測試：拿掉「只標記 NULL」的條件，測試會失敗，見 NICE TO HAVE。CI repo 組在 ubuntu runner 上有 node 與 npm，`npm install --omit=dev` 和 http-mcp 組的 `test-vector-recall.sh` 做法相同，可行，代價是 repo 組多一個網路依賴和安裝時間。
- 需求、架構、安全、品質（含跨 Task 重複與過度設計）：
  - 實作範圍和涉及檔案相符，`promoteSummary` 只抽出兩個純函式，SQL 與流程不變。
  - `insertDecision` 和 `promoteSummary` 的 INSERT 各寫一次：後者用 `INSERT OR IGNORE`、依位置編號，前者是一定要成功的新增。兩邊共用會影響資料格式的 `decisionEventContent` 與 `memorySourceId`，這是合理的取捨，不算重複。沒有看到過度設計。
  - 文件：CLI、API 雙語、AGENTS.md HTTP 表、architecture.md、DEPLOYED_SKILL 和 DEPLOYED_REFERENCE、CHANGELOG（Fixed 與 Compatibility）彼此一致。變更檔案裡沒有個人絕對路徑或外部專案真名，README 用 downstream-b 代稱。
- 豁免、待確認與限制：
  - 沒有 Gate 豁免。TBD-4 見 MUST FIX 2。實作者把 issue-41 那條斷言改成 `updated`，另補一次相同內容重送、期望 `already_promoted`。這符合 verification.md「核准的行為已變更」可以修改測試契約的條件，也記了真實理由：AC-1 的失敗路徑明文把「仍是 `already_promoted`」列為失敗。所以處理正確，只差使用者確認 AC-4 的適用範圍。
  - 限制：沒有跑 wiki、adapters 組和 `test-npm-install.sh`，這部分引用 README 步驟 4 的紀錄，這些組沒有碰到促升路徑。並行 SQLITE_BUSY 是依 SQLite 鎖定語意推論的，沒有實際重現。向量部分只用 stub provider，沒有驗證真實模型。
  - README 還沒有 `## 現況` 與 `**現行 review**`。流程契約 2.8 要求由保存本報告的提交在 `## 概述` 之後建立。

## 流程判定
RETURN TO execute-task
