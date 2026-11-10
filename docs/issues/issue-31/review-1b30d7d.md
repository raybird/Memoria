# 審查報告
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main），第二輪；前一輪為 review-1d86717
- Reviewed BASE SHA：a6e5cf87595841f9e8b09740672603434a32c15a
- Reviewed HEAD SHA：1b30d7d02080fe18b1d760fff0279900a7eaa81a
- Reviewed patch-id：0bced1e4689db018e368b8650ae87d9a3ea107eb（`git diff a6e5cf8 1b30d7d | git patch-id --stable`）
- 核准基線：4cfd0e2347c45e42ee9e0d9648d6d0c4c4b6896f（README 的核准 commit 是 `待提交`，依 acceptance.md §規格修訂的查核，以 `git log -1 -G '…\*\*核准來源\*\*…' 1b30d7d` 推導出來）
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-31/review-1b30d7d.md

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
- **N-6 撤回失敗的合併錯誤訊息沒有測試**（`src/core/memoria.ts:444-452`）。這條路徑很短，一看就能確認：撤回成功時拋出原始錯誤，失敗時把兩個錯誤寫在同一則訊息裡。所以只列為建議，不阻擋交付。要補的話，可以讓 DB 在寫入衍生檔失敗後變成唯讀，再斷言訊息的開頭是原始錯誤。
- 上一輪的 N-3、N-5 維持原狀，判定見下方「豁免、待確認與限制」。

## 已查核維度

### 上一輪問題的處理

| 編號 | 處理 | 查核 |
|---|---|---|
| M-1 | 使用者選 A（TBD-3）；`vector-ingest.mjs:84-95` 改回逐列 `db.execute` 提交，保留跳過未變更列 | 成立。我把 1d86717 的單一交易版 `vector-ingest.mjs` 換進 1b30d7d 的副本，新測試連跑 3 次都是 exit 1，每次都是 `✗ 4 of 6 recalls failed during a large ingest`。HEAD 連跑 3 次都是 exit 0（117、118、118 次 recall，0 次失敗）。案例還要求至少 2 次 recall 與 ingest 重疊，防止 ingest 太快結束時什麼都沒測到就變綠。遠端 libSQL 的大 batch 疑慮也隨著逐列提交消失 |
| S-1 | CHANGELOG `[Unreleased]` 新增 Fixed 與 Compatibility | 成立。寫明 `embedded` 的語意變更、新增 `unchanged`、exit code 不變，也寫了換 model 或 provider 時要重建向量庫。數值與步驟 9 在 4cfd0e2 的重測一致 |
| S-2 | 維持原狀 | 成立。改回逐列提交後，`BUSY_TIMEOUT_MS` 註解寫的「commits row after row」重新符合行為 |
| N-1 | 撤回失敗時保留原始錯誤 | 程式碼正確，沒有測試（N-6） |
| N-2 | README、OPERATIONS、helper 註解都補上 provider | 成立 |
| N-4 | `pure-fn-driver.mts` 新增 200／201 bytes 與 CJK 邊界斷言 | 成立。我用 Python `hashlib` 另外算出 `a92efd82`、`5ab93f89`，與測試裡的期望值相同，不是用實作重算的。實作本來就正確，所以這幾條是特性斷言、沒有紅燈，plan 也有寫明 |

### 驗收與證據

