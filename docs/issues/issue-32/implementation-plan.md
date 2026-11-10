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

1. 📝 **步驟 1：對比基線（首要驗證，服務 SCN-008、SCN-009 與所有「與變更前相同」的斷言）**
   - 產出：在 scratch 目錄複製本機資料根（只讀來源，之後只操作副本）；一支對比腳本，用目前 HEAD 的 `./cli` 跑固定查詢，正規化時間戳、latency、recall_id 後存為基線。固定查詢包括：recall --json 查得到 durable、superseded（`--include-superseded`）與一般記憶各一組；brief --global --stdout；stats --json。腳本與基線不進版控，量測值與命令記在本步驟。
   - 相依：無。
   - 完成判準：同一 runtime 重跑兩次，正規化後 diff 為空；在副本上刻意 mark 另一則 durable 後重跑，diff 不為空（證明判準抓得到變化）。
2. 📝 **步驟 2：migration 17 與屬性讀寫（SCN-008、SCN-009）**
   - 產出：`schema.ts` 的 migration 17、`memory-attributes.ts` 讀寫 `verify_cmd`、型別更新。`test-migrations.sh` 補上帶 durable、superseded、private 標記的升級前資料庫，升級後標記與 recall、brief 常駐約束區、stale prune 豁免都不變。
   - 相依：步驟 1。
   - 完成判準：`test-migrations.sh`、`test-memory-attributes.sh`、`test-prune.sh` 綠；用新版開啟步驟 1 的副本（觸發 migration）再跑同一組查詢，與基線 diff 為空。SCN-009：以 1.37.0 發布版在升級後的副本與另一份未升級副本上跑 recall、brief、remember --durable、mark，兩份結果正規化後相同。
3. 📝 **步驟 3：寫入驗證與互斥（SCN-004、SCN-005）**
   - 產出：`rememberNote`、`markMemory` 的檢查；`remember --verify` 旗標；`test-memory-attributes.sh` 新增 SCN-004 區塊（三條失敗路徑都斷言資料庫列數與標記不變），SCN-005 的空白與多行拒絕斷言放在同一區塊。
   - 相依：步驟 2。
   - 完成判準：SCN-004 的斷言先紅後綠；被拒的命令執行前後 `memory_attributes`、`sessions`、`events` 列數相同。
4. 📝 **步驟 4：recall 顯示（SCN-001、SCN-002）**
   - 產出：`applyMemoryAttributes` 附 `verify`、`RecallHit.verify`、recall 人讀輸出的查證行；`test-memory-attributes.sh` 的 SCN-001 區塊與 `recall --json` 斷言；`test-http-api.sh` 斷言 `/v1/recall` 的 hit 欄位。
   - 相依：步驟 3。
   - 完成判準：SCN-001 斷言先紅後綠，命令字串以已知字面值比對；步驟 1 的對比在零查證命令的副本上 diff 仍為空；`test-wiki-query-fileback.sh` 綠（wiki file-query 經過同一個後處理）。
5. 📝 **步驟 5：brief 顯示與可見產生時間（SCN-003、SCN-007，以及 SCN-002 的 /v1/brief 部分）**
   - 產出：`brief.ts` 的資料項與渲染；`brief-zero-marker.golden.md` 只多 `｜ 產生於 <TS>`；`test-cli-memory.sh` (G) 的穩定性比對同時排除可見的產生時間（依 SCN-007 已核准的行為變更修改測試契約）；SCN-003 的區塊放在 `test-memory-attributes.sh`，SCN-007 的放在 `test-cli-memory.sh`。
   - 相依：步驟 4。
   - 完成判準：golden 的 diff 只有產生時間那一處（在 PR 證據附上 golden 的 `git diff`）；SCN-003 含反引號的命令能完整顯示；步驟 1 的 brief 對比正規化後只差產生時間。
6. 📝 **步驟 6：Memoria 不執行查證命令（SCN-006）**
   - 產出：`test-memory-attributes.sh` 的 CLI 區塊與 `test-http-api.sh` 的 HTTP 區塊，查證命令都是 `touch <暫存目錄>/ran`。
   - 相依：步驟 5。
   - 完成判準：所有列出的命令與端點跑完後，`ran` 不存在。反向自檢：對照組在測試裡直接用 `sh -c` 執行同一字串，`ran` 會出現，證明命令本身有效、斷言抓得到「真的被執行」的情況。
7. 📝 **步驟 7：skill 指引與常青文件**
   - 產出：`DEPLOYED_SKILL.md` 兩條指引；`docs/CLI.md`、`docs/CLI.zh-TW.md`（`remember --verify`、互斥、recall 顯示）；`docs/API.md`、`docs/API.zh-TW.md`（hit 與 brief 資料項的 `verify`）；`docs/agents/architecture.md` 標記表加一列；`docs/OPERATIONS.md`（migration 17）；`AGENTS.md` 的 no-server path 範例加一行 `--verify`。
   - 相依：步驟 6。
   - 完成判準：`test-npm-install.sh`、`test-setup-onboarding.sh` 綠（部署出去的 skill 帶新指引）；中英文 CLI／API 文件旗標一致。
8. 📝 **步驟 8：兩種 agent 的手動觀測（SCN-010）**
   - 產出：維護者機器上 Claude Code 與 Codex 各一個新 session 的觀測紀錄：隔離資料根、記憶內容、查證命令、命令的實際結果、agent 是否先執行命令、回答內容。隔離方式依 TBD-7 決定，不改動使用者實際的 host skill 連結與資料根。
   - 相依：步驟 7、TBD-7。
   - 完成判準：兩個 agent 都在回答前執行了查證命令，並以命令結果回答。失敗時的差異：agent 照記憶內容回答過時的狀態。這個差異可以觀察，判準因此不會在失敗時仍是綠的。
9. 📝 **步驟 9：CI 對齊與範圍檢查**
   - 產出：依 `AGENTS.md`「CI Parity Checklist」跑靜態檢查與 core、adapters、wiki、http-mcp、repo 五組；`git diff --stat main -- src/adapter src/cli/commands/service.ts src/ui` 為空；commit 前跑 GitNexus `detect_changes`。
   - 相依：步驟 1～8。
   - 完成判準：全部綠；範圍檢查輸出為空；`detect_changes` 只觸及涉及檔案清單內的 symbol。

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

## 檢查清單

- [ ] 零查證命令時，recall 與 brief 的輸出除產生時間外與變更前相同（golden 與步驟 1 對比）
- [ ] 每條拒絕路徑都斷言資料庫沒有新增列
- [ ] 查證命令在任何輸出都完整、不截斷
- [ ] 沒有任何程式路徑執行查證命令（SCN-006）
- [ ] `src/adapter/`、`service.ts`、`src/ui/` 沒有變更
- [ ] skill 指引兩條都已寫入部署版，Claude Code 與 Codex 讀的是同一份
- [ ] SCN-010 依 TBD-7 決定的隔離方式執行，沒有改動使用者的 host skill 連結與資料根
