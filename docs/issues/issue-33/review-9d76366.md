# 審查報告
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main）
- Reviewed BASE SHA：79b40b551aa1ff9d03f95122b3946e4930e2651a（`git merge-base main 9d76366`）
- Reviewed HEAD SHA：9d76366466b45de3146264f77e82ea1e19b0d45a
- Reviewed patch-id：e7c20bc78497e4cf22886ac6be253240ccff5ec4（審查者以 `git diff 79b40b5 9d76366 | git patch-id --stable` 重算，結果相同）
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-33/review-9d76366.md
- 核准基線：9d76366466b45de3146264f77e82ea1e19b0d45a。推導命令：`git log -1 --format=%H -G '^[[:space:]]*([-*+][[:space:]]+)?\*\*核准來源\*\*[[:space:]]*(:|：)' 9d76366 -- docs/issues/issue-33/README.md`。輸出就是被審查提交本身，README 在該提交仍有符合同一 pattern 的 `**核准來源**` 欄位行，所以依 acceptance.md 的推導規則，這是有效基線。可追溯性的限制見「豁免、待確認與限制」：規格與實作在同一個提交進版控，核准內容只能追到對話紀錄。

審查日期：2026-11-18

## 問題與風險

### MUST FIX

**M1. Daily 筆記在建立當下仍會被另一個程式覆寫掉一筆條目的開頭** — `src/core/db/sync.ts:26-30`

- 機制：`fs.writeFile(notePath, header, { flag: 'wx' })` 在 Node 內部分成兩步：先 `open(O_CREAT|O_EXCL|O_WRONLY)`，再 `write`。這個 fd 沒有 `O_APPEND`，位置停在 0。如果另一個程式 B 在 A 的 open 與 write 之間拿到 `EEXIST`、把它的條目 `appendFile` 進當時還是空的檔案，A 接著把 14 位元組的檔頭 `# YYYY-MM-DD\n\n` 寫在 offset 0，蓋掉 B 條目的前 14 位元組，正好是 `\n## HH:MM - de` 這一段。B 的條目標題因此消失，內文殘留。
- 重現（審查者實測，2026-11-18）：
  - 機制層：scratchpad 腳本 `daily-race.mjs` 原樣照抄這兩個 fs 呼叫，讓 16 個程式在同一毫秒開始，跑 100 輪，**22 輪**只剩 15 個 `## ` 條目。檔案開頭為 `# 2026-11-18\n\nmo\n\nnote 7…`（`mo` 是 `demo` 的尾巴）。
  - 真實 CLI：`cli-race.sh` 照 SCN-005 測試的做法（每輪新的資料根、16 個 `memoria remember` 同時跑），用本分支 build 出的 `./cli` 跑 40 輪，**第 26 輪 entries=15**，檔頭同樣蓋在第一筆條目上（`# 2026-11-18\n\nmo\n\n並行 r26-11…`）。
- 影響：SCN-005「Daily 筆記一筆不少」在檔案建立時不成立。這正是本 issue 要修的掉資料情境：每個 UTC 日第一次 `remember` 時，只要有兩個程式同時寫就會觸發。另外，`scripts/test-cli-memory.sh:338` 這組 5 輪測試本身也會不定期失敗。以每輪約 1/40 估算，每次執行約有 12% 機率紅燈，CI 會偶發失敗。實作者的「連跑 10 次都綠」是 `test-repo-edge.sh` 的紀錄，不是這支。
- 建議：讓檔案在出現的那一刻就已經帶著檔頭。例如把檔頭寫進同目錄的暫存檔，再用 `fs.link(tmp, notePath)` 建立正式檔（`EEXIST` 代表別人先建好了，略過即可），最後在 `finally` 裡 `unlink(tmp)`，之後照舊 `appendFile`。審查者用同一個 100 輪 harness 測這個做法（`daily-link.mjs`），0 輪出錯；只有一個程式寫入時，產生的位元組與現在相同。修正後同步改 `docs/agents/architecture.md:53` 的「created with `wx`」描述。測試方面，建議另加一支能穩定重現的測試：用 node 直接呼叫匯出的 `syncDailyNote`，讓多個程式同時開始。以上面實測的每輪約 22% 計，20 輪幾乎一定會紅，修正前就能取得紅燈證據。

### SHOULD FIX

