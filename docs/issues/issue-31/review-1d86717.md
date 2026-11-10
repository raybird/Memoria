# 審查報告
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main）
- Reviewed BASE SHA：a6e5cf87595841f9e8b09740672603434a32c15a
- Reviewed HEAD SHA：1d86717e807b0b81d9f674e233e9073e96a362b6
- Reviewed patch-id：7cae4ee36c112e00afc807cc79b71a6c886b0540（審查時以 `git diff a6e5cf8 1d86717 | git patch-id --stable` 重算，一致）
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-31/review-1d86717.md

## 問題與風險

### MUST FIX

- **M-1 大量寫入的單一交易讓並行的語意召回大量 SQLITE_BUSY，v1.36.1 修好的行為在大批寫入時退回**（`skills/memoria-vector/vector-ingest.mjs:83-89`）`需決策`
  - 現象：本機 local store 是 rollback journal（`PRAGMA journal_mode` = `delete`，cache 2MB）。整批 upsert 包成一個 `db.batch(..., 'write')` 後，寫入期間讀者被擋住的時間等於整個交易的長度。`vector-recall.mjs` 只等 1.5 秒（`BUSY_TIMEOUT_MS = 1_500`），超過就丟 `SQLITE_BUSY`，recall 端 fail-open 退回字面召回。
  - 實測（stub provider，2500 筆，腳本在 scratchpad `review31/exp/race.sh`、`race2.sh`，不進版控）：
    | ingest 版本 | 待寫入筆數 | ingest 耗時 | 同時段 recall 成功／失敗 |
    |---|---|---|---|
    | HEAD（單一交易） | 2500 | 11.3 s | 2／7（失敗都是 `LibsqlError: SQLITE_BUSY: database is locked`，每次約 1.59 s） |
    | base a6e5cf8（逐列提交） | 2500 | 14.3 s | 166／0（最長 111 ms） |
    | HEAD 改成每 100 列一個交易（原型） | 2500 | 12.3 s | 4／7 |
    | HEAD 改成每 10 列一個交易（原型） | 2500 | 13.5 s | 37／2 |
    | HEAD（單一交易），已滿的庫改 300 列文字 | 300 | 1.6 s | 2／0 |
  - 影響：小批修補（本 issue 的主要情境，缺 2 筆）不受影響。會出事的是已有資料的向量庫一次要寫幾百筆以上：向量庫落後很多（ingest 全程手動，忘記跑就會累積）、或日後 builder 改了文字組法導致整庫重寫。這段期間每個 agent 的語意召回都會靜默退回字面召回。v1.36.1 CHANGELOG 第 11 行宣稱「Semantic recall keeps working during an ingest」，這個保證在大批寫入時不再成立。`test-vector-recall.sh` 的「recall waits out the exclusive lock of a commit」只測短暫持鎖，偵測不到。
  - 另外，`vector-ingest.mjs:83-84` 的註解寫「so a competing ingest or recall waits for one lock hold」，對 recall 不成立：recall 等不到 1.5 秒就失敗，這是一則與行為不符的說法。README 的「風險與首要驗證」也沒有列出這個面向。
  - 需決策：「寫入包成一個交易」是使用者 2026-11-10 明確核准的設計，所以要由使用者決定怎麼處理。
    - 選項 A：寫入改回逐列提交（或維持 autocommit 的 `execute`）。效能主要來自「跳過未變更列」，不是交易；缺 2 筆時兩者差距可以忽略，2500 筆時逐列提交還多 3 秒。原型顯示分塊交易（100 或 10 列一塊）都還會失敗，所以不建議分塊。
    - 選項 B：維持單一交易，接受大批寫入期間語意召回退回字面召回。這時要改正 `vector-ingest.mjs:83-84` 的註解，並在 `docs/OPERATIONS.md` 與 `skills/memoria-vector/README.md` 寫明這個代價，下次發版的 CHANGELOG 也要寫明 v1.36.1 的保證在大批寫入時不成立。
    - 建議：選 A。它保住 v1.36.1 已發布的行為，SCN-004～006 的效能目標不受影響。無論選哪一個，都補一個「已有資料的庫、大批待寫入、同時 recall」的回歸案例，或至少在 SCN-004 的證據裡記錄量測。
  - 遠端 libSQL 也受單一交易影響，但這部分未驗證：全量 ingest 會把幾千條帶 384 維向量 JSON 的 statement 放進同一個 batch 請求（每列約 8KB，2183 列約 17MB），可能超過遠端的請求大小限制。改動前是逐列請求。選 A 也一併解決這點。

