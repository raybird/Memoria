# 審查報告
- 範圍：完整 PR（`79b40b5..d34b352`）；重點為第三輪增量 `672265d..d34b352`（單一提交 d34b352，處理 review-680ed91 的 N-a～N-g，依 README TBD-7）
- Reviewed BASE SHA：79b40b551aa1ff9d03f95122b3946e4930e2651a
- Reviewed HEAD SHA：d34b35220ecf972985be2cdb536ec1310442e842
- Reviewed patch-id：ac90243dbf16e3c745714fc09f47733bd9cefdd4（`git diff 79b40b5 d34b352 | git patch-id --stable`，審查者重算相符）
- 獨立 reviewer：Claude 獨立 subagent（非實作者），2026-11-18
- Review artifact：docs/issues/issue-33/review-d34b352.md
- 風險：Medium／High（README `**風險**`：High；`withDb`、`initDatabase` CRITICAL，`withCrossProcessSyncLease` HIGH）

前兩輪報告：[review-9d76366](./review-9d76366.md)（RETURN，M1）、[review-680ed91](./review-680ed91.md)（PASS，N-a～N-g）。本輪增量碰到的檔案（`src/core/db/sync.ts`、`src/core/memoria.ts`、`scripts/daily-race-driver.mts`、`scripts/test-repo-edge.sh`、`scripts/test-cli-memory.sh`、issue 文件）全部重新判斷，沒有沿用前一輪結論；增量以外的部分沿用前兩輪的查核，並以本輪全清單重跑確認沒有回歸。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE

- **R3-a. 超大 TTL 測試只看 stderr，不檢查 sync 是否成功，失敗時看不到原因** — `scripts/test-repo-edge.sh:305-308`
  - 影響：`HUGE_TTL_OUT=$(… 2>&1 >/dev/null)` 丟掉 stdout，也不斷言 exit code 或 `ok: true`。sync 失敗時 `set -e` 會讓腳本在這一行直接以 1 結束，但錯誤訊息被收進變數，畫面只剩段落標題，不好診斷（不會假綠，因為 `set -e` 仍讓它紅）。另外判準綁在 Node 印出的 `TimeoutOverflowWarning` 上：執行環境若帶 `NODE_NO_WARNINGS=1`，即使計時器溢位這個斷言也會是綠的（證據持久力，不是假綠燈；目前 CLI shim 與 CI 都沒有壓掉警告，審查者已實測紅燈有效）。
  - 建議：把 stdout 寫到檔案並斷言 `d.ok === true`；指令前加 `env -u NODE_NO_WARNINGS`；斷言失敗時印出 `HUGE_TTL_OUT`。

- **R3-b. 等待租約的輪詢失敗時沒有收掉背景 sync** — `scripts/test-repo-edge.sh:285-290`
  - 影響：200 次都沒看到租約時，`assert_eq` 以 1 結束（行為正確，會紅、不會掛住，也不會在前提不成立時繼續跑），但背景的慢 sync（`PID_RA`）還在跑，EXIT trap 同時刪除 `TMP_DIR`，那個程式之後會對已刪除的目錄報錯。每次輪詢都另開一個 node，最壞約 20～30 秒才判定失敗。只影響失敗路徑的整潔度。
  - 建議：前提斷言失敗前 `kill "$PID_RA"`；或不處理。

## 已查核維度

### 驗收與證據

| 編號 | 證據位置 | 本輪查核 | 結論 |
|---|---|---|---|
| SCN-001～004 | `scripts/test-repo-edge.sh`；計畫步驟 1～3、8 | 增量未改這幾段斷言；審查者在 d34b352 重跑 `test-repo-edge.sh` exit 0 | 有效 |
| SCN-002（HTTP 409） | `scripts/test-repo-promotion.sh`；步驟 3、8（N2） | 增量未觸及；全清單重跑 PASS | 有效 |
| SCN-005 | `scripts/test-cli-memory.sh`、`scripts/daily-race-driver.mts`；步驟 5、8、9 | 審查者重跑：HEAD 30 輪綠（cli-memory 內）、另 3 × 30 輪綠；以 HEAD driver 搭配 9d76366 的 `wx` 版 `sync.ts` 20 輪中 3 輪紅（`15 entries, 1 headers for 16 sessions`），driver 的鑑別力在增量後仍在；逐位元組比對照舊綠 | 有效 |
| SCN-006 | `scripts/test-cli-memory.sh`；步驟 4、8、9 | 審查者重跑：持有 2 秒成功、8 秒時 8031ms 以 `database is locked` 失敗、沒有留下筆記，落在核准的 5～10 秒 | 有效 |
| 續約（TBD-6，非 SCN） | `scripts/test-repo-edge.sh:271-301`；步驟 8、9（N-b） | 見下方紅綠重跑 | 有效 |

