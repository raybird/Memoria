# Issue 18: 向量庫覆蓋不足是靜默的，而 doctor 已經站在能看見它的位置

## 基本資訊

| 項目 | 內容 |
| --- | --- |
| Issue 編號 | 18（本地文件編號） |
| 複雜度級別 | Small（`doctor` 既有 `checks[]` 加一項 + `mark` 的配對寫入 + `renderBrief` 多印一行；零 schema 變更、零新依賴） |
| 風險等級 | Medium（動到 `doctor` 的 `ok` 判定——弄錯會讓沒用語意召回的人每次都看到紅燈；並改變 `mark` 實際寫入的列數） |
| 狀態 | 驗收條件已核准，未實作 |
| 需求來源 | 2026-08-24 另一個 session 的消費端實測（原 P0(b)）；本 session 驗證後大幅縮小範圍，並併入 issue-17 遺留的 U-4 與 P4 實驗所需的顯示面 |
| 建立日期 | 2026-08-25 |
| 相關 | [issue-17](../issue-17/README.md)（`mark`／pinned 區／U-4 的來源）、[issue-12](../issue-12/README.md)（`doctor` 的向量層檢查與「選用功能不得讓 doctor 變紅」的判準）、[issue-7](../issue-7/README.md)（同型的靜默覆蓋不足：10 個 session 只涵蓋 3 個）、`src/core/recall-vector.ts`（`inspectVectorLayer()`）、`src/core/db/brief.ts`（`renderBrief` 的 pinned 區） |

## 摘要

交辦時的命題是「向量庫是空的，但 stats 回報一切正常」。**那個現象不成立**——`sqlite3` 的 `SELECT COUNT(*) FROM memoria_vectors` 回 0 是量測假象（見下），庫裡有 88 筆。但拆開後**剩下一半是真的**：向量層的覆蓋不足沒有任何讀數，而它已經發生過兩次。

本 issue 只做那一半，並且收在 `doctor` 而不是 `stats`。順帶收掉 issue-17 遺留的 U-4，以及 P4 實驗需要的顯示面。

## 為什麼原命題不成立（2026-08-24 驗證，保留以免重複調查）

```
sqlite3 vectors.db "select count(*) from memoria_vectors;"              → 0
sqlite3 vectors.db "select count(*) from memoria_vectors NOT INDEXED;"  → 88
sqlite3 vectors.db "explain query plan select count(*) ...;"
  → SCAN memoria_vectors USING COVERING INDEX memoria_vectors_idx
```

stock `sqlite3` 把 libSQL 的向量索引當成 covering index 拿來算 `COUNT(*)`，而索引條目實際存在 shadow table，那個 b-tree 在 stock sqlite 眼裡是空的。`memoria_vectors_idx_shadow` 的 88 筆與真實列數一致——**沒有殘留，沒有 ingest 中斷**。量這張表一律要加 `NOT INDEXED`。

同一份交辦說「用同義詞問撈不到那筆過濾決策」也不成立：加 `--mode vector` 後它排 rank 2，交辦自己的證據裡 `mode=keyword` 已經寫明跑的是預設路由。

## 真正的缺口

`recall-vector.ts` 的 `VectorRecallStatus` 只有 `ok | unavailable | timeout | error`。helper 成功但回 0 筆時是 `ok`，與「庫裡沒有相關結果」無法區分。而 `stats` 有 `memoryIndex { sessions, indexed, missing }` 的 tree 覆蓋率，**向量層沒有對應讀數**。

實際發生過兩次：

| 時間 | 事故 |
| --- | --- |
| issue-7 之前 | 促升的記憶不進 tree index，bridge payload 因此縮水到 10 個 session 只涵蓋 3 個（17 個實體 vs 104），`vector-ingest` 仍回報 `{"ok":true}` |
| 2026-08-13 → 08-24 | 一筆新記憶的 `memory_node` 建了但沒 ingest，語意召回查不到它整整 11 天，零訊號 |

**發生兩次的是覆蓋率，不是空庫**——而覆蓋率一旦可見，空庫只是它的極端值。

## 已核准的設計決策

| # | 決策 | 取捨 |
| --- | --- | --- |
| D1 | 覆蓋率收在 **`doctor`**，不進 `stats` | `stats` 目前是純 SQLite，加向量覆蓋率等於讓它去讀 libSQL（另一個 DB、選用、需 fail-open），那一步就把 Small 變成 Medium。`doctor` 自 issue-12 起已有 `inspectVectorLayer()`，本來就會探測那一層 |
| D2 | **不新增 `route_mode` 狀態**（原交辦要求區分「查了但庫是空的」） | 那是公開契約變更，而它要傳達的資訊覆蓋率已經給了。契約面積不該為了一個衍生資訊而擴大 |
| D3 | U-4 的修法是**讓 `mark` 標記 note 的兩半**，而非讓 `applyMemoryAttributes` 解析配對 | 與 `remember --durable` 的既有行為一致（它本來就兩半都標），修在寫入端只有一處，修在讀取端則每個消費者都要記得配對 |
| D4 | pinned 區在有 `note` 時多印一行 | P4 的實驗需要 agent 讀得到那段「症狀／自檢」，否則沒有變因、產不出證據。只限有 `note` 的那幾則，且清掉 `note` 即可還原 |

## 驗收條件

