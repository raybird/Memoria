# Issue 6 — 實作計畫

- 建立：2026-08-09
- 對應：[README.md](README.md)
- 分級：Medium（分析概要併入本文件前置章節）

---

## 0. 分析概要

### 失效鏈

```
./cli sync <同一份 session 檔案> （第二次）
  └─ importSession (session.ts:7)
       └─ INSERT OR REPLACE INTO sessions …        ← 鍵衝突
            └─ SQLite: 隱式 DELETE + INSERT
                 ├─ 隱式 DELETE → trg_recall_fts_sessions_ad **不觸發**
                 │                 （recursive_triggers 預設 OFF）
                 └─ INSERT      → trg_recall_fts_sessions_ai **觸發** → 又插一列
       └─ INSERT OR REPLACE INTO events …          ← 同樣的問題
  └─ recall_fts 每個 ref_id 累積 2 列
       └─ recall 回傳同一筆記憶兩次，吃掉 top_k 名額
```

### 修法

1. **Phase 1 — 改用 `ON CONFLICT DO UPDATE`**（`session.ts` 兩處）。衝突時走 UPDATE 路徑，觸發 `_au` trigger；而 `_au` 本來就正確地做了「先 DELETE 舊 FTS 列、再 INSERT 新的」。兩個語句都列出全部欄位，因此與 REPLACE 的結果等價，只是不再產生隱式 DELETE。
2. **Phase 2 — migration 15 重建 `recall_fts`**。既有資料庫可能已經累積重複列，而索引是衍生資料，直接清空並從 `sessions` / `events` 重新 backfill 最乾淨——同時修正去重以外的任何漂移。backfill SQL 與 migration 4 相同。

### 不做的事（範圍外）

- **不開 `PRAGMA recursive_triggers`**（D1）：那是連線層的全域行為變更，且只在透過本專案連線時生效。
- **不動其餘 8 處 `INSERT OR REPLACE`**：那些表沒有 trigger，改動只會擴大風險面而沒有收益。
- **不改三組 FTS trigger**：trigger 是對的，錯的是寫入端。
- **不改 issue-4 的 `remember` short-circuit**（D3）：冪等跳過寫入本身就是正確語意。

---

## 1. 實作步驟

### Phase 1 — `importSession` 改用真正的 upsert

| Task | 產出 | 完成判準 |
|---|---|---|
| 1.1 | `session.ts:16-19` 的 `upsertSession` 改為 `INSERT INTO sessions (…) VALUES (…) ON CONFLICT(id) DO UPDATE SET timestamp=excluded.timestamp, project=excluded.project, scope=excluded.scope, event_count=excluded.event_count, summary=excluded.summary` | 首次匯入行為不變；重複匯入後 `recall_fts` 每個 `ref_id` 僅一列，內容為最新版本 |
| 1.2 | `session.ts:30-33` 的 `upsertEvent` 同樣改寫（`ON CONFLICT(id) DO UPDATE`，更新 session_id/timestamp/event_type/content/metadata） | 同上；`events` 的 decision/skill 兩種 kind 都不再重複 |
| 1.3 | 測試：`scripts/test-smoke.sh`（或 `test-migrations.sh`）加斷言——同一份 sample 連 sync 兩次後，`recall_fts` 無重複列、`recall` 命中數與單次 sync 相同 | 本機綠 + CI 綠；把語句改回 `INSERT OR REPLACE` 能讓測試紅 |

### Phase 2 — migration 15 重建既有索引

| Task | 產出 | 完成判準 |
|---|---|---|
| 2.1 | `schema.ts` 新增 migration id 15 `recall_fts_rebuild`：`DELETE FROM recall_fts;` 後以 migration 4 的兩段 backfill SQL 重填。註解載明「FTS 是衍生資料，重建無損」與本次修復的因果 | 對已含重複列的舊 DB 升級後重複消失；對乾淨 DB 升級後列數不變 |
| 2.2 | 測試：`test-migrations.sh` 造一個「含重複 FTS 列」的舊 DB（直接 INSERT 重複列模擬），升級後斷言去重且列數等於來源筆數 | CI 綠；斷言能抓到未重建的情況 |
| 2.3 | 文件：`CHANGELOG.md` Fixed；`docs/issues/issue-4/README.md` 的 R1 標記為已由 issue-6 修復；`docs/HANDOVER.md` §7 backlog 該列轉 `done` | docs-check 通過 |

> Phase 1 修因、Phase 2 清果，各自獨立 commit、可獨立回滾。順序不可顛倒——先重建再改寫的話，重建到改寫之間的任何一次重複 sync 又會製造新的重複列。

---

## 2. 驗收

1. `pnpm run check` / `pnpm run build` / `node dist/cli.mjs --help`
2. `bash scripts/test-smoke.sh`、`bash scripts/test-migrations.sh`（含新斷言）綠
3. 無回歸：`test-cli-memory.sh`、`test-memory-attributes.sh`、`test-utility-ranking.sh`、`test-http-api.sh`、`test-prune.sh`、`test-vector-recall.sh`（召回排序與 envelope 的守門員）
4. 真實驗證：對同一份 session 檔連續 `sync` 兩次，`recall_fts` 無重複列、`recall` 命中數與單次 sync 一致
5. 觸及的 shell 過 `bash -n`；`CHANGELOG.md` 有 Fixed 條目
6. 實作前對 `importSession` 跑 `gitnexus_impact({direction:'upstream'})`；commit 前跑 `gitnexus_detect_changes()`