我自己重跑了 HEAD 1b30d7d（`pnpm run build` 後，以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER` 執行）：`pnpm run check`、`node dist/cli.mjs --help`、`release:docs-check` 都通過；`test-pure-functions`、`test-cli-memory`、`test-vector-recall`、`test-smoke`、`test-setup-onboarding`、`test-memory-attributes` 都是 exit 0。

| SCN | 證據位置 | 結論 |
|---|---|---|
| SCN-001 | `test-cli-memory.sh` issue-31 段；`pure-fn-driver.mts` 邊界斷言 | 成立。上一輪在 base 程式碼上看到 `ENAMETOOLONG` 紅燈，這一輪 HEAD 綠燈；邊界的期望值是獨立算出來的 |
| SCN-002／003 | `test-cli-memory.sh` | 成立。上一輪拿掉撤回呼叫的變異版本是紅燈；本輪只改了錯誤訊息的組法，HEAD 綠燈 |
| SCN-004（含修訂） | `test-vector-recall.sh` SCN-004 段、等鎖案例、「recall keeps answering while a large ingest writes」 | 成立。新增的 When/Then（1500 筆 ingest 期間，每次召回都成功）在單一交易版上穩定紅燈、在 HEAD 上穩定綠燈。逐列提交仍使用同一個 busy timeout，所以上一輪「拿掉 timeout 就紅燈」的等鎖變異結論仍然適用 |
| SCN-005 | `test-vector-recall.sh` SCN-005 段 | 成立。本輪沒有改到 doctor，HEAD 綠燈 |
| SCN-006 | plan 步驟 6、步驟 9 | 成立。在提交版 4cfd0e2 上重新量測：單次修法 1.22 s、`embedded=2`；4 支並行各 1.73～1.82 s；兩次之後 doctor `missing=0`。另外補量了帶 `index build &&` 前綴的修法路徑（1.38 s，之後兩個 missing 都是 0），上一輪的兩個限制都已補上。對照組 v1.36.1 的 135 s 仍然有效。量測要用維護者的真實資料，我無法重跑 |

規格查核：`git diff 4cfd0e2 1b30d7d -- docs/issues/issue-31/README.md` 沒有輸出，核准之後規格沒有漂移。修訂內容（SCN-004 新增 When/Then、關鍵差異表、涉及檔案註記、核准來源補上 TBD-3、Timeline）都符合使用者選 A 的範圍：改回逐列提交，並追加大批 ingest 期間 recall 的回歸測試。核准表裡 SCN-004 的狀態是 `已核准`、2026-11-10。

### 相關失敗面

| 輸入／狀態 | 預期 | 涵蓋 | 判定 |
|---|---|---|---|
| 大批 ingest 期間的語意召回 | 不因 SQLITE_BUSY 退回字面召回 | 新案例，紅綠燈都由我重現 | 成立 |
| 並行 ingest、等鎖 | 排隊等鎖，不失敗 | 等鎖案例、SCN-006 | 成立 |
| 沒有東西要寫的 ingest、空 payload | 不載入模型、不寫入 | 上一輪實測，本輪沒改 | 成立 |
| 遠端 libSQL | 行為不變 | 寫入方式回到改動前的逐列請求，查詢仍是每批 500 個參數 | 成立（沒有實測遠端） |
| 撤回的時機與範圍 | 只撤回這次新建的 id | SCN-002／003 | 成立；TBD-2 已揭露 |
| 撤回本身失敗 | 原始錯誤保留 | 程式碼 | 成立（N-6：沒有測試） |
| `skillFileStem` 的多位元組字元與邊界 | 截在字元邊界、檔名 ≤255 bytes | pure 斷言，加上上一輪的探針 | 成立 |
| doctor 修法前綴、`MEMORIA_DB_PATH`、舊 DB | 同上一輪 | SCN-005、issue-27 案例 | 成立（本輪沒改） |
| helper 輸出契約的下游 | 有記錄 | CHANGELOG Compatibility | 成立 |

### 需求、架構、安全、品質

- 需求：修訂後的規格與實作一致，「涉及檔案」標為不可觸及的檔案都沒有被改。
- 架構：本輪只改 helper 的寫入迴圈與 `rememberNote` 的錯誤處理，沒有越過模組邊界，沒有新增依賴，沒有 schema 變更，沒有改 CLI 名稱。
- 安全：新增內容沒有 shell 或 SQL 注入面；CHANGELOG 與 issue 文件沒有外部專案的真名。
- 品質與重複：`readMemoryIndexCoverage` 與 `queryStats` 的計數維持一致，沒有分歧。沒有過度設計。
- 文件：OPERATIONS、helper README、程式碼註解與逐列提交的行為一致，並寫明不包成單一交易的原因。

### 豁免、待確認與限制

- **N-3 不處理，可以接受。** doctor 的 vector coverage 修法已經自帶 `index build`，`tree index` 那一行也印出自己的修法，agent 照 doctor 輸出做就能補齊，不會再陷入反覆重跑。部署版 skill 的那句話只是不完整，沒有造成錯誤操作。改部署版 skill 要同步 INSTALL 與交付清單，留給後續處理比較合理。
- **N-5 不處理，可以接受。** GitHub Actions 與維護者機器都不是以 root 執行，略過時會明確印出「不算通過」。之後若改成在容器內以 root 跑 CI，這兩個案例會變成假綠燈，屆時要回頭處理。
- SCN-006 與 TBD-3 的使用者原話我都無法直接查證，只審查了 README 與 plan 的紀錄。
- 我沒有跑全部 35 支測試，只跑了上列 6 支；其餘依 plan 步驟 9 在 4cfd0e2 的紀錄。1b30d7d 只回填證據文件，相對 4cfd0e2 沒有程式碼變更。
- 審查期間沒有碰 `~/.memoria`；暫存檔都在 scratchpad `review31/`；除了本報告，沒有修改任何受版控的檔案。

## 流程判定
PASS