**審查者親自重跑的紅綠燈**（`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`，`TMPDIR` 指到 scratchpad；每次暫時改動後都以 `git checkout` 還原並重新 build）：

1. **N-d 紅燈**：把 `Math.min(ttlMs / 4, MAX_TIMER_MS)` 改回 `ttlMs / 4` 後 build，`test-repo-edge.sh` exit 1：`✗ no timer overflow with a huge test TTL: expected '0', got '1'`。還原後 exit 0、`✓ no timer overflow with a huge test TTL`。與步驟 9 證據相符。
2. **N-b 鑑別力**：把續約間隔改成 `MAX_TIMER_MS`（等於不續約）後 build，連跑 2 次都是 exit 1：`✓ the slow sync holds the lease before the second one starts`、`✓ the slow sync really outlived the TTL`，接著 `✗ renewed lease: …`，差異只在 `head_changed=2`（對照為 1）。輪詢前提成立後測試仍抓得到沒有續約。與步驟 9 證據相符。
3. **N-c 殘留檢查**：讓 `finally` 不刪暫存檔，新 driver 3 輪全紅：`6 entries, 1 headers for 6 sessions, 6 non-.md files left in Daily/`；672265d 的舊 driver 也紅，但原因是 `12 entries, 7 headers`（贏得 link 的暫存檔與正式檔同 inode，被重複計數），與步驟 9 對「巧合而非真的在檢查殘留」的說明一致。
4. **N-c 掛住**：在 driver 的暫時副本讓第一個子程式在 warm-up 前丟錯。新 driver 602ms 後 exit 1：`✗ round 1: a writer exited with 1 before it was ready`；舊 driver 在 `timeout 20` 下 exit 124（一直掛到被殺）。事後 `ps` 確認兩者都沒有遺留子程式。副本已刪除。
5. **N-a 提早 return**：`strace -f -e trace=openat,link,unlink,access,…` 追蹤兩次 `remember`：第一次（Daily 不存在）暫存檔相關呼叫 3 個（建立、link、unlink），第二次（已存在）0 個。與步驟 9 證據相符。
6. **N-a 錯誤路徑（步驟 9 記為「無自動化測試，靠程式碼審閱」，審查者以注入補驗）**：在 scratchpad 寫一支 tsx 探針，直接 patch `node:fs/promises` 預設匯出的 `writeFile`／`link`／`rm` 後呼叫匯出的 `syncDailyNote`：
   - 暫存檔寫入寫了一半後丟 `EIO`：`syncDailyNote` 以 `EIO` reject，Daily 目錄為空（半寫的暫存檔被清掉，也沒有建出不含檔頭的正式檔），沒有警告。
   - `rm` 丟 `EBUSY`：resolve，正式檔有檔頭與 1 筆條目，留下 1 個暫存檔，1 則警告。
   - `link` 丟 `EPERM`（模擬沒有 hard link 的檔案系統）：退回 `wx`，正式檔有檔頭與 1 筆條目，暫存檔已刪。
   - 暫存檔寫入 `EIO` 且 `rm` `EBUSY`：仍以原本的 `EIO` reject（`rm` 的錯誤沒有蓋掉它），1 則警告。
   這是審查用的一次性探針，沒有加進 repo；路徑本身沒有自動化回歸測試，已在步驟 9 揭露，不構成缺失。

**CI 對照清單**：見下方「全清單重跑」。