### SHOULD FIX

- **S-1 vector-ingest 輸出語意改變沒有記進 CHANGELOG 的相容性段**（`CHANGELOG.md` `[Unreleased]` 是空的）。`embedded` 從「payload 中可 embed 的總數」改成「本次實際寫入數」，另新增 `unchanged`。`docs/HANDOVER.md` §8 記載 helper 有版控外的下游（`downstream-cli-container` 自帶 `skills/memoria-vector`），並要求改 helper 契約時在 CHANGELOG 明寫。repo 內唯一的消費者 `runFullVectorIngest`（`src/cli/setup-plan.ts:387`）只看 exit code 和 `inspectVectorLayer`，不受影響；`run-sync-with-enhancement.sh:90` 也只看 exit code。建議現在就在 `[Unreleased]` 寫一條 Compatibility，免得發版時漏掉。
- **S-2 `vector-ingest.mjs:20-26` 的 `BUSY_TIMEOUT_MS` 註解已過時。** 註解說競爭的 writer「commits row after row with almost no gap」。改成單一交易後不再是這樣：如果 M-1 選 B，就要依新行為重寫；選 A 則維持原狀。

### NICE TO HAVE

- **N-1 撤回失敗時會蓋掉原始錯誤**（`src/core/memoria.ts:444`）。`discardNewNote` 本身丟錯時（例如 DB 唯讀、鎖逾時），使用者看到的是撤回的錯誤，看不到真正讓 remember 失敗的原因。建議用 try/catch 包住撤回，原始錯誤照拋，撤回的錯誤附在訊息後面。
- **N-2 換 provider 與換 model 是同一個陷阱**（`skills/memoria-vector/README.md:70`、`docs/OPERATIONS.md:380`）。stub 與 local 之間切換 `MEMORIA_EMBED_PROVIDER` 同樣不會改變文字，ingest 會留著舊向量。文件只寫了 `MEMORIA_EMBED_MODEL`，建議一併寫上。
- **N-3 部署版 skill 的說法不再完整**（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:89`）。「The tree index updates itself」在本 issue 的情境下並不成立。doctor 的 vector 修法已自帶 `index build`，所以 agent 照做不會卡住；但 doctor 在 LIBSQL_URL 未設、只有 tree index 有缺口時也會回 `ok:false`，skill 沒有說明這一項。建議補一句「`tree index` 失敗時執行它印出的修法」。
- **N-4 測試沒有涵蓋的邊界**：SCN-001 沒有釘住 200／201 bytes 邊界與 4-byte 字元（我另外驗證了：`a`×200 → 203 bytes 不變；`a`×201、`中`×67、emoji、ZWJ 都會截斷並帶雜湊，檔名 ≤ 212 bytes）；SCN-004 沒有測「只有 kind 改變」，也沒有比對新向量本身（只比對了文字，同一條 upsert 同時寫入文字與向量，所以結論成立）。
- **N-5** 以 root 執行時 SCN-002／003 只印出略過、腳本仍然 exit 0。GitHub Actions 不是以 root 執行所以目前沒有影響，但容器化 CI 會出現假綠燈。可以考慮改用環境變數強制失敗，或讓略過時腳本 exit 非 0。

## 已查核維度

### 驗收與證據

我自己重跑了測試（`pnpm run build` 後，以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER` 執行）：`test-cli-memory`、`test-vector-recall`、`test-smoke`、`test-setup-onboarding`、`test-memory-attributes` 都是 exit 0；`pnpm run check`、`release:docs-check` 也通過。紅燈另外用 base 版程式碼加 HEAD 版測試，以及變異版本實際跑過。

