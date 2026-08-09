# Issue 5 — 實作計畫

- 建立：2026-08-09
- 對應：[README.md](README.md)
- 分級：Medium（分析概要併入本文件前置章節）
- 前置：[issue-4](../issue-4/README.md) 的 `remember` / `recall` CLI 必須先出貨——本 issue 的三個標記沒有別的寫入入口

---

## 0. 分析概要

### 三條缺口鏈路

```
① 恆真事實被衰減
   recall → computeDecayFactor(timestamp, 90)         ← recall.ts:64，無差別套用
        → 270 天前的「使用者偏好 pnpm」score × ≈0.25
   prune stale(180d) → 該筆若尚未累積效用觀測，先被裁掉

② 矛盾決策並存
   remember「改用 A」…（三個月後）… remember「改用 B」
   recall「該用哪個」→ A、B 同時命中、同等地位     ← 無取代關係建模（assessment 缺點 5）

③ 敏感度靠人守
   export --format markdown → 真實 repo 名／人名原樣輸出  ← prune-export.ts:387 無 sensitivity 概念
```

### 修法

一張側表 `memory_attributes`（migration **14**，現有最大 id 為 13）承載三個標記，key 用 `ref_id`——與 `memory_utility` 相同的 id 空間（`RecallHit.id`，即 session id 或 event id，見 `src/core/db/schema.ts:151` 註解）：

```sql
CREATE TABLE IF NOT EXISTS memory_attributes (
  ref_id        TEXT PRIMARY KEY,
  retention     TEXT,      -- 'durable' | 'episodic' | NULL(未標記，行為同現況)
  sensitivity   TEXT,      -- 'private' | 'shareable' | NULL
  superseded_by TEXT,      -- 取代它的 ref_id；NULL = 現行
  note          TEXT,      -- 取代理由等自由文字
  created_at    DATETIME,
  updated_at    DATETIME
);
```

三個消費點，各自 fail-open：

| 標記 | 消費點 | 行為 |
|---|---|---|
| `retention='durable'` | `computeDecayFactor` 的呼叫端（`recall.ts`）＋ prune retention（`prune-export.ts`） | 排序時衰減因子固定為 1；stale 裁剪時豁免刪除 |
| `superseded_by` | `MemoriaCore.recall()` 的 hits 後處理，與 `applyUtilityWeighting` 同一層 | 預設濾除；`--include-superseded` 保留並附 `superseded_by` |
| `sensitivity='private'` | `exportMemory()` 的 `--redact` 路徑 | 命中內容以確定性 hash 短碼代稱化 |

**紀律**：全部沿用 `applyUtilityWeighting`（`src/core/db/recall.ts:31-49`）的既有模式——先探測表是否存在，無表或無列即原樣返回。任何未標記的 DB，召回／保留／匯出輸出與現況 **byte-identical**。

### 為什麼 superseded 過濾放在 `MemoriaCore.recall()` 而非各 mode 內

`recall()` 支援 `keyword | tree | hybrid | vector` 四種 mode。過濾若下沉到各 mode 內部要改四處、且 `vector` 路徑（`core/recall-vector.ts`）還有 RRF 融合與 fail-open 降級的分支。放在 hits 後處理這一層：**一處實作、四種 mode 全涵蓋**，且與 UFL 的 re-rank 相鄰，兩者的 fail-open 語意一致。

### 不做的事（範圍外）

- 不做自動矛盾偵測（只做明示 `--supersedes`）
- 不做寫入端相似記憶提示（Q4 決議延後）
- 不改 `DEFAULT_DECAY_HALF_LIFE_DAYS`、不改 prune 的 90／180 天預設
- 不動既有表結構、不改既有 CLI 命令名
- `sensitivity` 不影響召回可見性，只影響匯出

---

## 1. 實作步驟

### Phase 1 — `memory_attributes` 側表 + durable 保留語意

| Task | 產出 | 完成判準 |
|---|---|---|
| 1.1 | `schema.ts` migration id 14 `memory_attributes`：建表 + `idx_memory_attributes_superseded`。註解載明 id 空間與 fail-open 前提（比照 migration 7 的註解密度） | 對既有已填資料的 DB 升級後所有既有測試綠；`test-migrations.sh` 加一段舊 DB 升級斷言 |
| 1.2 | `src/core/db/memory-attributes.ts`：`upsertMemoryAttributes(dbPath, refId, patch)` / `getMemoryAttributes(dbPath, refIds)`，皆走 `withDb`，讀取端 readonly | 表不存在時讀取回空 Map 不拋錯 |
| 1.3 | `remember --durable` / `--episodic`（互斥）寫入 `retention`；`recall` 的排序在 `retention='durable'` 時衰減因子取 1 | 未標記時召回排序 byte-identical；標記後同一筆 270 天前的記憶 score 回到無衰減水準 |
| 1.4 | `prune` 的 stale 裁剪豁免 `retention='durable'`，掛在 UFL 高效用豁免的同一處 | `test-prune.sh` 加斷言：durable 且逾 180 天未召回者**不被刪**，同批未標記者照刪 |
| 1.5 | 文件：`CLAUDE.md`（prune 豁免條件）、`docs/OPERATIONS.md`、`CHANGELOG.md` Added | docs-check 通過 |