**S1. 續約（heartbeat）完全沒有自動化測試，而 README 把它列為最大風險** — `src/core/memoria.ts:206-217`；`docs/issues/issue-33/implementation-plan.md` 測試策略段

- 現況：現有測試的 sync 都在幾秒內結束，15 秒一次的續約從來沒有執行到。`renewSyncLease` 就算 SQL 寫錯或從未被呼叫，所有測試仍然全綠。計畫說租約邊界由 SCN-001、SCN-003 間接覆蓋，但這兩個都碰不到續約。
- 審查者手動驗證（2026-11-18）：在 scratchpad 的兩份副本中，把 TTL 改成 3 秒，一份每 1 秒續約，另一份等於不續約。再用 PATH 上的 git shim 讓每次 git 呼叫慢 0.4 秒，使 sync A 約需 6.6 秒，B 晚 0.8 秒啟動。
  - 有續約：B 等到 A 完成（A 6606ms、B 6730ms），事件與單獨 sync 相同（`head_changed=1`），沒有殘留租約。
  - 不續約：B 在約 3 秒時接手（B 3148ms 先完成），出現 `head_changed=2`。
  - 結論：目前實作的續約行為正確，這個實驗也分得出續約有沒有生效。缺的是能擋住回歸的自動化守門。
- `需決策`：要不要為了測試加一個 TTL／續約間隔的覆寫入口？
  - 選項 (a)：加一個不寫進文件、只給測試用的環境變數，例如 `MEMORIA_REPO_SYNC_LEASE_TTL_MS`，搭配 git shim 寫進 `test-repo-edge.sh`。
  - 選項 (b)：不改產品程式碼，把上面的手動實驗記進 implementation-plan 當作等價證據，接受沒有回歸守門。
  - reviewer 建議 (a)，因為這是 README 自己點名的停擺／重複寫入風險。若使用者不想新增任何環境變數，至少要做 (b)。

**S2. SCN-003 的「事件筆數與沒有殘留租約時相同」只用代理指標斷言** — `scripts/test-repo-edge.sh:257`

- 現況：只斷言 `new_commits=1`，沒有比較事件數。依 verification.md，這屬於證據持久力問題，不是假綠燈：接手是由目標行為驅動的，等待上限 20 秒、斷言少於 10 秒，若過期判定壞掉會紅。
- 建議：比照 SCN-001，接手前後取 `git_events` 依 event_type 分組的筆數差，與一份沒有殘留租約、做同樣新 commit 的對照資料根比較；或直接斷言已知的差值，例如 `commit_discovered +1`、`branch_head_moved +1`。

### NICE TO HAVE

- **N1. SCN-006 的時間界線鎖不住 5 秒這個值** — `scripts/test-cli-memory.sh:375-386`。鎖持有 8 秒時，總時間約等於 min(2T, 8 秒)。因此 busy timeout T 只要落在約 2.1～7.7 秒，所有斷言都會通過，「寫入等約 5 秒後放棄」這一段沒有被直接觀察到。行為不變這件事主要靠 `SQLITE_BUSY_TIMEOUT_MS = 5000` 常數與 better-sqlite3 預設值相同來保證（審查者已確認 `node_modules/better-sqlite3/lib/database.js:34` 的預設值是 5000，版本 11.10.0）。若要更穩，可以讓持有時間長到撤回也逾時（總時間約 2T），或另外量測單一 INSERT 放棄的時間。測試界線與修訂後的 Gherkin「總計約 5～10 秒」一致，不阻擋。
- **N2. `gitErrorStatus` 的判斷順序** — `src/server.ts:201-205`。busy 訊息內含 repository 名稱，而 `error.includes('not_found')` 排在前面。repo 名稱若含 `not_found`（例如 `page-not_found`），busy 會被回成 404。建議把 `startsWith('repository_sync_busy')` 移到最前面。其他錯誤都不會誤中 `startsWith('repository_sync_busy')`。
- **N3. 釋放失敗會蓋掉 sync 的結果** — `src/core/memoria.ts:222`。`finally` 裡的 `releaseSyncLease` 若因 `database is locked` 丟錯，已寫入成功的 sync 會回報失敗（或蓋掉原本的錯誤）。租約最多 60 秒後過期，影響有限。建議包 try/catch 並 `console.warn`，比照續約的處理。
- **N4. `MEMORIA_REPO_SYNC_WAIT_MS` 的 0、負數、非數字都靜默回到 120000** — `src/core/memoria.ts:169-172`。這與 `MEMORIA_GIT_TIMEOUT_MS` 一致，但設 0 想要「立刻失敗」的人會等 120 秒。建議在 `docs/OPERATIONS.md:463` 補一句「非正數或無法解析時用預設值」。
- **N5. 實作計畫的測試策略表過時** — `docs/issues/issue-33/implementation-plan.md:161` 寫 SCN-002（HTTP）在 `test-http-api.sh`，實際在 `test-repo-promotion.sh`（步驟 3 有說明這是等價的路徑選擇）。
- **N6. 註解「Dry runs … observe settled state」** — `src/core/memoria.ts:1028`。跨程式時，dry-run 確認租約空閒後，另一個程式可能立刻取得租約開始寫，dry-run 仍可能讀到寫到一半的狀態。這只影響預覽，dry-run 本身仍然什麼都不寫，措辭可以改成「等待進行中的 sync 完成」。
- **N7. 精煉（code-simplify）**：dry-run 的唯讀等待與取得租約的兩個輪詢迴圈結構相同，可以抽成一個 `pollUntil(deadline, attempt)`。實作者刻意分開，理由是避免把唯讀和寫入混在一起，這個理由成立。`git-sync-lease.ts` 的 `tryAcquire` 與 `peek` 重複同一段 SELECT，規模很小，可接受。沒有發現已經分歧成不一致行為的重複。

