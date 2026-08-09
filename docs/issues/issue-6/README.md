# Issue 6: `INSERT OR REPLACE` 讓 `recall_fts` 留下重複列，重複 sync 同一 session 會使召回命中翻倍

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 6（本地文件編號） |
| 複雜度級別 | Medium（兩個 SQL 語句改寫 + 一個索引重建 migration，無新表、無新命令） |
| 狀態 | **實作完成**（2026-08-09） |
| 需求來源 | [issue-4](../issue-4/README.md) R1：實作 `remember` 冪等重跑時踩到，當時只在 `remember` 路徑規避，`sync` 路徑留給本 issue |
| 建立日期 | 2026-08-09 |
| 前置 | 無（獨立 bug 修復；`v1.22.0` 已發） |

## 文件清單

- [implementation-plan.md](implementation-plan.md) — 分析概要與實作計畫（2 Phase）

## 摘要

`importSession()` 用 `INSERT OR REPLACE` 寫 `sessions` 與 `events`。SQLite 的 REPLACE 在鍵衝突時是「隱式 DELETE + INSERT」，而該隱式 DELETE **不會**觸發 `AFTER DELETE` trigger（`recursive_triggers` 預設 OFF），`AFTER INSERT` trigger 卻照跑——於是 `recall_fts` 留下舊列 + 新列各一。

後果是**同一筆記憶在召回結果中出現兩次**，佔用 `top_k` 名額並擠掉其他命中。觸發條件是「以相同 id 重複匯入」，也就是 `memoria sync` 對同一份 session 檔跑第二次。

## 實測證據（2026-08-09）

### 重現

```bash
$ ./cli sync examples/session.sample.json      # 同一個檔案跑兩次
$ ./cli sync examples/session.sample.json
SELECT kind, ref_id, COUNT(*) FROM recall_fts GROUP BY 1,2 HAVING COUNT(*) > 1
→ session/decision/skill 各 2 列
```

召回端：`recall` 對該語料回傳 4 筆命中，實際只有 2 個不同的 `ref_id`。

### 三種寫法的對照（最小重現，同一組 trigger）

| 寫法 | 連續寫入同一 id 兩次後的 FTS 列數 | 內容 |
|---|---|---|
| `INSERT OR REPLACE`（現況） | **2** | `第一版 \| 第二版` |
| `INSERT OR REPLACE` + `PRAGMA recursive_triggers=ON` | 1 | `第二版` |
| `INSERT … ON CONFLICT(id) DO UPDATE`（採用） | 1 | `第二版` |

### 影響面的精確界定（比第一眼窄）

全 repo 有 10 處 `INSERT OR REPLACE`，但**只有 `sessions` 與 `events` 兩張表掛了 FTS trigger**：

```
$ grep -o "ON \(sessions\|events\|…\) BEGIN" src/core/db/schema.ts | sort -u
ON events BEGIN
ON sessions BEGIN
```

| 路徑 | 是否受影響 | 原因 |
|---|---|---|
| `sync`（`importSession`，`src/core/db/session.ts:17`、`:31`） | **是** | 唯一寫這兩張表的 REPLACE |
| `remember`（單則筆記，issue-4） | 否 | issue-4 R1 已在 core 規避：相同內容直接跳過寫入 |
| `promoteSummary`（git 摘要促升） | 否 | 用 `INSERT OR IGNORE`，衝突時不寫 |
| 其餘 8 處 REPLACE（`skills` / `wiki_*` / `memory_nodes` / `recall_telemetry` …） | 否 | 這些表沒有任何 trigger |

### 既有資料的污染程度

檢查本機實際使用中的資料庫（唯讀）：

```
recall_fts 重複列: 無
fts 總列數: 38   ← 恰好等於 sessions 7 + decision/skill events 31
```

也就是**這個 bug 有觸發條件**（要重複 sync 同一個 session id），實際使用中不一定踩到。Phase 2 的重建 migration 因此是防禦性的，不是搶救性的。

