# 審查報告（第二輪）
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main）；重點為第一輪之後的差異 `6ff02ab..680ed91`
- Reviewed BASE SHA：79b40b551aa1ff9d03f95122b3946e4930e2651a（`git merge-base main 680ed91`）
- Reviewed HEAD SHA：680ed913883768be2dbdcfdb6cf966e56cc8cee8
- Reviewed patch-id：7e1d1a92221beb6f7e556070cc737cbc281d794b（審查者以 `git diff 79b40b5 680ed91 | git patch-id --stable` 重算，與協調者提供的值相同）
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-33/review-680ed91.md
- 核准基線：`**核准 commit**` 已在 6ff02ab 回填為 `9d76366`（9d76366466b45de3146264f77e82ea1e19b0d45a）。`git diff 9d76366 680ed91 -- docs/issues/issue-33/README.md` 沒有任何落在 `## Gherkin 驗收劇本`（第 56～113 行）的 hunk，核准表的 SCN-001～006 與日期、狀態也都沒有變。變更只有以下幾處：「關鍵差異」表 Daily 列的措辭改寫成實作手法（新檔以 hard link 建立），條件與結果「直接附加、檔頭只建立一次」不變；「涉及檔案」補列檔案；TBD-6 新增一列；Timeline 新增兩列；`**核准 commit**`、`**狀態**` 改值。依 acceptance.md「規格修訂的查核」，這些都沒有改變條件、動作或結果，原核准有效，不需要重新核准。

審查日期：2026-11-18

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-a. 暫存檔在兩條路徑上仍可能留下，或讓成功的建檔變成失敗** — `src/core/db/sync.ts:36`、`src/core/db/sync.ts:49`
  - `fs.writeFile(staging, …)` 在 `try` 外面。檔案已建立但寫入失敗（例如 `ENOSPC`）時直接丟錯，暫存檔不會被刪。行程在 writeFile 與 rm 之間當掉，也會留下暫存檔。
  - 影響很小。唯一會列舉 `knowledge/Daily` 的是 `wiki-build.ts:43-45` 的 `syncFilesystemPages`，它只收 `.md`，而暫存檔名以 `.tmp` 結尾，不會被收進 wiki。prune 只清 `.memory/exports` 與 `checkpoints`，UI、brief、export 都不列舉 Daily 目錄，所以留下的只是雜檔。
  - `finally` 裡的 `fs.rm` 如果丟錯，例如 Windows 上被防毒軟體暫時鎖住、回 `EBUSY`／`EPERM`，會蓋掉已經成功的 link，`remember` 因此失敗。`force` 只會忽略 `ENOENT`。
  - 建議：把 writeFile 移進 `try`；`rm` 包 try/catch 並 `console.warn`，或加 `maxRetries`。
  - 另外，每次 `remember` 都會寫一次、刪一次暫存檔，即使 Daily 早已存在，大多數呼叫都是這種情況。若要省下這些 I/O，可以先 `fs.access(notePath)`，檔案已存在就略過。link 本身會處理 `EEXIST`，所以這個捷徑不會打開競態。
- **N-b. 續約測試靠固定的 0.8 秒錯開，假設慢的 sync 已經先拿到租約** — `scripts/test-repo-edge.sh:283`
  - 如果機器忙到 A 在 0.8 秒內還沒取得租約，B 沒有經過 shim，會先跑完；A 之後的 sync 沒有新東西可寫。這時所有斷言照樣通過，`>4000ms` 也成立（git 呼叫照樣慢），但這次執行證明不了續約。測試不會因此變紅，而是在那一輪失去鑑別力，屬於證據持久力問題。
  - 審查者實測，從啟動到租約那一列出現：12 核約 110ms，`taskset -c 0` 單核約 220ms。輪詢本身的解析度約 80ms，所以 0.8 秒有 3～7 倍餘裕。
  - 若要更穩：把 `sleep 0.8` 改成輪詢 `git_sync_leases` 直到出現一列再啟動 B，順序就由狀態決定，而不是時間。
- **N-c. driver 的強健度** — `scripts/daily-race-driver.mts:46`
  - 子程式如果在送出 `ready` 前就結束（例如 warm-up 丟錯），父程式的 `once('message')` 永遠不會 resolve，測試會掛住，直到 CI job 逾時，而不是紅燈。建議同時監聽 `exit`。
  - 「Daily 沒有殘留暫存檔」只在 shell 端檢查最後一輪（`test-cli-memory.sh:360`）。driver 每輪都會清掉目錄，中間輪次留下的暫存檔看不到。driver 內 `headers !== files.length` 的判斷也擋不到暫存檔，因為暫存檔本身帶有檔頭。可以改成每輪檢查 `files.every(f => f.endsWith('.md'))`。