## 已查核維度

### 驗收與證據

審查者實際執行的測試：`pnpm run check`（exit 0）；`test-repo-edge.sh`、`test-repo-promotion.sh`、`test-cli-memory.sh`、`test-migrations.sh`、`test-repo-sync.sh`、`test-http-api.sh`、`test-smoke.sh` 全部 exit 0。全部以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 執行，被測版本為 9d76366 的 build。SCN-006 該次實測 8030ms。

紅燈另以 scratchpad 的 `git archive 9d76366` 副本重現：只把 `performRepoSync` 改成不經過租約，其他不動。

| SCN | 測試位置 | 證據位置 | 判定 |
|---|---|---|---|
| SCN-001 | `scripts/test-repo-edge.sh` 「issue-33 SCN-001」段（與單獨 sync 的對照資料根比較事件、current refs，並確認沒有殘留租約） | implementation-plan 步驟 1（紅）、步驟 2（綠、10/10）；審查者重現紅燈：停用租約的副本得到 `commit_discovered=6…current_refs=8`，對照組為 3 與 4；本分支綠燈 | 通過。紅燈為真，期望值來自獨立的對照資料根，不是同義反覆 |
| SCN-002 | `test-repo-edge.sh` SCN-002 段；HTTP 409 在 `test-repo-promotion.sh:243-250` | 步驟 2、3 的紅綠紀錄；審查者重現紅燈 `✗ busy sync exits non-zero`；本分支兩支都綠 | 通過。錯誤開頭、pid、host、開始時間與「沒有寫入」都有斷言 |
| SCN-003 | `test-repo-edge.sh` SCN-003 段 | 步驟 1 說明修改前本來就會成功，記為回歸測試；本分支綠 | 通過，附 S2。過期判定若壞掉，等待 20 秒、斷言少於 10 秒會紅；事件筆數只用 `new_commits` 代理 |
| SCN-004 | `test-repo-edge.sh` SCN-004 段 | 步驟 3 紅綠；審查者重現紅燈 `✗ dry-run still waiting while the lease is live`；本分支綠 | 通過。等待、租約未被改動、沒有新租約、`writes_shape` 不變都有斷言。1.5 秒的時間點在很慢的機器上可能變弱，屬證據持久力，不阻擋 |
| SCN-005 | `scripts/test-cli-memory.sh` 「issue-33 SCN-005」兩段 | 步驟 5 紅綠；本分支這次執行綠 | **不通過（M1）**。逐位元組比對有效：期望值由 DB 欄位加既有格式重組，而被改的是檔案組裝方式，兩者獨立。但並行的情境，實作在建立檔案時仍會掉資料，審查者在真實 CLI 下重現（1/40 輪）；測試本身也會偶發紅燈 |
| SCN-006 | `test-cli-memory.sh` 「issue-33 SCN-006」段 | 步驟 4 等價證據（修改前後同一測試綠，8031ms）；本分支 8030ms | 通過，附 N1。界線 4500～10500ms 與修訂後的「約 5～10 秒之間結束」一致；2 秒成功、`database is locked`、沒有留下筆記都有斷言 |

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| 兩個程式同時 sync 同一個 repo | 依序執行，結果與單獨 sync 相同 | SCN-001 測試、審查者重現紅燈 | 通過 |
| 租約過期比較：`expires_at` 與 `now` 都用 `toISOString()`（固定長度 UTC `…sssZ`），以文字比較 | 字典序等於時間序 | 程式碼查核。`DATETIME` 欄位是 NUMERIC affinity，但 ISO 字串無法轉成數字，仍以 TEXT 儲存與比較；測試手動插入的值格式相同 | 通過。不同主機時鐘不一致或時鐘倒退，最差是多等或提早接手，SQLite 共用資料根的情境下可接受 |
| 持有者還活著但超過 TTL 沒續約（事件迴圈卡住超過 60 秒） | 會被接手，退回 issue-33 之前的重複寫入 | 計畫已明列此取捨；git 用非同步 `spawn`（`git-exec.ts:108`），等 git 時事件迴圈是空閒的；同步的 DB 交易都是毫秒級 | 接受的殘餘風險 |
| 長時間 sync 期間的續約 | 每 15 秒延長，其他程式持續等待 | 沒有自動化測試；審查者以 TTL 3 秒的副本手動驗證，有續約與沒續約的結果不同 | 行為正確，守門缺口見 S1 |
| 續約失敗（鎖忙）或被接手 | 只記警告，不中斷 sync | 程式碼查核（try/catch、回傳值檢查） | 通過 |
| `finally` 釋放 | 只刪自己的 token | `DELETE … WHERE repository_id = ? AND token = ?`；SCN-001、SCN-003 驗證有刪掉自己的。不刪別人的沒有測試，SQL 一目了然 | 通過，附 N3 |
| `repoAdd` 的首次掃描 | 同樣走租約 | `repoAdd` → `performRepoSync`；SCN-001 的 fixture 每次都經過 `repo add`，之後也沒有殘留租約 | 通過 |
| 程式內鎖與跨程式租約的順序、死鎖 | 外層程式內排隊，內層租約；不會死鎖 | 每個 repo 只有一把租約，持有者不等待任何人；同一程式內的第二個請求只在 Promise 鏈上等，不輪詢 DB | 通過。程式內排隊的時間不算進等待上限，可接受 |
| dry-run 等待 | 只讀、不取得租約、等到釋放 | SCN-004 測試 | 通過 |
| dry-run 開啟時套用 migration（例如 18） | spec §19.4 承諾零寫入 | `repoSync` 一律先 `this.init()` → `initDatabase`，這是既有行為，migration 17 之前就是如此，不是本次引入 | 不屬於本次範圍，記為限制 |
| 等待逾時 | `repository_sync_busy: another process has been syncing <name> since <acquired_at> (pid <pid> on <host>); retry after it finishes`，exit 非 0，HTTP 409 | SCN-002 兩支測試 | 通過，附 N2 |
| heartbeat 讓程式無法結束 | 不會 | `heartbeat.unref()` 加上 `finally` 的 `clearInterval`；輪詢用的 `sleep` 不 unref，等待期間保持存活，符合預期 | 通過 |
| `MEMORIA_REPO_SYNC_WAIT_MS` 為 `''`、`abc`、`0`、負數、`Infinity` | 回到預設 120000 | 程式碼查核 `Number.isFinite(x) && x > 0` | 通過，文件可補（N4） |
| 16 個程式同時 remember，Daily 檔案還不存在 | 16 筆條目、1 個檔頭 | 測試只能偶爾抓到 | **不通過（M1）** |
| 單一寫入者的 Daily | 與變更前逐位元組相同 | SCN-005 逐位元組測試 | 通過 |
| Daily 寫入錯誤路徑 | 非 `EEXIST` 的錯誤照常丟出，由 `remember` 撤回 | 程式碼查核 `sync.ts:27-29` | 通過 |
| 附加寫入是否交錯 | 每筆條目一次 `O_APPEND` write | Node `writeFile` 一次最多寫 512 KiB，一般條目一次寫完 | 通過（超大條目理論上可能分段，記為限制） |
| 所有 `new Database` 開啟點 | 都帶 5000 | `grep -rn "new Database" src`：`connection.ts:38`、`schema.ts:574`、`verify.ts:49` 三處都帶 `timeout`；`skills/memoria-memory-sync/scripts/*.mjs` 兩處不屬於 core，沿用預設 5000 | 通過，行為不變 |
| 舊資料庫升級 | 只新增表 | migration 18 使用 `CREATE TABLE IF NOT EXISTS`；`test-migrations.sh` 綠；計畫記錄了真實 DB 副本的升級與 integrity_check | 通過 |