## 變更邊界

### 可修改

- `src/core/db/session.ts` — `importSession` 的兩個 upsert 語句
- `src/core/db/schema.ts` — 新增 migration **id 15**（重建 `recall_fts`）
- `scripts/test-migrations.sh`、`scripts/test-smoke.sh`（或新增斷言）
- 文件：`CHANGELOG.md`、`docs/HANDOVER.md`、`docs/issues/issue-4/README.md`（R1 標記為已修）

### 禁止修改

- **不改 trigger 定義**——三組 trigger 本身是對的，問題在寫入端的語句
- **不開 `PRAGMA recursive_triggers`**（見「已決策」D1）
- **不動其餘 8 處 `INSERT OR REPLACE`**——它們的表沒有 trigger，改了只是擴大風險面
- **不改 issue-4 的 `remember` short-circuit**（見 D3）
- 不新增資料表、不改 CLI 命令名、不引入依賴

### 風險

| 風險 | 說明 | 緩解 |
|---|---|---|
| `ON CONFLICT DO UPDATE` 與 REPLACE 的語意差異 | REPLACE 會刪掉整列再插入（未列出的欄位回到預設值）；DO UPDATE 只改列出的欄位 | 兩個語句都列出了**全部**欄位，所以結果等價；且 DO UPDATE 才是這裡真正想要的語意（更新既有 session，而非重建它） |
| REPLACE 的隱式 DELETE 可能觸發 FK cascade | `events.session_id` / `memory_node_sources.session_id` 都指向 `sessions.id` | 改用 DO UPDATE 後不再有隱式 DELETE，順帶消除這個潛在問題（SQLite 的 FK 預設關閉，故現況未爆發） |
| 重建 `recall_fts` 影響大型資料庫的升級時間 | migration 15 會清空並重新 backfill | FTS 是**衍生**資料，重建永遠安全；語料規模與 `sessions + events` 同級，migration 4 的初次 backfill 走的是同一段 SQL |
| 重建掩蓋了「哪些 DB 曾經受污染」 | 修完就看不出原本有沒有重複 | 已在本 issue 記錄實測：本機資料庫當時無重複 |

## 已決策（2026-08-09，無待拍板事項）

| # | 議題 | 決議 |
|---|---|---|
| **D1** | 用 `PRAGMA recursive_triggers=ON` 還是改寫語句 | **改寫語句**。兩者實測都能修好（見上表），但 pragma 是**連線層的全域行為變更**，會改變所有 trigger 的遞迴語意，且只在「透過本專案連線」時生效——別的工具（`sqlite3` CLI、其他程式）寫同一個 DB 就失效。改寫語句是資料層的修正，對任何寫入者都成立 |
| **D2** | 既有重複列如何處理 | **migration 15 清空並重新 backfill `recall_fts`**。比「保留 MIN/MAX rowid 去重」更強：不只去重，還修正任何來源與索引的漂移。FTS 是衍生資料，重建無損 |
| **D3** | issue-4 的 `remember` short-circuit 是否改回 | **不改**。「相同內容重跑就跳過寫入」本身就是冪等的正確語意，也省下無謂的 wiki rebuild 與 index rebuild；它不再是繞過 bug 的權宜之計，而是獨立成立的行為 |

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-09 | issue-4 實作中發現（R1），當時只規避 `remember` 路徑並記入 backlog |
| 2026-08-09 | 建立 issue-6；最小重現實驗確認三種寫法的差異、界定影響面（只有兩張表有 trigger）、確認本機資料庫未受污染；Phase 1–2 實作完成 |

## Changelog

- 2026-08-09: 初版建立並完成實作。含最小重現對照表、影響面精確界定、既有資料污染程度檢查；D1–D3 直接定案（皆有明顯較優解，無待拍板項）。

---
**建立日期**: 2026-08-09
**最後更新**: 2026-08-09
**文件版本**: 1.0
**狀態**: **實作完成**
**分級**: Medium