- **N-d. `ttlMs / 4` 沒有上限** — `src/core/memoria.ts:220`
  - 測試用變數設成超過約 8.6e9 時，間隔會超過 2^31-1，Node 會發出 `TimeoutOverflowWarning` 並改成 1ms，變成每毫秒續約一次。這個變數只給測試用、沒有寫進文件，預設值 15000 不受影響，屬於邊角情況。
- **N-e. N6 改後的註解前後有一點矛盾** — `src/core/memoria.ts:1038-1040`
  - 前句說 dry-run「never preview a half-written scan」，後句又說「a sync may start while a dry run is previewing」。後句正確揭露了跨程式的限制，但前句的 never 寫得太滿。可以改成「so they do not start in the middle of a sync in progress」。
- **N-f. 實作計畫步驟 5 仍描述 `wx` 寫法** — `docs/issues/issue-33/implementation-plan.md:86-91`
  - 作為歷史紀錄可以保留，步驟 8 也寫了新做法。可以在步驟 5 補一句「已由步驟 8 取代（review-9d76366 M1）」，免得讀者只看步驟 5 就誤解目前的實作。
- **N-g. 步驟 8 沒有記錄第二輪改動的 GitNexus impact 或 detect_changes**
  - 審查者以 `detect_changes(scope=compare, base_ref=6ff02ab)` 查詢，回報 critical。但列出的符號（`resolveManagedRepo`、`init`、`withResult`、`extractDecisions` 等）其實沒有改動，是索引過期造成的行號偏移誤判。實際改動的符號是 `syncDailyNote`、新增的 `createDailyNoteWithHeader`、`withCrossProcessSyncLease` 與 `gitErrorStatus`，審查者已逐一讀過程式碼並以測試確認。建議提交前依 AGENTS.md 重新建立索引（`npx gitnexus analyze`），再把結果記進步驟 8。不阻擋。

## 已查核維度

### 審查者實際執行的測試（2026-11-18）

以 680ed91 的 build 執行，全部用 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 啟動：

| 命令 | 結果 |
|---|---|
| `pnpm run check` | exit 0 |
| `pnpm run build`；`node dist/cli.mjs --help` | 成功 |
| `bash -n scripts/test-repo-edge.sh scripts/test-cli-memory.sh` | OK |
| `test-cli-memory.sh` | exit 0（43 秒）。driver：`30 輪、每輪 16 個程式在同一時刻寫入尚未存在的 Daily，條目與檔頭都完整`。SCN-006 8029ms |
| `test-repo-edge.sh` × 3 | 3 次都 exit 0（13～14 秒），含 `✓ takeover records what a sync with no stale lease records`、`✓ the slow sync really outlived the TTL`、`✓ renewed lease: …` |
| `taskset -c 0 test-repo-edge.sh`（單核，模擬較慢的 runner） | exit 0 |
| `test-repo-promotion.sh`、`test-wiki-build.sh`、`test-smoke.sh`、`test-http-api.sh`、`test-repo-sync.sh`、`test-migrations.sh` | 全部 exit 0 |

### 紅燈重現（scratchpad 的 `git archive 680ed91` 副本，node_modules 以 symlink 共用，主工作區未改）

- **M1 driver**：副本 `oldsync` 只把 `src/core/db/sync.ts` 換回 9d76366 版（`wx` 寫法）。
  - 整支 `test-cli-memory.sh` exit 1：`✗ 2/30 rounds lost or corrupted Daily entries`（`round 4: 15 entries, 1 headers for 16 sessions`）。
  - 另外單獨跑 driver（16 個 session × 30 輪）：12 核 5 次分別 7、4、8、8、11 輪壞；`taskset -c 0-1` 兩次 11、15 輪；`taskset -c 0-3` 兩次 9、10 輪。
  - 每輪壞掉的機率約 7%～50%，核心越少越高。以最低的 7% 估算，30 輪全綠的機率約 11%；以平均約 25% 估算，全綠的機率接近 0。CI runner 的核心較少，鑑別力只會更好。
  - 修正後的副本以同一個 home 跑 5 × 30 輪全綠（每次 16～18 秒），Daily 目錄只有 `.md`。修正後的正確性不依賴時間，沒有看到 flaky 的來源。