### 需求、架構、安全、品質（含跨 Task 重複與過度設計）

- **需求**：repo sync 的跨程式序列化、逾時、接手、dry-run 與 409 都符合 SCN-001～004 與 TBD-2～4。Daily 的部分未達 SCN-005（M1）。鎖等待維持 5 秒，符合 TBD-1 與 TBD-5。
- **架構**：邏輯都在 `src/core/`，新模組從 `db/index.ts` barrel 匯出。`git-scan.ts` 與 `git/` 都沒有改，符合 README 的「不可觸及」。`schema.ts` 新 import 了 `connection.ts`，沒有循環依賴。
- **安全**：租約表存 pid 與 hostname，只用在錯誤訊息裡。沒有新增 SQL 拼接，全部是 prepared statement。
- **品質與精煉**：見 N7；沒有過度設計。TTL、續約間隔與輪詢間隔是常數，沒有開成設定，等待上限比照既有的 env 寫法。
- **常青文件**：`AGENTS.md`、`docs/API.md`、`docs/API.zh-TW.md`、`docs/OPERATIONS.md`、`docs/agents/architecture.md` 的租約、409、`MEMORIA_REPO_SYNC_WAIT_MS`、15 秒／60 秒都與程式碼一致；`architecture.md:53` 的 Daily 描述要隨 M1 修正。`docs/agents/project.md` 新增的 M-4 與本機環境相符。版控文件沒有外部專案的真實名稱：對 diff grep 已知的下游名稱，唯一命中是 `unmeasurable` 裡的子字串，屬誤判。
- **GitNexus**：`withDb`／`initDatabase` 標為 CRITICAL，本次只在 `new Database` 加上與預設值相同的 `timeout`，可觀察行為不變。計畫記錄了 detect_changes 的結果，審查者沒有重跑。