**AC-1 `doctor` 報出向量覆蓋率**
- 可觀察結果：`doctor --json` 的向量層區塊含 `embedded` / `expected` / `missing`；`missing > 0` 時人類可讀輸出附上 ingest 的兩步指令
- 檢查方式：建立 `embedded < expected` 的 fixture，跑 `doctor --json` 斷言三個數字，並斷言人類輸出含 `vector-ingest`
- 失敗路徑：分母口徑若與 `vector-ingest.mjs` 的 `EMBEDDABLE_TYPES`（`session` / `decision` / `skill` / `memory_node`）不一致，覆蓋率永遠到不了 100%——那是製造一個永久假警報，比沒有讀數更糟

**AC-2 向量層未啟用時不把 `doctor` 變紅** ← 最大風險
- 可觀察結果：未設 `LIBSQL_URL` 時覆蓋率回報為「未啟用」，且 `doctor --json` 的 `ok` 仍為 `true`
- 檢查方式：在無 `LIBSQL_URL` 的環境跑 `doctor --json`，斷言 `checks.every(ok)`；`scripts/test-no-clone-install.sh` 既有的同型斷言即為守門
- 失敗路徑：讓沒用語意召回的人每次都看到紅燈，會訓練所有人忽略 doctor。issue-12 明文避開過這個錯（「failing an opt-in feature that was never opted into … is worse than not checking」），重犯等於推翻它

**AC-3 `mark` 對 note 的兩半一致（issue-17 的 U-4）**
- 可觀察結果：`mark note-x --durable` 後，`note-x` 與 `noteev-x` 都帶 `retention='durable'`
- 檢查方式：SQL 斷言兩列皆存在且值相同
- 失敗路徑：對沒有配對半的 ref（`gitdec-*`）不得憑空建立第二列——那會製造指向不存在記憶的孤兒標記，正是 `memoryRefExists` 當初要擋的東西

**AC-4 pinned 有 `note` 時多印一行**
- 可觀察結果：有 `note` 的 pinned 記憶在其行下多一行縮排的 note；沒有 `note` 的維持一行
- 檢查方式：fixture 一則有 `note`、一則沒有，斷言行數與內容
- 失敗路徑：零標記時 BRIEF 仍須與 `scripts/fixtures/brief-zero-marker.golden.md` 逐位元組相同（沒有 pinned 就沒有 note 行），且無 `note` 的 pinned 不得印出空行或佔位——那會讓 issue-5 的零標記不變式破在一個顯示細節上

## 核准紀錄

- 核准日期：2026-08-25
- 核准來源：使用者於對話中明示「全部核准」（AC-1～AC-3）；AC-4 由同日「pinned 行下加一行 note」的選擇確立
- 核准 commit：`d4c6006`（issue 文件首次提交）
- 全部四條均已核准，無待核准項目

## 邊界

### 可修改
- `src/core/recall-vector.ts`（`inspectVectorLayer()` 加覆蓋率）
- `src/cli/commands/doctor.ts`
- `src/core/memoria.ts` 的 `markMemory`（配對寫入）
- `src/core/db/brief.ts` 的 `renderBrief`（pinned 的 note 行）
- `scripts/test-brief-scope.sh` 或 `scripts/test-memory-attributes.sh`

### 不可觸及
- `VectorRecallStatus` 的列舉值（D2）
- `stats` 的 `memoryIndex` 與其輸出（那是 tree 的讀數，不動）
- `memory_attributes` 的 schema
- `vector-ingest.mjs` 與 `build-mcp-bridge-payload.mjs` 的取材邏輯——本 issue 只**量**它，不改它

### 不納入
- P3（feedback 迴圈的結構性衰減）：見下方延後理由
- P4（記憶改為可執行約束的形狀）：見下方延後理由

## 首要驗證

**AC-2 優先於其他所有項目。** 理由：AC-1、AC-3、AC-4 出錯的後果是「少了新東西」或「多印一行」，而 AC-2 出錯會讓**每一個沒使用語意召回的使用者**在每次 `doctor` 都看到紅燈——那不只是誤報，它會系統性地降低 doctor 這個工具的可信度，且影響的是完全沒有採用本功能的人。

完成證據：無 `LIBSQL_URL` 環境的 `doctor --json` 輸出，以及 `scripts/test-no-clone-install.sh` 的綠燈。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| U-1 | `expected` 的分母是否要扣掉 superseded 的記憶（它們仍會被 ingest，但召回時會被濾掉） | 未決 | 不阻塞。先與 `EMBEDDABLE_TYPES` 對齊（AC-1 的失敗路徑要求），superseded 的處理待實作時看實際數字是否造成困惑 |
| U-2 | 覆蓋率需要讀 libSQL，而 `doctor` 目前對 helper 是 spawn 探測。要沿用 spawn 還是直接連 libSQL | 未決 | 不阻塞。兩者都能滿足 AC，選擇影響的是 `doctor` 的執行時間與依賴面 |

## Gate 豁免紀錄

- **豁免項目**：`/new-issue` 與 `execute-task` 均要求以 `docs/AGENTS.md`（≥ 1.17）與 `docs/agents/` 三份文件作為分級與驗收標準格式的單一真相來源。
- **豁免理由**：本 repo 不存在該套治理文件（root `AGENTS.md` 是工程指南，語意不符、無版本號）。
- **核准**：使用者於 2026-08-24 明示選擇沿用 repo 既有格式（比照 `docs/issues/issue-16/README.md`），本 issue 沿用同一豁免。
- **殘留差異**：本 issue 為 Small，依規範採輕量驗收條件（`AC-` 編號），與 issue-17 的完整 Gherkin 不同——那是規模決定的，不是豁免造成的。