### 相關失敗面（增量）

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| `fs.access` 看到 Daily 已存在就 return（`sync.ts:37`） | 已存在的檔案一定已含檔頭，直接附加不會被檔頭覆蓋 | 程式碼查核：在 link 路徑上，正式檔只會經 `fs.link` 原子地出現，出現時就已含檔頭，所以「看得到」蘊含「有檔頭」。access 與 link 之間檔案才出現時，link 得到 `EEXIST` 而 return，同樣安全。SCN-005 driver 3 × 30 輪綠；`wx` 版 20 輪中 3 輪紅，鑑別力仍在 | 不會重開競態 |
| 沒有 hard link 的檔案系統（`wx` fallback）＋ 提早 return | 已知較窄的競態：`wx` 建出空檔到寫完檔頭之間，別人可能先附加 | 程式碼查核：改動前，後到者寫暫存檔 → link 失敗 → `wx` 得到 `EEXIST` → 附加，觀察到「已存在」的時間窗相同；提早 return 只是更早觀察到，並沒有放大這個窗口。注入 `EPERM` 實測 fallback 可用 | 與前一輪相同的已揭露限制，沒有變差 |
| `fs.access` 因 `ENOENT` 以外的原因失敗（例如 `EACCES`） | 不吞錯 | 視為不存在而往下走，接著寫暫存檔時拋出真正的錯誤 | 可接受 |
| 暫存檔寫入失敗（`sync.ts:41`，已移進 `try`） | 錯誤往外拋、不留下暫存檔、不建出無檔頭的正式檔 | 注入實測（上方第 6 項） | 通過；寫入失敗不會走到 `wx` fallback，與改動前相同 |
| `finally` 中 `rm` 失敗（`sync.ts:57-59`） | 只警告；成功的建檔不變成失敗；失敗的建檔保留原錯誤 | 注入實測。`.catch` 只包住 `rm` 這一個 promise，吞掉的範圍僅限刪除暫存檔；`rm` 帶 `force`，`ENOENT` 本來就不報 | 通過。留下的暫存檔與正式檔同 inode，之後的附加也會出現在它身上；`wiki-build` 只收 `.md`（`src/core/wiki-build.ts:45`），`export` 不讀 knowledge 目錄，不影響行為 |
| 續約間隔上限（`memoria.ts:168`、`:222`） | TTL／4 超過 `2^31-1` 時不溢位成每 1ms 續約 | 紅綠實測（上方第 1 項）。`ttlMs` 極大到讓 `new Date(now + ttl)` 無效（約 > 8.6e15）時 `toISOString` 會拋錯，但 `MEMORIA_REPO_SYNC_LEASE_TTL_MS` 是只給測試用、不寫進文件的變數，正式路徑固定 60 秒 | 通過；極端值只影響測試用變數 |
| driver：子程式在 ready 前結束（`daily-race-driver.mts:47-54`） | 該輪紅燈、不掛住、不留子程式 | 實測（上方第 4 項）。ready 之後原本那個 `exit` listener 的 reject 落在已 resolve 的 promise 上，是 no-op；`catch` 中先對每個子程式 `kill()`（同步送 SIGTERM）再 `process.exit(1)`，已結束的子程式 `kill()` 無副作用 | 通過 |
| driver：子程式在送出 ready 之後掛住 | 理想上逾時 | 未處理，改動前也一樣，不在 N-c 範圍；CI job 有整體逾時 | 殘餘限制，不列為發現 |
| driver：每輪殘留檔檢查 | 每輪都要抓到非 `.md` 的檔案 | 實測（上方第 3 項）；取代 shell 端只檢查最後一輪的那段（`test-cli-memory.sh` 移除兩行），新檢查是舊檢查的超集 | 通過 |
| 續約測試：輪詢 200 次都沒看到租約（`test-repo-edge.sh:285-290`） | 不應在前提不成立時繼續，產生沒有鑑別力的綠燈 | 迴圈結束後再斷言一次，`assert_eq` 不相等就 `exit 1`；`db_at` 失敗時 `$(…)` 為空，只會讓比較不成立，不會觸發 `set -e` 中斷迴圈 | 通過；失敗路徑的整潔度見 R3-a、R3-b |
| 續約測試：輪詢讀到別的租約 | 不會誤判 | `RENEW_HOME` 是這段專用的新資料根，此時只有慢的 sync 在跑 | 通過 |
| 超大 TTL 的 sync 是否真的建立計時器 | 必須走到 `setInterval` 才有鑑別力 | 非 dry-run 的 sync 一定先取得租約再建立 heartbeat；紅燈實測證實 | 通過；持久力見 R3-a |

### 需求、架構、安全、品質