| SCN | 證據位置 | 結論 |
|---|---|---|
| SCN-001 | `scripts/test-cli-memory.sh` issue-31 段 | 成立。base 程式碼搭配新測試得到 `ENAMETOOLONG` 紅燈，與 plan 一致。斷言是字面值（≤255 bytes、`_[0-9a-f]{8}\.md$`、短名稱檔名 `短名稱技巧_pnpm_優先.md`），沒有重算實作 |
| SCN-002 | 同上，`chmod 555` | 成立。變異版本（拿掉 `discardNewNote` 呼叫）得到 `✗ 失敗的新筆記仍留在 sessions` 紅燈。sessions、events、recall 三處都有斷言，恢復權限後重試 `created:true`、`missing=0` |
| SCN-003 | 同上 | 成立。A 的 session、`memory_node_sources`、recall 都有檢查；重跑 A 回 `created:false` 並保留 A |
| SCN-004 | `scripts/test-vector-recall.sh` SCN-004 段 | 成立。base 版 helper 得到紅燈。同一份 payload 重跑時 `embedded=0 unchanged=3`、`updated_at` 全部不變；改 1 筆加 1 筆時 `embedded=2`，文字確實更新。等鎖條款見下一列 |
| SCN-004 等鎖 | 同檔「ingest waits for a lock held by another process」 | 斷言修改的理由正當：我實測確認沒有待寫入列的 ingest 在別人持有 RESERVED 鎖時 97 ms 就結束，不會碰到鎖，不先刪一列這個案例就測不到等鎖。變異版本（拿掉 ingest 的 busy timeout）得到 `✗ ingest failed behind a held lock … SQLITE_BUSY` 紅燈，所以修改後的案例仍然在測等鎖 |
| SCN-005 | `scripts/test-vector-recall.sh` SCN-005 段 | 成立。base 版 doctor 得到 `沒有 tree index 這一項` 紅燈。修法在 `env -u MEMORIA_HOME` 下以 `sh -c` 原樣執行後，兩個 missing 都是 0；沒有 tree 缺口時修法不帶 `index build` |
| SCN-006 | `implementation-plan.md` 步驟 6 | 判準有偵測能力：對照組 v1.36.1 helper 在同一份副本上要 135.10 s（門檻 30 s），新版 1.29 s 且 `embedded=2`；4 支並行各 1.74～1.78 s（門檻 60 s）。跳過策略失效時會回到 2183 筆全量，兩個門檻與 `embedded=2` 都會變紅。限制：量測對象是工作區版本，不是 commit 後的 HEAD（之後的精煉只動 `treeIndexCheck`，不影響量測路徑）；真實語料沒有 tree 缺口，所以沒有量到帶 `index build` 前綴的那條路徑（由 SCN-005 涵蓋）。我無法重跑 |

### 相關失敗面