- **S1 續約**：副本 `norenew` 只把 `if (!renewSyncLease(...))` 改成 `if (false && !renewSyncLease(...))`。
  - `test-repo-edge.sh` 兩次都 exit 1：`✓ the slow sync really outlived the TTL`，接著 `✗ renewed lease: … expected '…head_changed=1…', got '…head_changed=2…'`。
  - `taskset -c 0` 單核同樣 exit 1。
  - 結論：這個測試確實需要續約才會綠；在較慢的機器上，紅綠兩邊的結果都不變。

### M1 修正（`createDailyNoteWithHeader`）的查核

- **會不會出現沒有檔頭的 Daily**：不會。正式檔名只透過 `link(2)` 出現，link 是原子操作，出現時 inode 已經含有 14 位元組的檔頭。其他寫入者拿到 `EEXIST` 後才 `appendFile`（O_APPEND），只會接在檔頭之後。`finally` 刪掉的是暫存的那個名稱，正式檔的 inode 不受影響。
- **只有一個寫入者時的位元組**：檔頭字串 `# ${date}\n\n` 與舊版相同。SCN-005 的逐位元組測試（期望值由 DB 欄位加既有格式獨立重組）通過。
- **沒有 hard link 的檔案系統**：任何非 `EEXIST` 的錯誤都退回 `wx`，行為等於第一輪的寫法，窄競態仍在。若是權限、`ENOENT` 等真正的錯誤，`wx` 也會丟出同樣的錯，由 `remember` 撤回。退回路徑只有幾行，不算過度設計，合理。
- **Windows**：NTFS 支援 `CreateHardLinkW`，libuv 把 `ERROR_ALREADY_EXISTS` 對應成 `EEXIST`；Node 開檔帶 `FILE_SHARE_DELETE`，刪掉暫存名稱不會被其他 handle 擋住。殘餘風險見 N-a（rm 被暫時鎖住）。審查者沒有在 Windows 上實測，記為限制。
- **暫存檔殘留**：見 N-a。所有會列舉 Daily 的程式都已用 grep 確認，殘留不會被收進 wiki，也不會被 prune 誤刪。
- **driver 是不是真的測試**：是。它直接呼叫匯出的 `syncDailyNote`，每個 session 一個程式，先 warm-up 開好連線，再以忙等讓所有程式在同一時刻開始。判準包括條目數等於 session 數、檔頭數等於檔案數、每個 session id 都在、每個檔案都以 `# ` 開頭。這些都與失敗模式（檔頭蓋掉 `\n## HH:MM - de`）直接相交，期望值來自 DB 的 session 清單，不是由實作重算，所以不是同義反覆。鑑別力的紅燈數據見上。強健度改善見 N-c。

### S1（續約）的查核

- 實作：`envMs('MEMORIA_REPO_SYNC_LEASE_TTL_MS', 60000)` 只套用正數；取得與續約用同一個 TTL，續約間隔 `ttlMs / 4`，預設值仍是 15000，與文件的 15s／60s 一致。
- 測試是否真的需要續約：是，見上方紅燈重現。
- 時間上的強健度：
  - A 的時間主要由 shim 的 0.4 秒乘以 git 呼叫次數決定，機器越慢只會越久，`>4000ms` 只會更容易成立。
  - 續約間隔 750ms 對 TTL 3000ms 有 4 倍餘裕。git 以非同步 spawn 執行，等待 git 時事件迴圈是空閒的，heartbeat 能準時觸發。
  - B 的等待上限 60 秒，遠大於 A 約 7 秒的時間。
  - shim 寫入 `command -v git` 的絕對路徑，並以 `%q` 引號處理；`git-exec.ts:108` 以 `spawn('git')` 加上 `...process.env` 執行，所以 PATH 上的 shim 確實生效（`outlived the TTL` 斷言成立就是證明）。
  - 0.8 秒錯開的殘餘弱點見 N-b，不會造成紅燈 flaky。
- 不寫進文件的測試變數：可以接受。這是使用者在 TBD-6 的決定，程式碼註解（`memoria.ts:199-201`）寫明用途；專案已有不寫進文件的內部變數先例（`MEMORIA_ADAPTER_STATE_DIR`）。

### S2（SCN-003 對照資料根）的查核

