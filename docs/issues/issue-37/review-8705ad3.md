# 審查報告
- 範圍：完整交付範圍（`main` 97273a8..issue-37-remember-vector-gap 8705ad3，1 個提交、10 個檔案；分級 Small、風險 Low）
- Reviewed BASE SHA：97273a8461a3a69c12599cda8595101fee3e2f41
- Reviewed HEAD SHA：8705ad3436976adcd0ba2e190be79db333e2e3b1
- Reviewed patch-id：c30206ca085b6b6030fe3b6c3a712ab859d38663
- 獨立 reviewer：Claude Code 隔離 subagent（不是實作者），2026-11-26

BASE 等於 `git merge-base main 8705ad3`，也等於目前 `main`。Small + Low 不需要核准 commit；核准來源與日期在 README `## 驗收條件`，AC-1～3 的文字在本範圍內沒有改動。

## 問題與風險

- MUST FIX：無
- SHOULD FIX：無
- NICE TO HAVE：
  1. **向量庫被鎖住時 remember 會多等 5 秒**（`src/core/recall-vector.ts:135-143` 的 `countEmbeddedRows` 透過 `withDb` 沿用 `SQLITE_BUSY_TIMEOUT_MS`=5000）。本機的 `vectors.db` 是 `journal_mode=delete`，另一個行程持有 EXCLUSIVE 鎖時，讀取端要等 busy timeout 用完才拿到 `read_failed`。實測：背景 `sqlite3` 執行 `BEGIN EXCLUSIVE` 持鎖 9 秒，HEAD 的 `remember --json` 花 5.15 秒，exit 0，沒有 `vector_missing`，筆記已寫入；沒鎖時約 0.12 秒，與未啟用時相同。AC-3 的結果（照常成功、結束碼不變）成立，只是 README 步驟 2 的「remember 不因此變慢」沒提到這個例外。doctor 一直都是這樣。現在 ingest 只 embed 有變的列，持鎖時間很短，所以影響小。要處理的話，覆蓋率讀取可以用短的 busy timeout，或在 README 註明這個上限。
  2. **測試沒有比對人讀提示的筆數與 doctor**（`scripts/test-vector-recall.sh:934-936`）。只有 `--json` 的 `vector_missing` 跟 doctor 比對；人讀那行只斷言 N≥1，而且它是在第二則筆記寫入之前印的，數字本來就不同。人讀與 JSON 用的是 `remember.ts:74-77` 同一個變數，現在不會出錯，但 AC-1 失敗路徑寫的是「提示的筆數」。可以在 doctor 之前、最後一次寫入時用人讀輸出取 N 再比對。
  3. **AC-2 說的「遠端 libSQL」沒有自動化測試**。腳本涵蓋了未啟用、helper 被覆寫、補完後重寫，沒有 `LIBSQL_URL=libsql://…`。我手動跑過 HEAD：`LIBSQL_URL=libsql://remote.example remember` 沒有提示，也不會連網（`countEmbeddedRows` 看到非 `file:` 就直接回 `remote_libsql`）。加一行就能補上。
  4. **常青文件可以順手提一句**：`docs/OPERATIONS.md:366` 寫「Memories added after setup via `remember` … are not automatically embedded」，可以補上 remember 現在會當下提示缺口；`docs/agents/architecture.md:28` 描述 `recall-vector.ts` 的那行沒有提到 `measureVectorCoverage` 是 doctor 與 remember 共用的覆蓋率來源。不改也不會讓文件出錯。
  5. **README 的紅燈證據少了兩項說明**（`docs/issues/issue-37/README.md` 步驟 2）：紅燈怎麼對舊程式跑（例如把新測試放到 `97273a8` 的 build 上執行）沒寫出實際命令；專案沒有單元測試框架，所以是外迴圈與內迴圈合併，但沒寫單迴圈合併的理由（verification.md「單迴圈合併」）。紅燈本身我已重現（見下方），所以只是紀錄完整度的問題。

## 已查核維度

### 驗收與證據

