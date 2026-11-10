# Issue 31 實作計畫

風險與首要驗證見 [README.md](./README.md#風險與首要驗證)。

## 現況（2026-11-10 調查）

- `extractSkills`（`src/core/db/sync.ts:101`）用 `${slugify(fields.title)}.md` 當檔名，沒有長度上限；Decisions 已有 `slice(0, 40)`（`sync.ts:47`）。
- `remember()`（`src/core/memoria.ts`）先 `importSession` 寫 DB，再依序跑 `syncDailyNote`、`extractDecisions`、`extractSkills`、`buildMemoryIndex`。寫檔一拋錯，後面的節點建立就不會執行。
- `rememberNote()` 遇到 `noteExists(sessionId)` 為 true 時直接回 `created: false`，不檢查筆記是否完整，所以殘骸靠重試修不好。
- payload builder 只帶 `memory_node_sources` 指到的 session，沒有節點的 session 永遠不會進 payload。`memoria index build` 補得到（隔離資料根實測 0.1 秒，`missing 1 → 0`）。
- `vector-ingest.mjs` 對 payload 中每個可 embed 的實體都重算向量，逐列各自提交，鎖等待上限 300 秒。

## 設計方案

### A. Skills 檔名（SCN-001）

`src/core/utils.ts` 新增 `skillFileStem(title: string): string`：

```text
slug = slugify(title)
若 Buffer.byteLength(slug) <= 200 → 回傳 slug（既有檔名不變）
否則 → 在 UTF-8 字元邊界截到 ≤ 200 bytes，接上 "_" + sha256(slug) 前 8 碼十六進位
```

`extractSkills` 改用 `${skillFileStem(fields.title)}.md`。skills 表的 id（`normalizeSkillKey`）與向量實體名 `skill:<slug>` 都不變，只改檔名。

### B. 新筆記失敗時撤回（SCN-002、SCN-003）

`src/core/db/memory-note.ts` 新增 `discardNewNote(dbPath, sessionId)`：在單一交易中依序 `DELETE FROM events WHERE session_id = ?`、`DELETE FROM sessions WHERE id = ?`，和 `prune` 的順序相同；recall_fts 由既有 trigger 清除。`rememberNote()` 只在 `noteExists` 為 false 的路徑，用 try/catch 包住 `this.remember(...)`：失敗時呼叫 `discardNewNote`，再把原錯誤往外拋。`remember()` 本身與 `sync` 匯入路徑不變。

```diff
 if (noteExists(...)) return created:false
-const result = await this.remember(...)
-if (!result.ok) throw ...
+const result = await this.remember(...)
+if (!result.ok) {
+  discardNewNote(dbPath, sessionId)
+  throw new Error(result.error)
+}
```

（`remember()` 經 `withResult` 把例外轉成 `ok:false`，所以判斷 `result.ok` 就夠了。）

### C. ingest 跳過未變更列（SCN-004）

`vector-ingest.mjs`：

1. 先組出每個實體的 `texts[i]`（組法不變），開啟 client 並 `CREATE TABLE/INDEX IF NOT EXISTS`。
2. `SELECT name, kind, text FROM memoria_vectors WHERE name IN (...)`，分批查，每批最多 500 個參數。name、kind、text 三者都相同的列計入 `unchanged`。
3. 剩下的列才呼叫 `embedTexts`。沒有剩下的列時不載入模型、不寫入。
4. 逐列 `db.execute` 提交，不包成一個交易。
   > NOTE（2026-11-10）：原設計用 `db.batch([...], 'write')` 一次寫完。獨立審查 review-1d86717 M-1 實測發現：local store 用 rollback journal，交易期間讀者全被擋住，大批寫入時語意召回超過 1.5 秒等待上限而失敗。使用者選擇改回逐列提交（README TBD-3）。
5. 輸出 `{ ok, embedded: <實際寫入數>, unchanged, skipped }`，欄位語意見 README TBD-1。

換模型（`MEMORIA_EMBED_MODEL`）時舊向量不會自動重算，依使用者 Q2 決定只寫進文件：先刪 `vectors.db` 再 ingest。

### D. doctor（SCN-005）

`doctor.ts` 從既有的統計路徑取 `memoryIndex`（與 `stats` 同一份計算）。`missing > 0` 時加一行 `tree index`（ok: false，`indexed=… sessions=… missing=…`，fix: `memoria index build`）。同時 `ingestFix()` 在修法前面串上 `memoria index build &&`，並沿用目前 doctor 的 `MEMORIA_HOME` 與執行檔路徑。沒有缺口時，輸出和現在完全相同。

## 實作步驟

改任何 symbol 前先跑 GitNexus `impact`（upstream），HIGH／CRITICAL 先告知使用者。commit 前跑 `detect_changes`。

1. ✅ **首要驗證：真實資料盤點**（README 最大風險）
   - 產出：盤點腳本的結果，不進版控。
   - 完成判準：用目前的 builder 對 `~/.memoria` 產生 payload，依 ingest 的文字組法比對向量庫：`{ entities: 2183, same: 2183, changed: 0, missing: 0 }`（2026-11-10，刪除殘骸後）。代表 builder 產生的文字是穩定的，跳過策略在真實資料上有效。
2. ✅ **SCN-001：Skills 檔名上限**（設計 A）— 相依：無
   - 產出：`utils.ts`、`sync.ts`；`test-cli-memory.sh` 新增案例。
   - 完成判準：紅燈是長名稱 skill 筆記在目前程式碼上以 `ENAMETOOLONG` 失敗；綠燈是檔名 ≤ 255 bytes、帶雜湊後綴、`memoryIndex.missing` 為 0，短名稱的檔名與變更前相同。斷言用字面值，不重算實作。
   - 證據（2026-11-10，工作區）：單迴圈合併。行為只能透過 `remember` 命令觀察，`skillFileStem` 沒有獨立的整合面。紅燈：`bash scripts/test-cli-memory.sh` exit 1，`✗ 長名稱 skill 筆記寫入失敗: ❌ 執行失敗: ENAMETOOLONG: name too long, open '…/knowledge/Skills/雙分頁對打…'`。綠燈：同一命令 exit 0，`長名稱截斷為 210 bytes 並帶雜湊，短名稱檔名不變`。
3. ✅ **SCN-002、SCN-003：撤回新筆記**（設計 B）— 相依：無
   - 產出：`memory-note.ts`、`memoria.ts`；`test-cli-memory.sh` 用 `chmod 555 knowledge/Skills` 製造 I/O 失敗。
   - 完成判準：紅燈是失敗後 DB 仍有 session，重試回 `created:false`；綠燈是 DB 中沒有這筆、恢復權限後重試 `created:true`，既有筆記 A 完整保留。以 root 執行時 chmod 擋不住寫入，此時測試要明確略過並印出原因，不能當成通過。
   - 證據（2026-11-10，工作區，非 root）：單迴圈合併，理由同步驟 2。紅燈：`bash scripts/test-cli-memory.sh` exit 1，`✗ 失敗的新筆記仍留在 sessions`。綠燈：exit 0，`失敗的新筆記已撤回，重試完整寫入；既有筆記 A 保留`。殘餘：撤回只回滾 DB。失敗前已寫入的 Daily 筆記段落不會撤回，重試時會再附加一段；Daily 只是可讀的日誌，recall 與向量都不讀它。
4. ✅ **SCN-004：ingest 跳過未變更列**（設計 C）— 相依：無（TBD-1 已於 2026-11-10 解決）
   - 產出：`vector-ingest.mjs`；`test-vector-recall.sh`。
   - 完成判準：紅燈是同一份 payload 重複 ingest 時 `embedded` 不為 0、沒有 `unchanged` 欄位；綠燈依 SCN-004 的每一條。既有斷言 `embedded!==3`（重複 ingest 同一份 payload 的那兩處）依 TBD-1 改成新語意，並記錄理由：核准的行為已經變更。「等鎖」案例要改成 payload 至少有一列需要寫入，否則 ingest 不寫入、不會碰到鎖，測試會在沒有測到等鎖的情況下變綠。
   - 證據（2026-11-10，工作區）：helper 只能透過 CLI 執行觀察，合併為單迴圈。紅燈：`bash scripts/test-vector-recall.sh` exit 1，`Error: re-ingest of the same payload must embed nothing: {"ok":true,"embedded":3,"skipped":1}`。綠燈：exit 0，`same payload -> embedded=0 unchanged=3; one changed + one new -> embedded=2 unchanged=2`，等鎖案例 `ingest finished after the lock was released`。測試契約變更：等鎖案例原本斷言 `embedded===3`，改成先刪掉 ghost 列，再斷言 `embedded===1 && unchanged===2`。理由是核准的行為已變更（TBD-1）：同一份 payload 重複 ingest 不再寫入，原斷言測的是舊語意；先刪一列，ingest 才有一筆要寫、才會真的去等鎖。快取依賴案例（`INGEST25`）寫入的是全新的向量庫，`embedded===3` 不變。
5. ✅ **SCN-005：doctor tree index 與修法前綴**（設計 D）— 相依：無
   - 產出：`doctor.ts`；`test-vector-recall.sh` doctor 段新增「有沒有節點的 session」與「沒有缺口」兩組。
   - 完成判準：紅燈是目前 doctor 沒有 `tree index` 這一項；綠燈是執行印出的修法後兩個 missing 都是 0，沒有缺口時修法字串與變更前相同。
   - 證據（2026-11-10，工作區）：單迴圈合併，doctor 的檢查只能從 CLI 輸出觀察。紅燈：`bash scripts/test-vector-recall.sh` exit 1，`Error: 沒有 tree index 這一項: MEMORIA_HOME, memory dir, …, vector coverage`。綠燈：exit 0，`有缺口 -> tree index 失敗、修法先 index build，執行後兩者 missing=0；只缺向量 -> 修法不變`。修法在 `env -u MEMORIA_HOME` 下用 `sh -c` 原樣執行，證明它自帶資料根。
   - 精煉（code-simplify，2026-11-10）：只改 `treeIndexCheck`，替 `coverage` 補上型別、註明 catch 退路的理由，沒有行為變更。重跑 `test-vector-recall.sh` exit 0、`test-cli-memory.sh` exit 0。其餘變更沒有可證明更清楚的寫法，維持原狀。
6. ✅ **SCN-006：維護者機器量測**（觀測式，local embedding，CI 不跑）— 相依：步驟 4、5
   - 產出：本檔記錄命令、時間、數值。
   - 做法：把 `~/.memoria/.memory` 複製到 scratchpad 當成資料根，不碰真實資料根；從副本的向量庫刪掉 2 列後跑 doctor 印出的修法並計時。再刪 2 列，同時啟動 4 支 ingest 並計時。
   - 對照組：變更前，同一份語料一次修法約 3.5 分鐘（2026-11-10 觀測）。跳過策略失效時，時間會回到分鐘級，超過 30／60 秒的門檻而變紅，判準與失敗模式有交集。
   - 完成判準：修法 ≤ 30 秒且 `embedded=2`；4 支並行都在 60 秒內 exit 0；兩次之後 doctor 都是 `missing=0`。
   - 證據（2026-11-10 12:24 起，維護者機器 12 核 30GB，工作區版本，`MEMORIA_EMBED_PROVIDER=local`）：資料根是 `~/.memoria/.memory` 兩個 DB 以 `sqlite3 .backup` 複製到 scratchpad 的副本，2183 筆可 embed 實體。每輪先刪掉 2 筆 `decision:` 向量列，再從 `doctor --json` 取出 vector coverage 修法，用 `sh -c` 原樣執行。

     | 情境 | 結果 | 判準 |
     |---|---|---|
     | 單次修法 | `/usr/bin/time` wall 1.29 s、maxrss 637MB；輸出 `{"ok":true,"embedded":2,"unchanged":2181,"skipped":1002}`；之後 doctor `embedded=2183 expected=2183 missing=0` | ≤ 30 s，通過 |
     | 4 支並行 | 每支 wall 1.74～1.78 s、rc=0、各自 `embedded=2`；整組 1.79 s；之後 doctor `missing=0` | ≤ 60 s，通過 |
     | 對照組：已安裝的 v1.36.1 helper，同一副本、同樣缺 2 筆 | wall 135.10 s、maxrss 2.63GB；輸出 `{"ok":true,"embedded":2183,"skipped":1002}` | 舊行為會超過 30 s 門檻，證明判準量得出失敗 |

     反向自檢：跳過策略失效時，每次都會重 embed 2183 筆，對照組顯示這要 135 秒，超過門檻而變紅；`embedded=2` 的斷言也會變成 2183。
7. ✅ **常青文件與地雷**— 相依：步驟 2～5
   - `docs/OPERATIONS.md`：改寫「Several sessions can run this at once」一段，原本「every ingest still embeds and writes the whole corpus」已不成立；補上換模型要先刪 `vectors.db`；tree index 缺口改由 doctor 引導。
   - `skills/memoria-vector/README.md`：跳過未變更列、輸出欄位、換模型的作法。
   - `docs/CLI.md`、`docs/CLI.zh-TW.md`：doctor 檢查項目有列舉時才補 `tree index`。
   - `docs/agents/project.md`：地雷 M-3（半寫入筆記讓 vector coverage 永遠補不完，各 agent 收尾反覆全量重 embed），證據連到本 issue。
   - 完成判準：上述文件的敘述與實作一致，雙語文件同步。
   - 證據（2026-11-10）：`docs/OPERATIONS.md`（跳過未變更列、tree index 引導、並行量測、換模型）、`skills/memoria-vector/README.md`（ingest 行為與輸出欄位、`MEMORIA_EMBED_MODEL` 的注意事項）、`docs/agents/project.md` 地雷 M-3。`docs/CLI.md`、`docs/CLI.zh-TW.md` 沒有列舉 doctor 的檢查項目，不需更新；OPERATIONS 沒有 zh-TW 版本。
8. ✅ **CI 對齊與交付**— 相依：全部
   - 依根目錄 `AGENTS.md`「CI Parity Checklist」：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check`，以及 core、http-mcp 兩組（至少含 `test-cli-memory`、`test-smoke`、`test-memory-attributes`、`test-vector-recall`、`test-setup-onboarding`）。
   - 完成判準：命令與結果記在本步驟；`detect_changes` 只涉及上列檔案。
   - 證據（2026-11-10，工作區，`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER`，與 CI 一樣沒有向量環境變數）：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 全數 PASS。core、adapters、wiki、http-mcp、repo、npm-install 六組，共 35 支 `scripts/test-*.sh` 全數 PASS。
   - 環境注意：第一次跑時繼承了維護者 shell 的 `LIBSQL_URL=file:~/.memoria/.memory/vectors.db`，`test-ui-http` 因此 FAIL（`ui-http-driver.mts:68`，vector 模式讀到真實向量庫，`fallback_used` 為 false）。拿掉變數後 PASS，這次沒有改到 recall 路徑。真實資料根的兩個 DB 最後修改時間仍是測試前的 12:04／12:05，doctor `missing=0`。
   - `detect_changes`（scope all）：risk 顯示 critical。實際改到的 symbol 是 `extractSkills`（只改檔名那一行）、`rememberNote`、doctor 的 `vectorChecks`／`ingestFix`／`registerDoctorCommand`、`previewSync`、`vector-ingest.mjs`。`queryStats`、`stableStringify`、`shortHash`、`resolveSessionId`、`recordNoteProvenance` 被列為 touched，是新函式插在相鄰位置造成的行號位移；`git diff -U0` 顯示 `utils.ts`、`telemetry.ts`、`memory-note.ts` 都只有新增、沒有刪除。範圍與 README「涉及檔案」一致。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| doctor 回報缺 2 筆並執行修法 | 約 3.5 分鐘、2.6GB；殘骸存在時永遠補不完 | 秒級；修法先補 tree index |
| 長名稱 skill 筆記 | `ENAMETOOLONG`，留下殘骸 | 成功，檔名截斷加雜湊 |
| ingest 輸出 | `{"ok":true,"embedded":2183,"skipped":0}` | `{"ok":true,"embedded":2,"unchanged":2181,"skipped":0}` |

## 測試策略

| 驗收 | 層級 | 入口 |
|------|------|------|
| SCN-001～003 | CLI 端到端（外迴圈與內迴圈同層，合併紅燈：行為只透過 `remember` 這個命令觀察得到，沒有額外的整合面） | `scripts/test-cli-memory.sh` |
| SCN-004 | helper 端到端，stub provider | `scripts/test-vector-recall.sh` |
| SCN-005 | CLI 端到端，stub provider | `scripts/test-vector-recall.sh` doctor 段 |
| SCN-006 | 觀測式，維護者機器 local provider | 步驟 6 的手動量測 |

## 檢查清單

- [x] 每個 Scenario 都有紅燈與綠燈證據（SCN-006 為觀測紀錄加對照組）
- [x] 修改既有測試斷言時已記錄理由
- [x] GitNexus impact 與 detect_changes 已執行
- [x] 常青文件與地雷 M-3 已更新
- [x] SCN-004 已核准（TBD-1，2026-11-10）後才開始步驟 4