- 修正後的做法合理。對照資料根 `conc-control` 在 SCN-001 已經 sync 過一次同一個 fixture，這裡再做一個同樣訊息的 commit、sync 一次。受測資料根則經過 SCN-001 的兩個並行 sync（已斷言等於一次）、busy（什麼都不寫，已斷言）、dry-run（什麼都不寫，已斷言）與接手 sync。兩邊的歷史結構相同，`sync_shape` 只比較各類事件數、commit 數、ref 數與摘要數，與 SHA 和時間無關。
- 期望值來自另一份不經過租約的資料庫，不是同義反覆。
- 續約測試用的 `CTRL_SHAPE` 是 SCN-001 時存下的字串，不受後來對照資料根多 sync 一次的影響，也不會被這次修改污染。

### N2～N6 的查核

| 項目 | 修正 | 判定 |
|---|---|---|
| N2 | `server.ts:201-202` 把 `startsWith('repository_sync_busy')` 移到最前面，原本 409 那一行移除了重複的條件 | 正確。其他錯誤碼都不會誤中這個前綴；`test-repo-promotion.sh` 的 409 與 `test-http-api.sh` 的 404／400 都綠 |
| N3 | `memoria.ts:226-233` 釋放租約改成 try/catch 加 `console.warn` | 正確。sync 成功時不再被釋放失敗蓋掉；sync 失敗時原本的錯誤也不會被蓋掉 |
| N4 | `OPERATIONS.md:463-464` 補上「not a positive number … falls back to the default」 | 正確，與 `envMs` 的行為一致 |
| N5 | 計畫測試策略表改成 `test-repo-promotion.sh` | 正確 |
| N6 | `memoria.ts:1038-1040` 註解改寫 | 已處理，措辭還能再精確，見 N-e |
| `envMs` 重構 | `resolveSyncWaitMs` 改成通用的 `envMs(name, fallback)` | 對 `MEMORIA_REPO_SYNC_WAIT_MS` 的語意完全不變（`Number.isFinite && > 0`）；TTL 套用相同規則 |

### 第一輪發現的處理

| 第一輪 | 處理 | 判定 |
|---|---|---|
| M1 Daily 建檔時檔頭蓋掉並行附加的條目 | 改成暫存檔加 `fs.link`；新增 driver 測試 | 已修正，紅綠都由審查者重現 |
| S1 續約沒有自動化測試 | TBD-6 由使用者決定選項 (a)：測試用 TTL 變數加長 sync 測試 | 已修正，紅綠都由審查者重現 |
| S2 SCN-003 事件數只用代理指標 | 改成與對照資料根比較 `sync_shape` | 已修正 |
| N1 SCN-006 時間界線鎖不住 5 秒 | TBD-6：不處理（理由：由常數與行為不變的等價證據守住） | 依使用者決定，接受 |
| N2～N6 | 見上表 | 已修正 |
| N7 兩個輪詢迴圈可以抽共用函式 | TBD-6：不處理（刻意把唯讀與寫入分開） | 依使用者決定，接受 |

### 驗收覆蓋（SCN-001～006）

| SCN | 測試位置 | 證據 | 判定 |
|---|---|---|---|
| SCN-001 | `test-repo-edge.sh` SCN-001 段 | 第一輪已重現紅燈；本輪 3 次加單核 1 次都綠 | 通過 |
| SCN-002 | `test-repo-edge.sh` SCN-002 段；HTTP 409 在 `test-repo-promotion.sh` | 第一輪已重現紅燈；本輪兩支都綠；N2 改了判斷順序後 409 仍正確 | 通過 |
| SCN-003 | `test-repo-edge.sh` SCN-003 段 | 本輪綠；新增與對照資料根的比較（S2） | 通過。回歸測試的定位與第一輪相同 |
| SCN-004 | `test-repo-edge.sh` SCN-004 段 | 第一輪已重現紅燈；本輪綠 | 通過 |
| SCN-005 | `test-cli-memory.sh` 逐位元組、16 程式 CLI × 5 輪、driver × 30 輪 | 審查者以舊寫法重現紅燈（整支測試 exit 1，driver 9 次都紅）；修正後的 driver 6 × 30 輪全綠 | 通過。M1 已解決 |
| SCN-006 | `test-cli-memory.sh` SCN-006 段 | 本輪 8029ms，界線 4500～10500ms | 通過，N1 依決定不處理 |