- **需求**：增量只處理 N-a～N-g，與 README TBD-7 的使用者決定一致；沒有改到 SCN 的可觀察行為，沒有新增命令、旗標或使用者文件中的環境變數，不需要重新核准規格。
- **架構**：`createDailyNoteWithHeader` 仍是 `sync.ts` 的私有函式，只被 `syncDailyNote` 呼叫（GitNexus impact：LOW，d=1 只有 `syncDailyNote`）。`withCrossProcessSyncLease` 只改間隔的計算式（HIGH 風險符號，改動面最小）。核心層以 `console.warn` 回報非致命錯誤，與同檔既有的租約續約／釋放警告一致；CLI `--json` 的 stdout 不受影響。
- **GitNexus**：`detect_changes`（compare，base `672265d`）列出的程式符號為 `createDailyNoteWithHeader`、`withCrossProcessSyncLease`、`performRepoSync`、`envMs`、`extractDecisions`、`MemoriaCore`。審查者對照 diff：實際 hunk 在 `createDailyNoteWithHeader` 本體、`MAX_TIMER_MS` 常數（位於 `envMs` 上方）、heartbeat 間隔與 `performRepoSync` 上方註解；`envMs`、`extractDecisions` 只是與 hunk 相鄰。與步驟 9 的說明相符。
- **安全／權限／依賴**：無新依賴；暫存檔名含 pid 與 UUID、位於同一個 Daily 目錄，沒有新的路徑注入面。
- **品質（code-simplify 標準）**：
  - 跨 Task 重複：driver 對每個檔案讀兩次（`daily-race-driver.mts:67`、`:71-72`）是既有寫法，步驟 9 已記錄不在範圍；不影響正確性。兩個租約輪詢迴圈刻意分開唯讀與寫入（步驟 7／TBD-6 的 N7 決定），本輪沒有新增重複。
  - 過度設計：`createDailyNoteWithHeader` 的巢狀 `try` 是為了讓 `finally` 同時涵蓋寫入失敗與 link／fallback 兩段，扁平化會把清理重複寫兩次，目前結構合理。`MAX_TIMER_MS` 為單一常數加註解，大小適中。
  - 註解：`sync.ts:35-36`、`:55-56` 與 `memoria.ts:167`、`:1039-1042` 的說明都與實際行為一致；N-e 改後的 dry-run 註解前後不再矛盾（程式內的 `withRepoSyncLock` 讓 dry-run 不在同程式的 sync 中途開始，跨程式則只等待、不持有租約）。
- **文件**：計畫設計方案 C（`implementation-plan.md:93`）與步驟 5（`:135`）已註明由步驟 8 取代；「使用方式對照」表已移到步驟之後（`:187`）；步驟 9 證據對每一項 N 的描述，與審查者重跑的結果相符（N-d、N-b、N-c 兩種、N-a strace）。步驟 9 也揭露了錯誤路徑沒有自動化測試、`npx gitnexus analyze` 會改寫 AGENTS.md／CLAUDE.md 已還原。常青文件（`docs/agents/architecture.md:53`）對 Daily 建檔的描述仍正確，提早 return 是實作細節，不需更新。

### 全清單重跑

2026-11-18，被測版本 d34b352（工作區乾淨，暫時改動全部還原後重新 `pnpm run build`），`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`、`TMPDIR` 指到 scratchpad：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check`，加上 core 10 支、adapters 5 支、wiki 4 支、http-mcp 5 支、repo 8 支，共 37 項全部 exit 0。其中 `test-cli-memory.sh` 41 秒（driver `30 輪、每輪 16 個程式…沒有殘留暫存檔`、SCN-006 8031ms），`test-repo-edge.sh` 14 秒。與步驟 9 宣稱的「37 項全部 PASS」相符。npm-install、node18-smoke、release 三個 CI job 不在本機清單內，本輪未跑（增量未碰安裝與打包路徑）。

### 豁免、待確認與限制

- 豁免：無 Gate 豁免紀錄。
- 待確認：TBD-1～7 都是「已解決」，維持原狀態；本輪沒有新的 `需決策` 項目。
- 限制（已由實作者或審查者揭露，不構成缺失）：
  - `wx` fallback（沒有 hard link 的檔案系統）仍有已知較窄的競態，沒有自動化測試。
  - 暫存檔寫入失敗、刪除失敗兩條路徑沒有自動化回歸測試；審查者以一次性注入探針驗證行為正確。
  - Windows 未實測（沿用 review-680ed91 的限制）。
  - driver 不處理子程式在 ready 之後掛住的情況（改動前即如此）。
  - 本機 `/tmp` 為 tmpfs；本輪測試的 `TMPDIR` 指到 scratchpad（同樣在 `/tmp` 下）。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA。之後在這個分支提交 issue README 記帳區段與本報告以外的檔案（例如交接文件），PASS 會失效、需要重新審查（流程契約 2.3 以下只有單獨新增本報告的提交可沿用）；提交前先告知使用者，由使用者決定做法。
