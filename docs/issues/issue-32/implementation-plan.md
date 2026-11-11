# Issue 32 實作計畫 - 狀態類記憶附查證命令

風險與首要驗證見 [README](./README.md#風險與首要驗證)，本檔不重寫那五項。

## 設計方案

### 整合邊界

能力全部落在既有的 skill 型路徑上：

```text
寫入：agent → memoria remember "<狀態>" --verify "<命令>"   （CLI，存字串）
讀取：agent → memoria recall / BRIEF.md                     （純文字與 JSON，顯示字串）
執行：agent 自己決定是否跑查證命令                            （Memoria 不經手）
指引：memoria setup 部署的 skill 說明何時寫、看到後怎麼做        （Claude Code 與 Codex 共用同一份）
```

不新增命令、不接 hooks、不裝 service、不改 `src/adapter/`。核心程式不得出現執行查證命令的路徑（SCN-006）。

### 資料

- migration 17：`memory_attributes` 加 `verify_cmd TEXT`，寫法照 migration 16（先查 `PRAGMA table_info`，沒有這欄才 `ALTER TABLE ADD COLUMN`）。舊資料庫全部為 NULL，行為與現在相同。
- `MemoryAttributePatch` 加 `verify?: string`，`MemoryAttributes` 加 `verify: string | null`。upsert 沿用 COALESCE：沒給就保留原值；重跑相同文字並給新的 `--verify` 時更新成新命令。
- 筆記的 session 與事件兩個 ref 都寫入（與 `--durable` 相同），不論 recall 回哪一個 ref 都帶得到。
- `export` 不動：它現在本來就不輸出任何標記（TBD-5）。

### 驗證與互斥（core，寫入前判定）

```diff
 rememberNote(input)
+  if input.verify 給了：trim 後為空、或含 \n／\r → 錯誤「--verify 無效」（SCN-005）
+  if input.verify 且 input.retention === 'durable' → 錯誤，提示拆成約束與快照兩則（SCN-004）
   if noteExists(sessionId)
+    既有標記為 durable 且這次給 verify → 錯誤，標記不變（SCN-004）
+    既有有 verify 且這次給 --durable → 錯誤，標記不變
     applyNoteAttributes(...)
 markMemory(ref, patch)
+  patch.retention === 'durable' 且目標（或其配對 ref）已有 verify → 錯誤（SCN-004）
```

所有檢查都在任何寫入之前，失敗時資料庫不留任何列。

### 顯示

- `RecallHit.verify?: string`：只在有值時出現。由 `applyMemoryAttributes` 附上，所以 recall 四種模式、HTTP `/v1/recall` 都會帶，不必另外接線。沒有任何查證命令時，輸出與現在逐位元相同。
- recall 人讀輸出：hit 的 snippet 之後多一行 `  ⟳ 截至 <timestamp 前 10 碼>；據以行動前先跑：<命令>`。
- brief：近期決策、環境紀律、高效用三個區塊的項目帶 `verify`。渲染時在該項之下加一行 `  - 截至 YYYY-MM-DD；據以行動前先跑 <命令>`。命令包在 code span 裡，反引號的數量比命令內最長的連續反引號多一個，命令含反引號也能正確顯示。命令永不截斷：截斷後的命令被拿去執行，比不顯示更危險。常駐約束區因為互斥不會出現查證命令。
- 日期取記憶自己的時間戳（UTC ISO 的日期部分），與 recall 已顯示的時間戳一致。
- BRIEF 正文：`- 範圍:` 那行結尾加 `｜ 產生於 <generated_at>`。第一行註解原樣保留（skill 的收尾判準仍讀第一行），`test-brief-scope.sh` 對 `^- 範圍: (all projects)` 的比對仍成立。

### skill 指引（agent 契約）

`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`：

- remember 一節加一條：當事實是別人或之後的版本會改掉的現況（已合併、已部署、安裝的版本、數量、平台設定）時，寫成「截至」的說法，並以 `--verify "<唯讀查證命令>"` 附上重新查證的命令。狀態類不可 `--durable`，要把長期約束和快照拆成兩則。
- recall 一節加一條：hit 或 brief 出現「截至…；據以行動前先跑…」時，那是快照。要把它當現況陳述或據以行動之前，先讀過命令；只有唯讀檢查才執行，並以命令結果為準，不以記憶內容為準。Memoria 不會替你執行它。

## 實作步驟

1. ✅ **步驟 1：對比基線（首要驗證，服務 SCN-008、SCN-009 與所有「與變更前相同」的斷言）**
   - 產出：在 scratch 目錄複製本機資料根（只讀來源，之後只操作副本）；一支對比腳本，用目前 HEAD 的 `./cli` 跑固定查詢，正規化時間戳、latency、recall_id 後存為基線。固定查詢包括：recall --json 查得到 durable、superseded（`--include-superseded`）與一般記憶各一組；brief --global --stdout；stats --json。腳本與基線不進版控，量測值與命令記在本步驟。
   - 相依：無。
   - 完成判準：同一 runtime 重跑兩次，正規化後 diff 為空；在副本上刻意 mark 另一則 durable 後重跑，diff 不為空（證明判準抓得到變化）。
   - 證據（2026-11-10）：
     - 快照：以 `sqlite3 -readonly ~/.memoria/.memory/sessions.db ".backup …"` 取得（不鎖寫入端），migration 最大 id 16，`memory_attributes` 54 列（durable 33、superseded 37、private 0）。
     - 腳本：`run-set.sh <cli.mjs> <label> [前置命令]`。每次都從快照重新複製一份資料根，因為 recall 會寫遙測與命中紀錄，同一份重跑會影響效用排序。執行時清掉 `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`，cwd 不在任何已註冊 repo。查詢組：5 個查詢 × keyword／tree／hybrid 的 `recall --json`、hybrid 加 `--include-superseded`、hybrid 人讀輸出；`brief --global --stdout`、`brief --global --json`；`stats --json`；`prune --stale-days 180 --dry-run`。正規化只拿掉 latency、recall_id、產生時間、隨現在時間變動的 `score` 與副本路徑；hit 順序保留，排序變化仍會出現在 diff。基線 3,270 行、189 個 hit。
     - 結果：開發版（`pnpm run build` 自 `ccc4b7a`）重跑兩次 diff 0 行；開發版與已安裝的 1.37.0 發布版 diff 0 行；對照組在副本上先執行 `mark noteev-215f4818ba2739d0 --durable` 後 diff 146 行（該則進入常駐約束區、hit 帶 `retention`），判準抓得到標記改變。
     - 限制：vector 模式不在查詢組內（需要模型與向量庫，經過的是同一個 `applyMemoryAttributes`，由 `test-vector-recall.sh` 覆蓋）；真實資料沒有 private 標記，private 由步驟 2 的 `test-migrations.sh` 合成資料覆蓋。腳本與基線在 scratch 目錄，不進版控。
2. ✅ **步驟 2：migration 17 與屬性讀寫（SCN-008、SCN-009）**
   - 產出：`schema.ts` 的 migration 17、`memory-attributes.ts` 讀寫 `verify_cmd`、型別更新。`test-migrations.sh` 補上帶 durable、superseded、private 標記的升級前資料庫，升級後標記與 recall、brief 常駐約束區、stale prune 豁免都不變。
   - 相依：步驟 1。
   - 完成判準：`test-migrations.sh`、`test-memory-attributes.sh`、`test-prune.sh` 綠；用新版開啟步驟 1 的副本（觸發 migration）再跑同一組查詢，與基線 diff 為空。SCN-009：以 1.37.0 發布版在升級後的副本與另一份未升級副本上跑 recall、brief、remember --durable、mark，兩份結果正規化後相同。
   - 證據（2026-11-10）：
     - 紅燈：`bash scripts/test-migrations.sh` exit 1，`✗ 升級後 memory_attributes 沒有 verify_cmd 欄位: ref_id,retention,sensitivity,superseded_by,note,created_at,updated_at`，原因正是缺少 migration 17。
     - 實作：`schema.ts` migration 17（`PRAGMA table_info` 後才 `ALTER TABLE … ADD COLUMN verify_cmd TEXT`）；`memory-attributes.ts` upsert 寫 `verify_cmd`（COALESCE），`loadAttributes` 讀 `verify`。readonly handle 不跑 migration，所以讀取前先用 `verifyColumnExists` 探測欄位，避免舊檔上 SELECT 失敗後 recall 走 fail-open 而把 durable 一起丟掉。
     - 綠燈：`pnpm run check` 通過；`bash scripts/test-migrations.sh` exit 0，`migration 17 已套用、標記列逐列相同，recall／brief 常駐約束／stale prune 與未降級的副本一致`。斷言另確認 prune 確有刪除（`removed_sessions` ≥ 1）且 durable 留下。dry-run 不計豁免（`removed_*` 一律回 0），所以改用真的刪再列出留下的 session。`test-memory-attributes.sh`、`test-prune.sh` exit 0。
     - 真實副本：新版開啟快照副本（升級到 17）後，查詢組與步驟 1 基線 diff 0 行。
     - SCN-009：在兩份副本上（一份先用新版升級到 17，一份維持 16），以 1.37.0 發布版執行 `remember --durable`、`mark --sensitivity private` 與整組查詢，兩份都成功；寫入的常駐約束都出現在 brief，標記都有寫入。兩份正規化後 diff 只有 1 行：這次新寫入那則筆記的時間戳（相隔 3 秒）。
     - 單迴圈合併：migration 的可觀察結果只在「既有資料庫開啟後」這一層，`test-migrations.sh` 的升級斷言同時是外迴圈與內迴圈。重構 no-op。
3. ✅ **步驟 3：寫入驗證與互斥（SCN-004、SCN-005）**
   - 產出：`rememberNote`、`markMemory` 的檢查；`remember --verify` 旗標；`test-memory-attributes.sh` 新增 SCN-004 區塊（三條失敗路徑都斷言資料庫列數與標記不變），SCN-005 的空白與多行拒絕斷言放在同一區塊。
   - 相依：步驟 2。
   - 完成判準：SCN-004 的斷言先紅後綠；被拒的命令執行前後 `memory_attributes`、`sessions`、`events` 列數相同。
   - 證據（2026-11-10）：
     - 紅燈：`bash scripts/test-memory-attributes.sh` exit 1，(P) 的第一條斷言 `error: unknown option '--verify'`。目標旗標不存在；(Q) 在同一個缺口之後，未單獨跑紅。
     - 實作：`memory-attributes.ts` 新增 `normalizeVerifyCommand`（trim 後為空或含 `\r`／`\n` 即拒）、`hasVerifyDurableConflict`（以本次 patch 疊上已存的列判定，哪一半後到都抓得到）與 `VERIFY_DURABLE_CONFLICT` 訊息。`rememberNote` 在 `init` 之前做驗證與「同時給」的檢查，相同文字重跑的標記路徑在寫入前查衝突；`markMemory` 在寫入兩半之前查衝突。`remember --verify <command>` 旗標，人讀輸出多一行 `- verify: …`。
     - 綠燈：`pnpm run check` 通過；`bash scripts/test-memory-attributes.sh` exit 0。(P)：三條寫入路徑（同時給、對 durable 筆記補 `--verify`、對狀態類筆記補 `--durable`，以及 `mark` session 半與 event 半 `--durable`）都非 0 結束，`sessions/events/memory_attributes` 列數與標記內容不變，查證命令原樣存入，狀態類不進常駐約束區。(Q)：空字串、空白、多行都非 0 結束並指出 `--verify`，沒有寫入。
     - 單迴圈合併：驗證與互斥的可觀察結果就是 CLI 結束碼與資料庫列，沒有獨立的底層失敗面。精煉：無實質可簡化處，no-op。
4. ✅ **步驟 4：recall 顯示（SCN-001、SCN-002）**
   - 產出：`applyMemoryAttributes` 附 `verify`、`RecallHit.verify`、recall 人讀輸出的查證行；`test-memory-attributes.sh` 的 SCN-001 區塊與 `recall --json` 斷言；`test-http-api.sh` 斷言 `/v1/recall` 的 hit 欄位。
   - 相依：步驟 3。
   - 完成判準：SCN-001 斷言先紅後綠，命令字串以已知字面值比對；步驟 1 的對比在零查證命令的副本上 diff 仍為空；`test-wiki-query-fileback.sh` 綠（wiki file-query 經過同一個後處理）。
   - 證據（2026-11-10）：
     - 紅燈：`test-memory-attributes.sh` exit 1，`✗ keyword: 狀態類 hit 沒有在 snippet 後顯示查證行`；`test-http-api.sh` exit 1，`state hit verify mismatch`（hit 沒有 `verify`）。兩者都是目標行為缺失。
     - 實作：`applyMemoryAttributes` 把 `superseded_by`、`verify` 接在既有欄位之後附上，沒有查證命令的 hit 形狀不變；`RecallHit.verify`；recall 人讀輸出在 snippet 之後印 `  ⟳ 截至 <timestamp 前 10 碼>；據以行動前先跑：<命令>`。
     - 綠燈：`pnpm run check` 通過；`test-memory-attributes.sh` exit 0，(R) 在 keyword／tree／hybrid 三種模式下，狀態類 hit 的查證行都緊接在 snippet 之後，`--json` 的 `verify` 等於寫入的字面值，一般 hit 兩者皆無；`test-http-api.sh` exit 0，`/v1/recall` 同樣成立；`test-wiki-query-fileback.sh` exit 0。
     - 真實副本：查詢組與步驟 1 基線 diff 0 行（零查證命令時 recall 的 JSON 與人讀輸出都不變）。
     - 單迴圈合併：hit 欄位與人讀輸出都在 CLI／HTTP 層觀察，`applyMemoryAttributes` 沒有獨立於這兩層的失敗面。vector 模式經過同一個後處理，由步驟 9 的 `test-vector-recall.sh` 回歸。精煉：no-op。
5. ✅ **步驟 5：brief 顯示與可見產生時間（SCN-003、SCN-007，以及 SCN-002 的 /v1/brief 部分）**
   - 產出：`brief.ts` 的資料項與渲染；`brief-zero-marker.golden.md` 只多 `｜ 產生於 <TS>`；`test-cli-memory.sh` (G) 的穩定性比對同時排除可見的產生時間（依 SCN-007 已核准的行為變更修改測試契約）；SCN-003 的區塊放在 `test-memory-attributes.sh`，SCN-007 的放在 `test-cli-memory.sh`。
   - 相依：步驟 4。
   - 完成判準：golden 的 diff 只有產生時間那一處（在 PR 證據附上 golden 的 `git diff`）；SCN-003 含反引號的命令能完整顯示；步驟 1 的 brief 對比正規化後只差產生時間。
   - 證據（2026-11-10）：
     - 紅燈：`test-memory-attributes.sh` exit 1，`✗ 近期決策沒有完整的查證行`（期望 ``  - 截至 2026-11-10；據以行動前先跑 `` echo `git rev-parse HEAD` `` ``）；`test-cli-memory.sh` exit 1，`✗ 正文沒有顯示與註解相同的產生時間 2026-11-10T10:10:13.987Z`。兩者都是目標行為缺失。
     - 實作：`BriefDecision.verify`、`BriefMemory.verify`／`verify_as_of`（只在狀態類出現）；`queryBrief` 對列出的 ref 查一次屬性，近期決策、環境紀律、高效用都附上；`resolveRefTexts` 多帶 timestamp，供高效用項取截至日期；`renderBrief` 的 `verifyLine` 依命令內最長的反引號決定分隔長度，命令以反引號開頭或結尾時兩側補空白，命令不截斷；`- 範圍:` 那行結尾加 `｜ 產生於 <generated_at>`，第一行註解不變。
     - 測試契約修改（依已核准的 SCN-007）：`scripts/fixtures/brief-zero-marker.golden.md` 只改一行，`- 範圍: (all projects) ｜ 近 30 天` → `- 範圍: (all projects) ｜ 近 30 天 ｜ 產生於 <TS>`（`git diff --stat`：1 insertion、1 deletion）；`test-cli-memory.sh` (G) 的穩定性比對另外遮掉正文的產生時間，「兩次執行內容相同」的斷言本身不變。
     - 綠燈：`pnpm run check` 通過；`test-memory-attributes.sh` exit 0，(S) 近期決策、高效用、環境紀律（scoped brief，已註冊 repo + 環境類記憶）三處的查證行都與手寫字面值逐字相同，含反引號的命令完整，一般決策沒有查證行，`brief --json` 的決策項與高效用項帶 `verify`（高效用另帶 `verify_as_of`），(J) 零標記 golden 通過；`test-cli-memory.sh` exit 0，(P) 正文的產生時間與第一行註解相同、註解格式不變；`test-brief-scope.sh` exit 0；`test-http-api.sh` exit 0，`/v1/brief` 的 markdown 含查證行、資料項帶 `verify`，一般決策沒有。
     - 真實副本：與步驟 1 基線 diff 只有 1 行，`brief.md` 的 `- 範圍:` 行多了 `｜ 產生於 <TS>`。
     - 單迴圈合併：brief 的資料與渲染都在 CLI／HTTP 輸出層觀察，`queryBrief` 是純讀取、沒有獨立失敗面。
     - 精煉（步驟 9 前的複查）：高效用項的截至日期原本另外呼叫一次 `resolveRefTexts` 取得，改為沿用 push 當下 `found` 已帶的 timestamp，少一次查詢。修改後重跑的證據見步驟 9（完整 CI 與真實副本對比都在修改後執行）。
6. ✅ **步驟 6：Memoria 不執行查證命令（SCN-006）**
   - 產出：`test-memory-attributes.sh` 的 CLI 區塊與 `test-http-api.sh` 的 HTTP 區塊，查證命令都是 `touch <暫存目錄>/ran`。
   - 相依：步驟 5。
   - 完成判準：所有列出的命令與端點跑完後，`ran` 不存在。反向自檢：對照組在測試裡直接用 `sh -c` 執行同一字串，`ran` 會出現，證明命令本身有效、斷言抓得到「真的被執行」的情況。
   - 證據（2026-11-10）：
     - 無紅燈：SCN-006 是不變式，變更前的程式本來就不會執行它，沒有失敗基線可取。斷言的有效性由對照組證明：兩支測試都先用 `sh -c` 執行同一字串，確認檔案會被建出，刪掉後才開始。
     - CLI：`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER bash scripts/test-memory-attributes.sh` exit 0，(T) 依序跑過寫入、recall（keyword／tree／hybrid，人讀與 `--json`）、`brief`（寫檔、`--stdout`、`--json`）、`doctor`、`stats`、`mark --sensitivity private`、相同文字重跑 `remember --verify`，之後檔案都不存在。
     - HTTP：`test-http-api.sh` exit 0，`/v1/recall` 三種模式與 `/v1/brief`（scoped 與全域）之後檔案不存在。
     - 靜態：`git diff --name-only main -- src` 列出的 8 個變更檔都沒有 `child_process`、`execSync`、`spawn(`、`execFile`。
7. ✅ **步驟 7：skill 指引與常青文件**
   - 產出：`DEPLOYED_SKILL.md` 兩條指引；`docs/CLI.md`、`docs/CLI.zh-TW.md`（`remember --verify`、互斥、recall 顯示）；`docs/API.md`、`docs/API.zh-TW.md`（hit 與 brief 資料項的 `verify`）；`docs/agents/architecture.md` 標記表加一列；`docs/OPERATIONS.md`（migration 17）；`AGENTS.md` 的 no-server path 範例加一行 `--verify`。
   - 相依：步驟 6。
   - 完成判準：`test-npm-install.sh`、`test-setup-onboarding.sh` 綠（部署出去的 skill 帶新指引）；中英文 CLI／API 文件旗標一致。
   - 證據（2026-11-10）：
     - `DEPLOYED_SKILL.md`：recall 段加「讀到 `截至 <日期>；據以行動前先跑 <命令>` 時，先讀命令、只跑唯讀檢查、以輸出為準，Memoria 不會替你跑」，完成判準加「依賴的快照都已用命令重查」；remember 段加 `--verify` 一條（何時用、以今天為準描述、不能 `--durable`、長期約束與快照拆兩則）。
     - 常青文件：`docs/CLI.md`／`CLI.zh-TW.md`（命令範例、狀態類記憶段落含互斥與 `mark` 的情況、範圍行的產生時間）；`docs/API.md`／`API.zh-TW.md`（hit 的 `verify`、brief 決策項 `verify`、高效用項 `verify`＋`verify_as_of`、markdown 查證行、伺服器不執行）；`docs/agents/architecture.md` 標記表加 `verify_cmd` 一列（標記數改為四）；`docs/OPERATIONS.md`（範例、標記表、狀態類記憶與 migration 17 兩條營運說明、BRIEF 正文產生時間）；`AGENTS.md` no-server 範例加一行。各檔的 Last verified／最後驗證改為 2026-11-10。
     - 一致性：中英文 CLI 文件都有 `--verify` 範例與「不能與 `--durable` 並用」；中英文 API 文件都列出 `verify` 與 `verify_as_of`。
     - 檢查：`pnpm run release:docs-check` 通過；`pnpm run build` 後 `test-setup-onboarding.sh` exit 0（Step 6 以 `cmp -s` 比對部署出去的 `SKILL.md` 與範本相同，新指引隨之部署）；`test-npm-install.sh` exit 0（打包後安裝的 skill launcher 可執行）。兩者都以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER` 執行，隔離 HOME，不碰本機 host 的 skill 連結。
8. ✅ **步驟 8：兩種 agent 的手動觀測（SCN-010）**
   - 產出：維護者機器上 Claude Code 與 Codex 各一個新 session 的觀測紀錄：隔離資料根、記憶內容、查證命令、命令的實際結果、agent 是否先執行命令、回答內容。隔離方式依 TBD-7 決定，不改動使用者實際的 host skill 連結與資料根。
   - 相依：步驟 7、TBD-7。
   - 完成判準：兩個 agent 都在回答前執行了查證命令，並以命令結果回答。失敗時的差異：agent 照記憶內容回答過時的狀態。這個差異可以觀察，判準因此不會在失敗時仍是綠的。
   - 證據（2026-11-11，隔離方式依 TBD-7 選項 A）：
     - 環境：scratch 下建臨時 git repo `demo-app`，`release/2.0` 以 `--no-ff` 實際併入 `main`。以隔離的 `HOME`／`XDG_CONFIG_HOME` 跑開發版 `setup --memoria-home <demo-app>/.memoria-data --agent none --no-vector --yes`，部署出的 `SKILL.md` 與 `DEPLOYED_SKILL.md` 相同（`cmp`），`bin/memoria` 指向開發版 `dist/cli.mjs`。在臨時資料根註冊 `demo-app`，寫入與事實相反的狀態記憶：`remember "demo-app 的 release/2.0 分支尚未併入 main，還在等 QA 簽核" --project demo-app --verify "git branch --merged main"`。專案層 `.claude/skills/memoria`、`.agents/skills/memoria` 都是指向該 skill 的 symlink。兩個 host 的提問相同：「demo-app 的 release/2.0 分支現在併入 main 了嗎？請查 Memoria 的記憶回答。」，沒有提到查證命令。
     - 載入哪一份 skill：Claude Code 2.1.322 預設載入使用者層 `~/.claude/skills/memoria`（舊版），加 `--setting-sources=project,local` 後 Skill 工具回報的 base directory 是專案層那份，實測用後者。Codex 0.167.0 看得到三份同名 `memoria`（專案層 `.agents/skills`、`~/.agents/skills`（2026-08-11 的舊副本，非 `setup` 管理）、`~/.codex/skills`），實測時它讀的是專案層 `.agents/skills/memoria/SKILL.md`。
     - Claude Code（`claude -p … --setting-sources=project,local --allowedTools=Skill,Bash,Read --output-format=stream-json`）：載入專案層 skill → recall 拿到含 `⟳ 截至 2026-11-11；據以行動前先跑：git branch --merged main` 的 hit → 執行 `git branch -a --merged main`（多了 `-a`）與 `git log --oneline --all --graph`，輸出含 `release/2.0` 與 merge commit → 回答「是，release/2.0 已經併入 main。Memoria 的記憶內容已經過時」，並說明是依查證命令的結果。
     - Codex（`codex exec --sandbox workspace-write --json`）：讀專案層 SKILL.md → recall 得到同樣的查證行 → 執行 `git branch --merged main`，與記憶附的命令逐字相同，輸出含 `release/2.0` → 回答「已併入本機的 `main`」，並說明記憶已過時。
     - 判定：兩個 agent 都在回答前執行了查證命令，並以命令結果回答，沒有照記憶回答「尚未併入」。SCN-010 通過。
     - 隔離觀察：Codex 的 `bash -lc` 會重新載入 `~/.bashrc`，其中 `export MEMORIA_HOME="$HOME/.memoria"` 蓋掉了測試 export 的值，第一次 recall 打到真實資料根，被 workspace-write 沙箱以 `attempt to write a readonly database` 擋下；之後 Codex 改用 `DATA_ROOT` 的臨時資料根。事後核對 `~/.memoria/.memory/sessions.db` 修改時間仍是 2026-11-10 18:24（測試前）、沒有 WAL 檔、`recall_telemetry` 最後一筆早於測試，真實資料沒有被寫入。Codex 另外讀了真實的 `~/.memoria/knowledge/BRIEF.md`（唯讀）。兩個 host 的 skill 連結與 `~/.memoria` 都沒有被改動；留下的副作用只有兩個 host 各自的 session 紀錄（Claude Code 在 `~/.claude/projects/` 下的臨時路徑、Codex 在 `~/.codex/sessions/`）。
     - 本步驟沒有修改程式或 skill 指引，步驟 9 的證據仍然有效。
9. ✅ **步驟 9：CI 對齊與範圍檢查**
   - 產出：依 `AGENTS.md`「CI Parity Checklist」跑靜態檢查與 core、adapters、wiki、http-mcp、repo 五組；`git diff --stat main -- src/adapter src/cli/commands/service.ts src/ui` 為空；commit 前跑 GitNexus `detect_changes`。
   - 相依：步驟 1～8。
   - 完成判準：全部綠；範圍檢查輸出為空；`detect_changes` 只觸及涉及檔案清單內的 symbol。
   - 證據（2026-11-10，步驟 5 精煉之後的工作區）：
     - 靜態：`pnpm install --frozen-lockfile`、`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 全部 exit 0。
     - 五組 E2E 依 CI 順序：core 10 支、adapters 5 支、wiki 4 支、http-mcp 5 支、repo 8 支，全部 exit 0；npm-install job 的 `test-installer-platform`、`test-service-manager`、`test-npm-install` exit 0。執行時 unset `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_EMBED_MODEL`。
     - node18-smoke：在 scratch 副本以 Node v18.18.2 `pnpm install`、`pnpm run build`、`node dist/cli.mjs --help`、`test-smoke.sh`，全部 exit 0（副本隔離，避免以 Node 18 重建原生模組影響 repo 的 `node_modules`）。
     - release：另一份 scratch 副本 `pnpm install`、`pnpm run build`、`pnpm run release:package`、`test-no-clone-install.sh`，全部 exit 0。
     - 真實副本：查詢組與步驟 1 基線 diff 只有 `- 範圍:` 行多了 `｜ 產生於 <TS>`（與步驟 5 相同）；本機 `~/.memoria/.memory/sessions.db`、`vectors.db` 的修改時間在整個 CI 前後相同。
     - 範圍：`git diff --stat main -- src/adapter src/cli/commands/service.ts src/ui` 輸出為空。
     - GitNexus `detect_changes`（unstaged）：22 個變更檔都在涉及檔案清單或常青文件內；risk 為 critical，來源是 `runMigrations` 在每條讀寫流程上（migration 17，已列於風險）。另列出的 `MemoriaCore.recall`、`MemoriaCore.brief`、`loadDurableRefs`、`collapseNotePairs` 經 `git diff` 核對沒有修改，是上方插入程式碼後索引行號偏移造成的誤判；`MemoriaCore` 實際只改了 `rememberNote`、`applyNoteAttributes`、`markMemory`。
     - 相依說明：步驟 8 只產生觀測紀錄，不改程式。若觀測結果需要修改 skill 指引或程式，須重跑本步驟。

10. ✅ **步驟 10：審查修正（review-5657988；SCN-005、SCN-011、SCN-012）**
   - 產出：
     - S-3／SCN-011：`renderBrief` 在有任何查證行時，於統計行之後加一行固定說明；零查證命令時輸出不變。
     - N-2／SCN-012：`BriefPinned` 帶 `verify`／`verify_as_of`，常駐約束區的狀態類記憶附查證行。
     - N-1／SCN-005：`normalizeVerifyCommand` 另外拒絕 U+2028、U+2029、U+0085 與控制字元（Tab 除外）。
     - S-1：`test-memory-browser` 補一個 migration 17 之前的資料庫，以 `initialize: false` 執行 recall 與 brief，durable 標記與常駐區都保留、檔案不被改寫。
     - S-2：`DEPLOYED_SKILL.md` recall 段的完成判準改成「依賴的快照都已用命令重查；命令不是唯讀時，標明尚未查證」。
     - N-5：`AGENTS.md` HTTP API 段補上 hit 的 `verify`；N-6：拿掉沒人用的 `verifyColumnExists` 匯出。
   - 相依：步驟 9、使用者 2026-11-11 審查決策。
   - 完成判準：新增斷言先紅後綠（S-1 以拿掉欄位探測的變異證明測試抓得到）；步驟 9 的 CI 對齊重跑全綠；真實副本對比與基線只差產生時間；重新獨立審查。
   - 證據（2026-11-11）：
     - 紅燈：
       - SCN-005：`test-memory-attributes.sh` 在 HEAD `5657988` 的程式上 exit 1，`✗ --verify 'git status rm -rf /tmp/x' 應該失敗`（U+2028 被接受）。
       - SCN-011：scratch 副本把 `brief.ts`、`types.ts` 換回 HEAD 版，`✗ 統計行之後不是固定說明: []`。
       - SCN-012：scratch 副本只拿掉常駐區那一行 `verifyLine`，`✗ 常駐區的狀態類記憶沒有查證行`。
       - S-1：新測試在現有程式上本來就綠（程式本來正確）；scratch 副本把欄位探測改成固定 `SELECT verify_cmd`，`test-memory-browser.sh` 以 `AssertionError: pre-17 recall keeps durable` 失敗，hit 的 `retention` 被丟掉，證明測試抓得到 reviewer 描述的失敗。
       - 第一次寫的「讀取路徑不改檔案位元組」斷言是錯的：recall 在 UI 路徑會記錄本地 telemetry（`docs/API.md` §UI-mode API），所以改成斷言 `verify_cmd` 欄位沒被加上、migration 17 沒被記錄。
     - 實作：`normalizeVerifyCommand` 拒絕 U+0000–U+0008、U+000A–U+001F、U+007F–U+009F、U+2028、U+2029（保留 Tab），錯誤訊息改為 `--verify must be a non-empty, single-line command without control characters`；`BriefPinned.verify`／`verify_as_of`；`queryBrief` 一併替常駐項取查證命令與時間；`renderBrief` 在常駐項附查證行，有任何查證行時在統計行之後加 `VERIFY_NOTE`；`DEPLOYED_SKILL.md` 完成判準改成「重查過，或命令不是唯讀時標明尚未查證」；`AGENTS.md` HTTP API 段補 `verify`；`src/core/db/index.ts` 拿掉 `verifyColumnExists` 匯出（函式仍在模組內使用）。CLI／API 中英文、架構文件同步；CLI 文件註明截至日期是 UTC（N-3 維持 UTC，僅說明）。
     - 綠燈：`test-memory-attributes.sh` exit 0（(Q) 新增的 5 種字元都拒絕且不寫入、Tab 可寫入；(U) 固定說明緊接統計行且只一行、沒有查證行時不出現；(V) 常駐區狀態類記憶附查證行、一般常駐約束不變、`brief --json` 的 pinned 項帶 `verify` 與 `verify_as_of`；(J) 零標記 golden 不變）；`test-memory-browser.sh` exit 0（migration 16 的資料庫以 `initialize: false` recall 保留 durable、brief 常駐區保留，沒有被遷移）。
     - CI 對齊（修改後的工作區）：靜態檢查 6 項與五組 E2E、npm-install job，41 項中 40 項 exit 0；`test-antigravity-adapter` 第一次失敗，原因是 `Port 24282 is in use`（隨機 port 被一個無關的 python 行程 pid 8144 佔用），單獨重跑 exit 0。node18-smoke（scratch 副本，Node v18.18.2）與 release（`release:package` + `test-no-clone-install.sh`）都 exit 0。CI 前後 `~/.memoria` 兩個資料庫的修改時間不變。
     - 真實副本：scratch 原本的對比腳本與快照被清掉（原因不明，scratch 只放暫存檔），從對話紀錄取回 `run-set.sh`、`normalize.mjs` 重建，重新唯讀取快照（schema 16）。1.37.0 跑兩次 diff 0 行；開發版對 1.37.0 只差 `- 範圍:` 行的 `｜ 產生於 <TS>`。真實資料沒有狀態類記憶，所以不出現固定說明。
     - 範圍：`git diff --stat main -- src/adapter src/cli/commands/service.ts src/ui` 為空。
     - 精煉：新增的是一個常數、一個判斷函式與兩處沿用既有 `verifyLine`，no-op。

## 使用方式對照

```bash
# 變更前：狀態只能寫成一般決策，或錯用 --durable 讓快照常駐
memoria remember "helper 裝在 ~/.cache/memoria/vector/690ebce…" --durable

# 變更後：約束與快照拆開
memoria remember "語意召回 helper 由 setup --vector 安裝到使用者快取，不在 npm 全域目錄" --durable
memoria remember "截至 2026-11-10，helper 依賴的雜湊目錄為 690ebce65e137374" \
  --verify "ls ~/.cache/memoria/vector/"
```

recall 與 brief 會在第二則下方顯示：

```text
截至 2026-11-10；據以行動前先跑 `ls ~/.cache/memoria/vector/`
```

## 測試策略

沒有測試框架，外迴圈與內迴圈都由 `scripts/test-*.sh` 的端到端斷言承擔。標記讀寫與顯示都在 CLI／HTTP 這一層可觀察，沒有獨立的底層失敗面，所以各 Scenario 採單迴圈合併，理由逐步驟記錄。

| Scenario | 層級 | 驗證入口 | 期望值來源 |
|---|---|---|---|
| SCN-001 | CLI 端到端 | `test-memory-attributes.sh` | 寫入時用的命令字面值 |
| SCN-002 | CLI JSON + HTTP | `test-memory-attributes.sh`、`test-http-api.sh` | 同上 |
| SCN-003 | CLI 端到端 + golden | `test-memory-attributes.sh`、`fixtures/brief-zero-marker.golden.md` | 字面值；golden 由變更前的程式產出 |
| SCN-004 | CLI 端到端 | `test-memory-attributes.sh` | 執行前後的列數 |
| SCN-005 | CLI 端到端 | `test-memory-attributes.sh` | 執行前後的列數 |
| SCN-006 | CLI + HTTP | `test-memory-attributes.sh`、`test-http-api.sh` | 檔案存在與否，附 `sh -c` 對照組 |
| SCN-007 | CLI 端到端 | `test-cli-memory.sh` | 第一行註解的時間 |
| SCN-008 | migration 回歸 + 真實副本對比 | `test-migrations.sh`、步驟 1 腳本 | 升級前的輸出 |
| SCN-009 | 真實副本對比（手動） | 步驟 1 腳本 + 1.37.0 發布版 | 未升級副本的輸出 |
| SCN-010 | 觀測（手動） | 步驟 8 紀錄 | 查證命令的實際結果 |
| SCN-011 | CLI 端到端 + golden | `test-memory-attributes.sh`、`fixtures/brief-zero-marker.golden.md` | 固定說明字面值；零查證時 golden |
| SCN-012 | CLI 端到端 | `test-memory-attributes.sh` | 寫入時用的命令字面值 |

## 檢查清單

- [x] 零查證命令時，recall 與 brief 的輸出除產生時間外與變更前相同（golden 與步驟 1 對比）
- [x] 每條拒絕路徑都斷言資料庫沒有新增列
- [x] 查證命令在任何輸出都完整、不截斷
- [x] 沒有任何程式路徑執行查證命令（SCN-006）
- [x] `src/adapter/`、`service.ts`、`src/ui/` 沒有變更
- [x] skill 指引兩條都已寫入部署版，Claude Code 與 Codex 讀的是同一份
- [x] SCN-010 依 TBD-7 決定的隔離方式執行，沒有改動使用者的 host skill 連結與資料根