### 豁免、待確認與限制

- **核准可追溯性**：規格與實作都在 9d76366 才首次提交，實作期間 README 沒有進版控（計畫的證據都寫「工作區未提交」）。acceptance.md:74 要求未追蹤的新規格先依來源核准並做初始提交。這次沒有做到，所以 git 無法證明「核准時的文字」等於 9d76366 的內容；SCN-001～005（2026-11-17）與 SCN-006 修訂（2026-11-18）的核准只能追到 README 引述的對話紀錄。依推導規則，9d76366 仍是有效基線，README 的核准表與 TBD-5 也一致，所以不列為 MUST FIX。協調者在記帳提交時把 `**核准 commit**` 回填為 9d76366。
- TBD-1～5 都已解決，沒有 Gate 豁免紀錄。
- 限制：
  - dry-run 開啟時的 migration 寫入屬既有行為。
  - 不同主機時鐘不一致的情境沒有測試。
  - 審查者沒有在 CI（GitHub runner）上跑。
  - adapters、wiki 兩組與 `test-ui-http.sh`、`test-mcp-e2e.sh`、`test-vector-recall.sh`、`test-memory-browser.sh` 沒有重跑，沿用計畫步驟 7 的紀錄。
  - M1 的重現腳本在 scratchpad（`daily-race.mjs`、`daily-link.mjs`、`cli-race.sh`、`renew-exp.sh`），沒有進版控。

## 流程判定
RETURN TO execute-task

理由：M1 是邏輯錯誤，SCN-005 宣稱的行為在並行建立 Daily 檔案時不成立，審查者已在真實 CLI 下重現，對應的測試也會偶發紅燈。修正 M1 並取得紅綠證據後重新審查；S1 需要使用者決定做法。