| 編號 | 證據 | 結論 |
|---|---|---|
| AC-1 | `scripts/test-vector-recall.sh` 的 `[vector] issue-37` 段。我在 HEAD build 上跑整支腳本：exit 0，沒有 ✗。紅燈：把同一支腳本複製到 `97273a8` 的 worktree（build 過）執行，前面各段都通過，到 issue-37 段剛好 4 項 ✗（`data.vector_missing (undefined) 應等於 doctor 的 missing (9)`、沒有提示、沒有指向 doctor、沒有筆數），`BASE rc=1`，與 README 記的一致。手動：`filled.db` 有 1 列、語料 25 筆時，人讀輸出 `- vector coverage: 缺 24 筆…`，doctor 印 `embedded=1 expected=25 missing=24` | 通過 |
| AC-2 | 我在 `97273a8` 與 `8705ad3` 各 build 一次，各跑兩次 `docs/issues/issue-37/evidence/baseline.sh`：四份輸出 `diff -r` 全部相同，sha256 為 `human.txt` 17aaef2cf246…、`json.txt` 16db2c3907ce…，與 README 步驟 1 的記錄一致。測試段涵蓋補完後重寫（`created:false`，沒有 `vector_missing`）、未啟用、helper 被覆寫；遠端 libSQL 由我手動確認（見 NICE TO HAVE 3） | 通過 |
| AC-3 | 測試段把向量庫換成非 SQLite 的檔案、目錄：exit 0、`created:true`、沒有 `vector_missing`、recall 找得到該筆。我另外以 doctor 確認這兩種情況真的走到 `not measured (read_failed)`，不是走到其他分支才剛好不提示。「被鎖住」由我手動測：exit 0、筆記已寫入，但會延遲 5 秒（NICE TO HAVE 1） | 通過 |

AC-2、AC-3 的斷言在舊程式上本來就通過，README 寫明了它們是用來守回歸的。這是如實揭露，不是假綠燈：AC-2 的「不提示」與 AC-3 的「照常成功」是舊程式本來就有的性質，要守的是新程式碼不破壞它們。override 那個案例指向一個不存在的向量庫，如果覆寫的判斷失效，會量到 0 並出現提示，所以這個斷言能抓到錯。

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| `inspectVectorLayer()` 抽出覆蓋率計算後結果是否改變（GitNexus 評為 CRITICAL） | doctor、setup 拿到的報告與改動前完全相同 | 我寫了一個 tsx 小程式，分別 import BASE（worktree）與 HEAD 的 `src/core`，對 12 種環境 × 2 種 provider（local、stub）比對整份 `inspectVectorLayer()` 的 JSON（helper 路徑前綴換成同一個）：未啟用、`LIBSQL_URL` 只有空白、從未 ingest（量到 0）、dbPath 為 undefined、dbPath 不存在、遠端 `libsql://`、垃圾檔、目錄、正常（1 列）、override 指向不存在的檔案、override 指向我們自己的 helper、override 只有空白。24 組全部 SAME。另外 `test-setup-onboarding.sh` 在 HEAD exit 0、沒有 ✗ | 不變 |
| override 判斷從 `override !== null` 改成 truthiness | 等價 | `?.trim() \|\| null` 只在 trim 後為空字串或 undefined 時是 null；`?.trim()` 的 truthiness 判斷的是同一件事。實測只有空白的 override 兩版都當成沒有覆寫，會量覆蓋率 | 等價 |
| 計算順序：覆蓋率改在建立 report 之前算 | 沒有副作用 | 中間只有 `resolveHelperScript`、`existsSync` 與讀環境變數，都是純讀取；embedder 探測仍在覆蓋率之後；`countEmbeddableEntities` 要拋錯的話兩版都會往外拋 | 等價 |
| 覆蓋率檢查拋錯 | 不影響寫入與結束碼 | `remember.ts:74-77` 的 try 包住整個 `measureVectorCoverage`（包括兩次 `withDb` 開檔與 `countEmbeddableEntities`）；輸出在 try 之外，不會因此少印；寫入在檢查之前已完成，`result.ok` 為 false 時更早就拋錯。向量庫的開檔與查詢錯誤先被 `countEmbeddedRows` 內層的 catch 接住，外層是第二道防線 | 通過 |
| 缺口為 0、或 coverage 為 null | 不提示、JSON 沒有欄位 | `missing > 0` 才設定 `vectorMissing`；JSON 只在有值時展開並附加 `data.vector_missing`，沒有值時照原樣輸出 `result`（AC-2 基準逐位元組相同） | 通過 |
| 效能 | remember 不明顯變慢 | 在真實資料上以唯讀方式量 `measureVectorCoverage`（vectors.db 284MB、3344 列；sessions.db 28MB）：第一次 7.9ms，之後 0.2～0.3ms。隔離資料根下，HEAD 啟用時 remember 0.118 秒、未啟用時 0.121 秒。不 spawn helper、不載入模型 | 通過；鎖住時例外，見 NICE TO HAVE 1 |
| 向量庫被另一行程鎖住 | 照常成功 | 手動：5.15 秒後 exit 0 | 通過，有延遲 |
| `MEMORIA_DB_PATH` 指到 home 以外 | 提示仍成立 | 筆數照算；doctor 這時改印原因、不給可執行的命令。提示說「補法見 doctor」，doctor 自己會說明 | 可接受 |