### Phase 2 — `supersedes` 取代關係

| Task | 產出 | 完成判準 |
|---|---|---|
| 2.1 | `remember --supersedes <ref_id>` [`--supersede-note <text>`]：在**被取代者**的列上寫 `superseded_by` = 新記憶 id。目標 id 不存在時報錯退出（不靜默） | 指向不存在的 id → 非零退出且無任何寫入 |
| 2.2 | `MemoriaCore.recall()` hits 後處理：預設濾除 `superseded_by IS NOT NULL` 者，`RecallFilter.include_superseded` 為 true 時保留並在 `RecallHit` 附 `superseded_by` | 無標記時輸出 byte-identical；`recall --include-superseded` 能取回被取代者 |
| 2.3 | `recall --include-superseded` CLI 旗標 + `/v1/recall` 對應欄位（Zod 邊界驗證） | `test-http-api.sh` 加一案例，envelope 形狀不變 |
| 2.4 | 鏈式取代的處理：A←B←C 時 A、B 皆為 superseded；**不做遞迴解析**（只看自身欄位是否非 NULL），避免環狀關係造成無限遞迴 | 造 A←B←C 三筆，預設召回只回 C |
| 2.5 | `export` **不套用**此過濾（稽核路徑要看全貌），markdown 輸出對被取代者加註記 | `test-cli-memory.sh` 斷言 export 含全部三筆 |
| 2.6 | 文件 + `CHANGELOG.md` Changed（召回預設行為變更，屬契約變更，需明列） | docs-check 通過 |

### Phase 3 — `sensitivity` 與匯出代稱化

| Task | 產出 | 完成判準 |
|---|---|---|
| 3.1 | `remember --sensitivity <private\|shareable>` 寫入標記 | 未帶旗標時不寫入該欄位（保持 NULL） |
| 3.2 | `export --redact`：對 `sensitivity='private'` 的記憶，內容中的專有名詞以確定性短碼代稱（`sha256(term+salt)` 前 4 碼，如 `repo-a1b2`）。salt 取自 `<configPath>/config.json`，缺省則以 DB 建立時間衍生（同一份 DB 跨匯出恆等） | 同一 DB 兩次匯出代稱一致；代稱不含原詞任何片段；映射表不寫入匯出檔 |
| 3.3 | 匯出摘要（人讀與 `--json` 皆有）列出 `redacted` / `unclassified` 筆數 | 未標記筆數 > 0 時人讀輸出有明顯提示 |
| 3.4 | `scripts/test-cli-memory.sh` 追加：標 private 的記憶 `--redact` 匯出後原詞不出現、代稱穩定；未標記者原樣輸出 | CI 綠；把 salt 改掉能讓代稱改變（驗證確定性來源正確） |
| 3.5 | 文件：`docs/OPERATIONS.md` 明載 `--redact` **是輔助不是保證**（只處理明示標記者）；`CHANGELOG.md` Added | docs-check 通過 |

> 三個 Phase 各自獨立 commit、可獨立回滾。順序有實質理由：Phase 1 建表（後兩者的地基）；Phase 2 是三者中唯一的**契約變更**，需要獨立一個 commit 以便單獨回退；Phase 3 只影響匯出路徑，風險最低故排最後。

---

## 2. 驗收

1. `pnpm run check` / `pnpm run build` / `node dist/cli.mjs --help`
2. **byte-identical 驗收（本 issue 最關鍵的一項）**：在**未寫入任何標記**的既有 DB 上，`recall`（四種 mode）、`prune --dry-run`、`export` 的輸出與升級前逐欄位一致。作法比照 UFL Phase 3 出貨時的驗證——升級前後各跑一次、輸出存檔 diff
3. 無回歸：`test-migrations.sh`、`test-utility-ranking.sh`、`test-prune.sh`、`test-http-api.sh`、`test-vector-recall.sh`、`test-cli-memory.sh` 全綠
4. 真實驗證（`MEMORIA_HOME=$HOME/.memoria`）：
   - 標一則超過 90 天的偏好類記憶為 `--durable`，同一 query 的 score 與排名在標記前後對照
   - 對一組已知的新舊決策下 `--supersedes`，確認預設召回只回現行版本
   - 對含真實名稱的記憶標 `private` 後 `export --redact`，人工確認輸出可安全外流
5. 觸及的 shell 過 `bash -n`；`CHANGELOG.md` 有 Added（Phase 1、3）與 Changed（Phase 2 召回預設）條目
6. 實作前對 `computeDecayFactor`、`applyUtilityWeighting`、`MemoriaCore.recall`、`runPrune`、`exportMemory` 各跑 `gitnexus_impact({direction:'upstream'})`；commit 前跑 `gitnexus_detect_changes()`
