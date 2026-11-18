# Issue 33 實作計畫

風險與首要驗證見 [README.md](./README.md#風險與首要驗證)。

## 現況（2026-11-17 調查）

- **連線**：`withDb`（`src/core/db/connection.ts:32`）、`initDatabase`（`src/core/db/schema.ts:553`）、`runVerify`（`src/core/db/verify.ts:49`）都直接 `new Database(...)`，沒有傳 `timeout`，沿用 better-sqlite3 的預設 5000 毫秒。資料庫是預設的 rollback journal（`PRAGMA journal_mode` 回 `delete`），沒有開 WAL。寫入交易都是同步執行、毫秒級；git 指令在交易之外執行。
- **repo sync**：`performRepoSync`（`src/core/memoria.ts:961`）先解析 repository，再進 `withRepoSyncLock`（`memoria.ts:157`）。這把鎖是程式內的 Promise 鏈，跨程式無效。掃描在鎖內讀取舊的 ref 狀態（`getCurrentRefObservations`），比對後分好幾個交易寫入（`git-scan.ts:74/88/130`）。`repoAdd` 的首次掃描也走 `performRepoSync`。
- **dry-run**：`options.dryRun` 時什麼都不寫（spec §19.4），但仍在程式內鎖裡排隊。
- **Daily 筆記**：`syncDailyNote`（`src/core/db/sync.ts:8`）讀整份檔案，接上 `\n## HH:MM - <project>…` 後整份 `writeFile`。
- **HTTP**：`gitErrorStatus`（`src/server.ts:199`）依錯誤字串對應狀態碼，沒對應到的回 500。

2026-11-17 在隔離資料根的重現（scratchpad 腳本，未進版控）：

| 實驗 | 結果 |
|---|---|
| 兩個程式同時 `repo sync`（註冊後新增 3 個 feature commit、`--no-ff` merge、tag） | `git_events` 17、`git_refs` 10、`git_scan_runs` 3；單獨 sync 的對照組為 9、6、2。每一種事件類型都是 2 倍，`is_current=1` 的每個 ref 各 2 列；`git_summaries` 兩邊都是 1 |
| 16 個程式同時 `remember`，5 輪 | 資料庫每輪 16 個 session；Daily 條目為 15、15、16、16、16 |
| 上述所有程式的 stderr | 沒有 `database is locked` |

## 設計方案

### A. 資料庫鎖等待時間（SCN-006）

`connection.ts` 匯出 `SQLITE_BUSY_TIMEOUT_MS = 5000`（TBD-1：維持預設值，只改成明確寫出）。三個 `new Database` 呼叫都帶 `timeout: SQLITE_BUSY_TIMEOUT_MS`。不改 journal mode：WAL 會永久寫進資料庫檔案，唯讀開啟（`verify`、受限沙箱）要額外的 `-shm` 檔；16 個程式同時寫入都沒有失敗，沒有證據需要更高的並行吞吐量。

### B. 跨程式 sync 租約（SCN-001～004）

migration 18 `git_sync_leases`：

```sql
CREATE TABLE IF NOT EXISTS git_sync_leases (
  repository_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,        -- 這次持有的隨機值，續約與釋放都要對得上
  holder_pid INTEGER,
  holder_host TEXT,
  acquired_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL
);
```

新增 `src/core/db/git-sync-lease.ts`：

```ts
export type SyncLease = { repositoryId: string; token: string }
export type LeaseHolder = { pid: number | null; host: string | null; acquiredAt: string; expiresAt: string }
export function tryAcquireSyncLease(dbPath: string, repositoryId: string, ttlMs: number): SyncLease | LeaseHolder
export function renewSyncLease(dbPath: string, lease: SyncLease, ttlMs: number): boolean
export function releaseSyncLease(dbPath: string, lease: SyncLease): void
export function peekSyncLease(dbPath: string, repositoryId: string): LeaseHolder | null  // 唯讀，已過期的回 null
```

`tryAcquireSyncLease` 用 `db.transaction(...).immediate()`（`BEGIN IMMEDIATE`）：沒有租約或已過期，就寫入新的 token 並回傳 `SyncLease`；否則回傳持有者資訊。檢查和寫入在同一個寫入交易裡，兩個程式不會同時拿到。過期只看 `expires_at`，不檢查 pid 是否存活：容器之間看不到彼此的 pid。

`performRepoSync` 的流程：

```diff
 preflight = findRepository(...)
 return withRepoSyncLock(id, async () => {
+  if (options.dryRun) {
+    await waitUntilLeaseFree(id, waitMs)          // 只讀，不取得
+    return this.performRepoSyncLocked(ref, options)
+  }
+  const lease = await acquireWithin(id, waitMs)   // 每 200ms 重試；逾時丟 repository_sync_busy
+  const heartbeat = setInterval(() => renewSyncLease(...), 15_000).unref()
+  try {
     return await this.performRepoSyncLocked(ref, options)
+  } finally {
+    clearInterval(heartbeat)
+    releaseSyncLease(dbPath, lease)
+  }
 })
```

- 程式內鎖保留在外層：同一程式內的呼叫照舊用 Promise 排隊，不必輪詢資料庫。
- TTL 60 秒、每 15 秒續約。續約失敗（例如鎖忙）只記警告，不中斷 sync；連續失敗到過期時，最差就是回到現在的行為。
- 等待上限：`MEMORIA_REPO_SYNC_WAIT_MS`，預設 120000（TBD-2）。逾時錯誤：`repository_sync_busy: another process has been syncing <name> since <acquired_at> (pid <pid> on <host>)`。
- `server.ts` 的 `gitErrorStatus` 把 `repository_sync_busy` 對應到 409（TBD-3）。

### C. Daily 筆記附加寫入（SCN-005）

```diff
-let content = `# ${date}\n\n${newEntry}`
-if (existsSync(notePath)) content = `${await fs.readFile(notePath)}${newEntry}`
-await fs.writeFile(notePath, content)
+try { await fs.writeFile(notePath, `# ${date}\n\n`, { flag: 'wx' }) }
+catch (e) { if (e.code !== 'EEXIST') throw e }
+await fs.appendFile(notePath, newEntry, 'utf8')
```

`wx` 讓同時建立檔案的程式只有一個寫出檔頭。檔頭加上第一筆條目的位元組與原本完全相同，既有檔案則只在檔尾多一筆，也和原本相同。

> 2026-11-18 起由步驟 8 取代（review-9d76366 M1）：`wx` 的 open 與寫檔頭之間，別的程式拿到 `EEXIST` 先附加，檔頭再寫在 offset 0 會蓋掉那筆的開頭。現行做法是先把檔頭寫進暫存檔，再以 `fs.link` 讓正式檔一出現就含檔頭。

## 實作步驟

1. ✅ **首要驗證：跨程式 sync 的紅燈測試**（SCN-001～003）
   - 產出：`scripts/test-repo-edge.sh` 新增三段：兩個程式同時 sync 和單獨 sync 的對照組比較事件筆數與 `is_current` 列數；直接插入一筆未過期租約，以 `MEMORIA_REPO_SYNC_WAIT_MS=500` 執行 sync；插入一筆已過期租約後執行 sync。
   - 相依：無。
   - 完成判準：SCN-001 在修改前紅燈，事件筆數與對照組不同；記錄命令與輸出。SCN-002、SCN-003 要先有租約表才能插入資料，所以紅燈在步驟 2 先加 migration 18、`performRepoSync` 還沒用到租約時取得：SCN-002 會直接成功並寫入；SCN-003 的接手要等步驟 2 實作後才有意義，修改前它本來就會成功，因此記為守住「不會停擺」的回歸測試，不要求紅燈。
   - 證據（2026-11-17，工作區未提交）：`bash scripts/test-repo-edge.sh`，exit 1，連跑 4 次都在同一條紅：`✗ concurrent syncs record exactly what one sync records: expected 'branch_discovered=1,branch_head_moved=1,commit_discovered=3,head_changed=1,merge_commit_discovered=1,repository_added=1,tag_discovered=1 | commits=7 | current_refs=4 | current_ref_names=4 | summaries=1', got 'branch_discovered=2,branch_head_moved=2,commit_discovered=6,head_changed=2,merge_commit_discovered=2,repository_added=1,tag_discovered=2 | commits=7 | current_refs=8 | current_ref_names=4 | summaries=1'`。每一種事件都是 2 倍，目前有效的 ref 多一份，和調查時的手動重現一致。
2. ✅ **租約模組與 migration 18**（SCN-001～003）
   - 產出：`git-sync-lease.ts`、`schema.ts` migration 18、`memoria.ts` 的 `performRepoSync`。
   - 相依：步驟 1。
   - 完成判準：步驟 1 的三段綠燈；SCN-001 連跑 10 次都綠；`test-migrations.sh` 綠燈（舊資料庫升級後有新表，既有資料不變）。
   - 證據（2026-11-17）：
     - SCN-002 紅燈：保留 migration 18、暫時讓 `performRepoSync` 不經過租約（暫時副本，跑完還原並重新 build），exit 1：`✗ busy sync exits non-zero: expected 'yes', got ''`，被佔住的 sync 照樣成功。
     - 綠燈：`bash scripts/test-repo-edge.sh` exit 0，SCN-001～004 共 24 條 ✓；連跑 10 次 `repo-edge pass=10/10`。
     - `bash scripts/test-migrations.sh` exit 0（`[migrations] ok`）。
     - 真實資料庫副本（`sqlite3 .backup` 到 scratchpad，不碰 `~/.memoria`）跑 `stats` 升級：`before=532/1215/6751/17 after=532/1215/6751/18`（sessions／events／git_events／最大 migration），`git_sync_leases` 已建立，`pragma integrity_check` 為 `ok`。
3. ✅ **dry-run 等待與 HTTP 409**（SCN-002 的 HTTP 部分、SCN-004）
   - 產出：`performRepoSync` 的 dry-run 分支、`server.ts` 的 `gitErrorStatus`；`test-repo-edge.sh` 新增 dry-run 在租約釋放後才回傳、且租約表與 scan run 不變；`test-repo-promotion.sh` 新增被佔住時回 409（repo 端點的狀態碼測試都在這支，包括 dismiss 的 409；計畫原寫 `test-http-api.sh`，這是等價的路徑選擇）。
   - 相依：步驟 2。
   - 完成判準：新增的測試修改前紅燈、修改後綠燈。
   - 證據（2026-11-17）：
     - SCN-004 紅燈：同步驟 2 的暫時停用租約，exit 1：`✗ dry-run still waiting while the lease is live: expected 'waiting', got ''`，dry-run 沒有等待。
     - HTTP 紅燈：`gitErrorStatus` 修改前 `bash scripts/test-repo-promotion.sh` exit 1：`✗ sync while another process holds the lease → 409 (issue-33): expected '409', got '500'`。
     - 綠燈：`test-repo-edge.sh` 的 SCN-004 七條 ✓；`test-repo-promotion.sh` exit 0，`✓ sync while another process holds the lease → 409 (issue-33)`、`✓ 409 body names repository_sync_busy`、`[repo-promotion] PASS`。
4. ✅ **資料庫鎖等待時間明確化**（SCN-006；不改變可觀察行為）
   - 產出：`connection.ts`、`schema.ts`、`verify.ts`；`test-cli-memory.sh` 新增 characterization test：另一個 node 程式以 `BEGIN IMMEDIATE` 持有寫入鎖 2 秒時 `remember` 成功；持有 8 秒時寫入等約 5 秒後放棄、命令在約 5～10 秒之間結束（撤回寫到一半的筆記會再等同一把鎖，見 README TBD-5）、錯誤含 `database is locked`、資料庫沒有該筆。
   - 相依：無（TBD-1 已解決）。
   - 完成判準：等價證據。同一個 characterization test 在修改前、修改後都綠燈，記錄兩次的命令與輸出。
   - 證據（2026-11-17）：
     - 第一版判準「約 5 秒後失敗」（4500～7500ms）在修改前就不成立：`✗ 應在約 5 秒後失敗，實際 8036ms`。用暫時的 preload 追蹤 SQLite 呼叫（scratchpad，未進版控）：`run THREW after 5006ms: database is locked :: INSERT INTO sessions …`，接著 `run took 2932ms :: DELETE FROM events WHERE session_id = ?` 等到持有者在 8 秒時釋放。判準依此修訂為 4500～10500ms，SCN-006 標為待重新核准（README TBD-5）。
     - 修改前（`timeout` 尚未明確寫出）：`bash scripts/test-cli-memory.sh` exit 0，`鎖持有 2 秒時等待後成功；持有 8 秒時 8031ms 後以 database is locked 失敗，沒有留下筆記`。
     - 修改後（三處 `new Database` 帶 `timeout: SQLITE_BUSY_TIMEOUT_MS`）：同一命令 exit 0，同一行輸出，8031ms。
   - 狀態：SCN-006 於 2026-11-18 依修訂後的判準重新核准（README TBD-5），完成。
5. ✅ **Daily 附加寫入**（SCN-005）
   - 產出：`sync.ts` 的 `syncDailyNote`；`test-cli-memory.sh` 新增 16 個程式同時 `remember`，檢查條目數與檔頭數；單獨 `remember` 的 Daily 內容和固定的預期字串比對。
   - 相依：無。
   - 完成判準：同時寫入的測試修改前在多輪中至少一輪紅燈（測試內連跑 5 輪），修改後綠燈；逐位元組比對修改前後都綠。
   - 證據（2026-11-17）：
     - 修改前 `bash scripts/test-cli-memory.sh` exit 1：逐位元組比對 ✓（`單獨寫入兩筆，Daily 與既有格式逐位元組相同`），並行測試 `✗ round 4: Daily has 15 entries for 16 sessions`。
     - 修改後同一命令 exit 0：逐位元組比對 ✓，`5 輪、每輪 16 個程式同時寫入，Daily 條目數都等於 session 數，檔頭只有一個`。
   - 後續：這一步的 `wx` 建檔在第一輪審查被判定仍會掉資料（review-9d76366 M1），已由步驟 8 的 hard link 建檔取代；上面的證據是當時的紀錄。
6. ✅ **常青文件**
   - 產出：`docs/OPERATIONS.md`（移除「跨程式並行是 v1 限制」，說明租約、`MEMORIA_REPO_SYNC_WAIT_MS` 與鎖等待時間）、`docs/API.md`／`docs/API.zh-TW.md`（sync 的 409）、`docs/agents/architecture.md`（sync 序列化）、`memoria.ts:151` 的程式註解。
   - 相依：步驟 2～5。
   - 完成判準：文件描述與實作一致；`pnpm run release:docs-check` 綠燈。
   - 證據（2026-11-17）：更新 `docs/OPERATIONS.md`（「Concurrent syncs」段落、troubleshooting 的 `repository_sync_busy`）、`docs/API.md`／`docs/API.zh-TW.md`、`docs/agents/architecture.md`（sync 雙層序列化；資料根多程式共用、鎖等待與 Daily 附加寫入）、`AGENTS.md`（`repoSync` 說明與 HTTP 表的 409）、`src/server.ts` 路由註解、`memoria.ts` 的序列化註解。`pnpm run release:docs-check`：`Release doc sync check passed for v1.38.0`。
7. ✅ **整體驗證**
   - 產出：CI 對照清單的靜態檢查，加上 `core`、`repo`、`http-mcp` 三組腳本的輸出（`withDb` 影響全部模組，實際跑了全部五組）。
   - 相依：步驟 1～6。
   - 完成判準：全部綠燈；`gitnexus_detect_changes` 的影響範圍只含上表的 symbol。
   - 證據（2026-11-17，工作區未提交）：
     - 精煉（code-simplify）：產品程式碼 no-op，dry-run 只讀等待與取得租約的兩個迴圈刻意分開，合併會把唯讀和寫入混在一起；`test-repo-promotion.sh` 抽出 `db_run`，取代兩段重複的 inline node，重跑 `[repo-promotion] PASS`。
     - 第一次跑全部清單：36 項 PASS，`test-ui-http.sh` FAIL（`ui-http-driver.mts:68` 斷言 vector 模式 `fallback_used`）。在 `main` 的乾淨 worktree 跑同一支也失敗（exit 1）：本機 shell 帶著 `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_VECTOR_TIMEOUT_MS`，測試因此連到真實向量庫，與本次變更無關（`docs/agents/project.md` M-4）。真實 `vectors.db` 的 mtime 停在 17:00:35，早於這次執行，沒有被寫入。
     - 以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 重跑全部清單：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check`，加上 core 10 支、adapters 5 支、wiki 4 支、http-mcp 5 支、repo 8 支，共 37 項全部 PASS。
     - `gitnexus_detect_changes`（scope all）：程式改動落在 `connection.ts`、`schema.ts`（`initDatabase`、migration 18）、`sync.ts`（`syncDailyNote`）、`verify.ts`、`memoria.ts`（import、序列化註解、`withCrossProcessSyncLease`、`performRepoSync`）、`server.ts`（`gitErrorStatus`）。另列的 `resolveManagedRepo`、`withResult`、`notePairOf` 等是行號位移造成的誤判，`git diff -U0 src/core/memoria.ts` 只有 5 個 hunk，都在上述位置；列出的 `docs/AGENTS.md` 未修改（`git status` 無此檔）。

8. ✅ **依第一輪審查修正**（[review-9d76366](./review-9d76366.md)；M1、S1、S2、N2～N6，範圍見 README TBD-6）
   - 產出：
     - M1：`sync.ts` 的 `createDailyNoteWithHeader`，新 Daily 先把檔頭寫進同目錄的暫存檔，再以 `fs.link` 建立正式檔（`EEXIST` 時跳過），之後照舊附加；沒有 hard link 的檔案系統退回原本的 `wx`。新增 `scripts/daily-race-driver.mts`，`test-cli-memory.sh` 以它讓 16 個程式在同一時刻對尚未存在的 Daily 呼叫 `syncDailyNote`，跑 30 輪，並檢查 Daily 目錄沒有殘留暫存檔。
     - S1：`MEMORIA_REPO_SYNC_LEASE_TTL_MS`（只給測試用，不寫進使用者文件），續約間隔為 TTL 的四分之一；`test-repo-edge.sh` 新增 TTL 3 秒、git 每次呼叫慢 0.4 秒的長 sync，第二個 sync 在它進行中開始。
     - S2：SCN-003 的「事件筆數與沒有殘留租約時相同」改為和對照資料根（同樣多一個 commit 後 sync 一次）比較 `sync_shape`。
     - N2 `gitErrorStatus` 先判斷 `repository_sync_busy`；N3 釋放租約失敗只警告、不蓋掉已成功的 sync；N4 `OPERATIONS.md` 補上無效的 `MEMORIA_REPO_SYNC_WAIT_MS` 退回預設；N5 測試策略表更正；N6 `performRepoSync` 的 dry-run 註解更正。
   - 相依：步驟 1～7。
   - 完成判準：M1 與 S1 的新測試修改前紅燈、修改後綠燈；CI 對照清單全綠。
   - 證據（2026-11-18）：
     - M1 量測：driver 對原寫法每輪約 15% 壞掉（16 個程式 × 20 輪，三次分別 3、3、5 輪 `15 entries, 1 headers for 16 sessions`）。只拿原寫法的 `sync.ts`（`git show HEAD:src/core/db/sync.ts`）重新 build，`bash scripts/test-cli-memory.sh` exit 1：`✗ 6/30 rounds lost or corrupted Daily entries`。換回修正後 exit 0：`30 輪、每輪 16 個程式在同一時刻寫入尚未存在的 Daily，條目與檔頭都完整`，逐位元組比對與 SCN-006（8037ms）照舊通過。修正後另以 driver 手動跑 3 × 30 輪全綠，Daily 目錄只有 `.md`。`wiki-build` 只讀 `.md`，建檔途中的暫存檔不會被收進 wiki。
     - S1：暫時把續約呼叫短路（`if (false && !renewSyncLease(...))`）後 build，`bash scripts/test-repo-edge.sh` exit 1：`✗ renewed lease: the two syncs record what one sync records`，`head_changed=2`（對照為 1）；長 sync 確實超過 TTL（`✓ the slow sync really outlived the TTL`）。還原後 exit 0，`[repo-edge] PASS`。
     - S2：新斷言 `✓ takeover records what a sync with no stale lease records`；它強化既有的回歸測試，修改前的行為本來就通過，不要求紅燈（同步驟 1 對 SCN-003 的判定）。
     - CI：`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 下跑完整清單（靜態檢查 5 項加五組 32 支腳本），37 項全部 PASS。
     - 精煉（code-simplify）：CI 後把 `resolveSyncWaitMs` 與新加的 TTL 解析合併成 `envMs(name, fallback)`，行為不變；重跑 `pnpm run check`、`pnpm run build`、`test-repo-edge`、`test-repo-promotion`、`test-repo-sync` 全部 PASS。N7（兩個輪詢迴圈）照步驟 7 的判定維持分開。

9. ✅ **依第二輪審查的 NICE TO HAVE 修正**（[review-680ed91](./review-680ed91.md)；N-a～N-g，範圍見 README TBD-7）
   - 產出：
     - N-a：`createDailyNoteWithHeader` 先檢查 Daily 是否已存在，已存在就不建暫存檔（多數 `remember` 是這種情況；沒看到檔案的程式仍走 hard link，競態不會重開）。暫存檔的寫入移進 `try`，寫入失敗也會清掉；`finally` 刪暫存檔失敗只警告，不讓已成功的建檔變成失敗。
     - N-b：續約測試不再固定等 0.8 秒，改成輪詢 `git_sync_leases`，等慢的 sync 取得租約後才啟動第二個，並斷言這個前提。
     - N-c：driver 的子程式在送出 ready 前結束時，該輪直接紅燈並結束其他子程式；每一輪都檢查 Daily 目錄沒有 `.md` 以外的檔案（原本只在 shell 端檢查最後一輪，該檢查移除）。
     - N-d：續約間隔上限為 `2^31-1` ms；`test-repo-edge.sh` 新增以 `MEMORIA_REPO_SYNC_LEASE_TTL_MS=10000000000` sync，stderr 不得出現 `TimeoutOverflowWarning`。
     - N-e：`performRepoSync` 的 dry-run 註解改為「so they do not start in the middle of one」。
     - N-f：設計方案 C 與步驟 5 註明已由步驟 8 取代；「使用方式對照」表原本夾在步驟 7、8 之間，移到步驟之後。
     - N-g：重建 GitNexus 索引，結果記在下方證據。
   - 相依：步驟 8。
   - 完成判準：N-c、N-d 的新檢查修改前紅燈、修改後綠燈；N-b 改寫後仍能抓到沒有續約；CI 對照清單全綠。
   - 證據（2026-11-18）：
     - N-d 紅燈：暫時把間隔改回 `ttlMs / 4` 後 build，`bash scripts/test-repo-edge.sh` exit 1：`✗ no timer overflow with a huge test TTL: expected '0', got '1'`。還原後 `✓ no timer overflow with a huge test TTL`、`[repo-edge] PASS`。
     - N-b 鑑別力：暫時把續約間隔改成 `MAX_TIMER_MS`（等於不續約）後 build，連跑 3 次都是 `✗ renewed lease: the two syncs record what one sync records`（`head_changed=2`，對照為 1），且 `✓ the slow sync holds the lease before the second one starts`。還原後 PASS。
     - N-c 掛住：在 driver 的暫時副本（放在 `scripts/` 讓相對 import 可用，跑完即刪）讓一個子程式在 warm-up 丟錯。原 driver（`git show HEAD:scripts/daily-race-driver.mts`）在 `timeout 20` 下 exit 124，一直掛到被殺；新 driver 554ms 後 exit 1：`✗ round 1: a writer exited with 1 before it was ready`，沒有遺留子程式。所有子程式都死掉時原 driver 不會掛，而是以 exit 13（unsettled top-level await）結束；只有部分子程式死掉、其他的還開著 IPC 時才會掛。
     - N-c 殘留檢查：暫時讓 `createDailyNoteWithHeader` 不刪暫存檔，新 driver 3 輪全紅：`round 1: 4 entries, 1 headers for 4 sessions, 4 non-.md files left in Daily/`。原 driver 也會紅，但原因不同：贏得 link 的暫存檔與正式檔是同一個 inode，附加的條目也出現在暫存檔裡，被重複計數（`8 entries, 5 headers`）。這是巧合，不是在檢查殘留。還原後 `3 輪、每輪 4 個程式…沒有殘留暫存檔`。
     - N-a：`strace -f -e trace=openat,link,unlink` 追蹤兩次 `remember`。第一次建 Daily 有 3 個暫存檔相關呼叫（建立、link、刪除），第二次（Daily 已存在）為 0。寫入失敗與 Windows 上刪除失敗兩條路徑沒有自動化測試：Linux 一般使用者無法讓暫存檔寫入或刪除單獨失敗，靠程式碼審閱。
     - CI：`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 下跑完整清單（靜態檢查 5 項加五組 32 支腳本），37 項全部 PASS。driver 這輪輸出 `30 輪、每輪 16 個程式在同一時刻寫入尚未存在的 Daily，條目與檔頭都完整，沒有殘留暫存檔`，SCN-006 為 8031ms。
     - GitNexus：`npx gitnexus analyze` 重建索引（5582 nodes，8845 edges）。它會改寫 `AGENTS.md` 的統計數字，並把整段 GitNexus 說明附加到只有 `@AGENTS.md` 的 `CLAUDE.md`（內容重複）；兩者已還原，不在本 issue 範圍，之後請改用 `--skip-agents-md`。impact：`createDailyNoteWithHeader` 為 LOW（只有 `syncDailyNote`）；`withCrossProcessSyncLease` 為 HIGH（CLI、HTTP、`repoAdd` 的 sync 都經過它），所以 N-d 只改間隔的計算式。`detect_changes`（scope all）列出的程式符號中，實際有 hunk 的是 `createDailyNoteWithHeader`、`withCrossProcessSyncLease`、`performRepoSync` 的註解，以及新常數 `MAX_TIMER_MS`。`envMs` 與 `extractDecisions` 被列出只因為和 hunk 相鄰（`git diff -U0` 的 hunk 都不在它們的函式本體內）。
     - 精煉（code-simplify）：no-op。driver 對每個檔案讀兩次是既有寫法，不在本步驟範圍。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|---|---|---|
| 兩個 worktree 收尾時同時 `memoria repo sync <repo>` | 兩個都立刻完成，事件重複 | 後到的那個等先到的完成，再做一次沒有新東西的 sync |
| 另一個 sync 卡住超過等待上限 | 不適用 | `repository_sync_busy: …`，exit 1，什麼都沒寫；稍後重跑 |
| `memoria repo sync <repo> --dry-run` 遇到進行中的 sync | 不等待（跨程式） | 等到對方完成才預覽 |

## 測試策略

| 驗收 | 層級 | 位置 |
|---|---|---|
| SCN-001～004 | 端到端，真的跨程式 | `scripts/test-repo-edge.sh` |
| SCN-002（HTTP） | HTTP 契約 | `scripts/test-repo-promotion.sh`（repo 端點的狀態碼測試都在這支，見步驟 3） |
| SCN-005、SCN-006 | 端到端，真的跨程式 | `scripts/test-cli-memory.sh` |

都是單迴圈：這幾項行為只有在真正的多程式之下才看得到，沒有獨立的單元層級失敗面。租約模組的邊界（過期判定、token 不符時不釋放）由 SCN-003 與 SCN-001 的「租約表沒有殘留」間接覆蓋；續約由 `test-repo-edge.sh` 的長 sync 測試覆蓋（步驟 8）。

## 檢查清單

- [x] TBD-1～4 已回答，全部 Scenario 已核准（2026-11-17）；SCN-006 依 TBD-5 修訂後於 2026-11-18 重新核准
- [x] 步驟 1 取得紅燈並記錄
- [x] migration 18 只新增表，舊資料庫可讀
- [x] 改 symbol 前已跑 GitNexus impact；detect_changes 已跑（2026-11-17；步驟 9 於 2026-11-18 重建索引後重跑），提交前若再修改需重跑
- [x] 常青文件已更新，版控文件只用代稱