### 需求、架構、安全、品質

- **需求**：與 README 概述一致：只提示，不在 remember 內 ingest，也不載入模型。HTTP `/v1/remember` 不帶這個欄位，AC 只要求 CLI，不在範圍內。
- **架構**：計算留在 `src/core/recall-vector.ts`，CLI 經 `src/core/index.ts` barrel 取用，與 doctor 呼叫 `inspectVectorLayer` 的方式相同。抽成一個函式讓 remember 與 doctor 的筆數只有一個來源，沒有複製判斷邏輯，也沒有過度設計。
- **安全**：全部是唯讀（`withDb` 用 `readonly: true`），不執行外部命令，不新增依賴。遠端 URL 不會連線。
- **品質**：`measureVectorCoverage` 的回傳型別直接取 `VectorLayerReport` 的欄位型別，兩邊不會分歧。沒有重複邏輯。
- **文件**：`docs/CLI.md`、`docs/CLI.zh-TW.md` 新增的段落、`DEPLOYED_SKILL.md` 新增的一句、CHANGELOG 都與程式一致：提示格式、`data.vector_missing`、筆數與 doctor 相同、四種不提示的情況（未啟用、無法量測、沒有缺口、讀不到）。`no_local_db` 在 remember 剛寫完時不會發生，文件沒列也正確。`DEPLOYED_SKILL.md` 沒有 `./cli`、`bash skills/`、`node skills/`、`git clone`；`check-deployed-skill-sync.mjs` 回 `deployed_skill_check=ok version=1.39.0`；`release:docs-check` 通過；`pnpm run check` exit 0。
- **公開 repo**：diff 新增的行裡沒有 `/home/`、使用者名稱或外部專案真名；`evidence/baseline.sh` 只用相對 repo 根目錄的路徑與 `mktemp -d`。
- **README 格式**：符合 Small 範本，標題順序正確，`**狀態**: 實作中` 與審查前的階段相符。風險 Low 卻保留了各 AC 的「失敗路徑」行，範本說可以省略，保留也無妨。目前還沒有 `## 現況`。
- **另外重跑的回歸**（HEAD build，`env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`）：`test-vector-recall.sh`、`test-setup-onboarding.sh`、`test-smoke.sh`、`test-cli-memory.sh` 都是 exit 0、沒有 ✗。

### 豁免、待確認與限制

- 沒有豁免與待確認事項。
- 限制：沒有重跑 http-mcp 組其他 4 支，以及 bootstrap、npm-install，沿用 README 步驟 3 的記錄。這次改動不碰 HTTP、MCP 與安裝路徑。
- 冷快取（OS page cache 被清空）下的覆蓋率讀取時間沒有量，需要 root 權限；COUNT 是全表掃描，3344 列約 5MB 的資料頁。
- 審查時用的臨時 worktree 已移除，`dist/` 已 build 回 HEAD。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