另外，續約（README 自己點名的最大風險）由 `test-repo-edge.sh` 的續約段覆蓋，紅綠都已重現。

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| 16 個程式在同一時刻寫一個還不存在的 Daily | 16 筆條目、1 個檔頭，沒有殘留暫存檔 | driver 30 輪加目錄檢查；舊寫法紅、新寫法綠 | 通過 |
| 只有一個寫入者 | 與舊版逐位元組相同 | SCN-005 逐位元組測試 | 通過 |
| 檔案系統不支援 hard link | 退回 `wx`，行為等於第一輪 | 程式碼查核；沒有實測（需要 vfat 等掛載） | 可接受，記為限制 |
| 暫存檔寫入失敗或行程當掉 | 理想上不留下暫存檔 | 程式碼查核：會留下，但只有 wiki-build 會列舉 Daily，而它只收 `.md` | 不影響行為，N-a |
| Windows（NTFS） | link 加 `EEXIST` 的語意相同 | 程式碼與 libuv 行為查核；沒有實測 | 記為限制，N-a |
| 長 sync 超過 TTL | 續約，不被接手 | 續約測試；停用續約的副本會紅 | 通過 |
| 較慢的 CI | 續約測試不 flaky | 單核實測綠，停用續約的單核副本仍紅 | 通過；0.8 秒錯開的鑑別力弱點見 N-b |
| 釋放租約失敗 | 不蓋掉 sync 的結果 | 程式碼查核（N3） | 通過 |
| busy 錯誤訊息內的 repo 名稱含 `not_found` | 409 | 程式碼查核（N2） | 通過 |
| `MEMORIA_REPO_SYNC_LEASE_TTL_MS` 為非正數、非數字或極大值 | 回到預設；極大值時計時器溢位 | 程式碼查核 | 只給測試用，N-d |

### 需求、架構、安全、品質

- **需求**：SCN-005 在建檔競態下現在成立；其他 SCN 沒有退步。
- **架構**：改動都在 `src/core/db/sync.ts`、`memoria.ts` 與 `server.ts`；`git-scan.ts`、`git/` 沒有動，符合 README 的「不可觸及」。driver 沿用 `scripts/*-driver.mts` 加 `pnpm exec tsx` 的既有模式，沒有新增依賴。
- **安全**：暫存檔名用 pid 加 UUID，放在使用者自己的資料根，沒有可預測檔名可被利用的問題；沒有新增 SQL。
- **精煉**：`envMs` 合併合理，沒有過度設計。
- **常青文件**：`architecture.md:53` 的 Daily 描述已改成 hard link，與程式碼一致；`OPERATIONS.md` 已補 N4；`AGENTS.md`、API 文件不需要改。計畫步驟 5 的歷史描述見 N-f。
- **外部專案只用代稱**：審查者對完整 diff grep 已知的下游名稱，唯一命中是 `unmeasurable` 裡的子字串 `asura`，屬誤判；沒有真實名稱。

### 豁免、待確認與限制

- 沒有 Gate 豁免紀錄。TBD-1～6 都已解決；N1、N7 依 TBD-6 的使用者決定不處理。
- 限制：
  - 沒有在 GitHub runner、macOS 或 Windows 上實測，以單核與 2、4 核的 `taskset` 近似較慢的機器。
  - 沒有實測沒有 hard link 的檔案系統。
  - adapters、wiki（除 wiki-build 外）與 `test-ui-http.sh`、`test-mcp-e2e.sh`、`test-vector-recall.sh`、`test-memory-browser.sh` 沒有重跑，沿用計畫步驟 8 的完整 CI 清單紀錄。第二輪的改動沒有碰到這些路徑。
  - 紅燈重現副本與量測腳本留在 scratchpad（`/tmp/claude-1000/r2/`），沒有進版控。

## 流程判定
PASS

理由：第一輪的 M1、S1、S2 都已修正，審查者各自以停用修正的副本重現紅燈，並在修正後的版本連續取得綠燈；N2～N6 都已正確套用，N1、N7 依使用者決定不處理；SCN-001～006 與已辨識的失敗面都有證據；Gherkin 自核准基線 9d76366 以來沒有變更。剩下的只有 NICE TO HAVE。

PASS 只適用於上列 Reviewed HEAD SHA。之後在這個分支提交 issue README 記帳區段與本報告以外的檔案（例如交接文件），PASS 會失效、需要重新審查（流程契約 2.3 以下只有單獨新增本報告的提交可沿用）；提交前先告知使用者，由使用者決定做法。