| 輸入／狀態 | 預期 | 涵蓋 | 判定 |
|---|---|---|---|
| `rememberNote` 撤回的時機 | 只在 `noteExists` 為 false、`remember()` 回 `ok:false` 時執行 | 程式碼與 SCN-002 | 成立。`remember()` 只可能在 `importSession`／Daily／Decisions／Skills 階段失敗；`buildMemoryIndex` 與 wiki 都是 fail-open，所以撤回時一定還沒有節點，不會留下孤兒 `memory_node_sources` |
| 撤回會不會刪到呼叫前就存在的資料 | 不會 | SCN-003 | 只刪 `session_id = note-<id>` 的 events 與該 session，而且這個 id 在呼叫前不存在。唯一例外是 TBD-2（同時寫入同一段文字），README 已揭露並接受 |
| 撤回本身失敗 | 原始錯誤保留 | 無 | N-1 |
| Daily 筆記殘留 | 已揭露 | plan 步驟 3 | 接受（recall 與向量都不讀 Daily） |
| `skillFileStem` 遇到多位元組字元、邊界與碰撞 | 截在字元邊界、≤255 bytes、相同前綴不互相覆蓋 | 我另外跑了探針 | 成立（N-4）。8 碼雜湊對完整 slug 計算；slug 相同本來就是同一個 skill（id 也相同），沒有新增碰撞 |
| 其他組 Skills 路徑的地方 | 規則一致 | grep | 只有 `extractSkills` 與 `previewSync`，兩處都已改用新規則 |
| ingest 變更比對 | name／kind／text 相同才跳過 | SCN-004、首要驗證盤點 2183／2183 | 成立。比對文字與寫入文字用同一個 `texts[i]` |
| 沒有東西要寫的 ingest | 不載入模型、不寫入、不等鎖 | 我實測 97 ms | 成立 |
| 空 payload | `{embedded:0,unchanged:0,skipped:0}`，不開 DB | 程式碼 | 成立 |
| 並行 ingest | 排隊等鎖，不失敗 | 等鎖案例、SCN-006 | 小批寫入成立；大批寫入見 M-1 |
| ingest 期間的語意召回 | v1.36.1 起最多等 1.5 s 而不失敗 | 既有測試只測短暫持鎖 | **不成立**（M-1） |
| 遠端 libSQL | 行為不變 | 無 | 未驗證（M-1 附註） |
| 換模型或換 provider | 文件說明 | 文件 | 模型有寫；provider 見 N-2 |
| doctor 修法前綴 | repo 模式用 `process.execPath dist/cli.mjs`，沒有 dist 時用 `<repo>/cli`；installed 用 `lib/` 或 `dist/cli.mjs` | SCN-005（repo＋dist） | 成立。每個參數都經 `quoteShellArg` 單引號跳脫；`A && (…; exit $S)` 在 index build 失敗時中止，成功時 exit code 沿用 ingest |
| doctor 與 `MEMORIA_DB_PATH` 指向別處 | 不印可執行的 ingest | 既有 issue-27 案例 | 成立。提前 return 的位置在 `indexFirst` 之前；`tree index` 那行修法只固定 `MEMORIA_HOME`，在同一個環境執行時沿用同一個覆寫，結果一致 |
| doctor 遇到舊 DB 或缺表 | 不報錯、不捏造失敗 | 程式碼（catch 退路） | 成立 |
| doctor 在 LIBSQL_URL 未設時 | 健康的庫輸出不變 | 程式碼 | 有 tree 缺口時頂層 `ok:false`，即使沒有啟用向量也一樣。tree recall 確實看不到這些 session，所以這不是誤報；`test-npm-install`／`test-no-clone-install` 用的都是新庫，不受影響（N-3） |
| tree index 計數 | 與 `stats` 相同 | 程式碼 | 成立。prune 的 consolidate／stale 只刪 level-2 節點，topic 節點的來源列還在，不會產生假缺口 |

### 需求、架構、安全、品質

- 需求：README 從核准 commit f1a4b8c 到 HEAD 只改了「核准 commit」那一欄（從「待提交」改成 f1a4b8c），沒有規格漂移。README 標為「不可觸及」的 `db/recall.ts`、`embed.mjs`、`vector-recall.mjs`、`build-mcp-bridge-payload.mjs` 都沒有被改。
- 架構：撤回邏輯放在 `src/core/db/memory-note.ts`，coverage 放在 `src/core/db/telemetry.ts`，兩者都經 barrel 匯出；doctor 只做呈現，符合模組邊界。helper 仍以 child process 呼叫，沒有新增依賴、沒有 schema 變更、沒有改 CLI 名稱。
- 重複：`readMemoryIndexCoverage` 與 `queryStats` 的 `memoryIndex` 是同一套 SQL，目前沒有分歧，註解也有寫明。不改 `queryStats` 是 plan 刻意的選擇，可以接受；之後要改計數時兩處要一起改。
- 安全：修法字串的每個路徑都有 shell 跳脫，沒有注入面；版控文件沒有外部專案的真名。
- 過度設計：沒有。
- 文件：`docs/OPERATIONS.md`、`skills/memoria-vector/README.md`、`docs/agents/project.md` M-3 的敘述與小批寫入的行為一致；大批寫入對 recall 的影響沒有寫進去（M-1），vector-ingest 註解有兩處需要修正（M-1、S-2）。

### 豁免、待確認與限制

- SCN-006 需要維護者的真實資料，我無法重跑，只審查了紀錄的數值與對照組。
- M-1 的數據是 stub provider 測的。寫入階段的時間跟 provider 無關（embedding 在交易開始前就算完了），所以 local provider 的結論應該相同，但我沒有用 local 量測。
- 遠端 libSQL 的 batch 大小限制沒有驗證。
- 我沒有跑全部 35 支測試，只跑了上面列的 5 支；其餘依 plan 步驟 8 的紀錄。
- 審查期間沒有碰 `~/.memoria`；暫存檔都在 scratchpad `review31/`；除了本報告，沒有修改任何受版控的檔案。

## 流程判定
RETURN TO execute-task
