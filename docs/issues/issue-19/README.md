# Issue 19 - vector-ingest 一次 embed 整份語料，記憶體隨語料量膨脹到被 OOM kill (Small)

## 概述

`vector-ingest.mjs` 把 payload 的全部實體一次交給 `embedTexts`，`embedLocal` 再整批丟進 transformers pipeline。batch 內每列 padding 到最長的那筆，中間張量隨筆數與長度一起成長，峰值記憶體跟著語料總量膨脹。本 issue 讓 `embedLocal` 分批呼叫 pipeline，消除 OOM；增量 ingest 不在範圍內。

實測（2026-10-20，維護者機器）：

| 語料 | 結果 |
| --- | --- |
| 396 筆 | 成功 |
| 771 筆 | `Out of memory: Killed process (node) anon-rss:21921728kB`——單一 node 行程 21.9GB |
| 同 771 筆，外部切成每批 32 筆分次呼叫 | 成功，峰值 RSS 1.4GB，全量 5 分 19 秒 |

先前成功只是機器剛好有足夠空閒記憶體。目前本機以 `~/.claude/skills/memoria/ingest-vectors.sh` 在外部切批繞過（[project.md](../../agents/project.md) 地雷 M-1）。

設計決策：

| # | 決策 | 理由 |
| --- | --- | --- |
| D1 | 分批放在 `embedLocal` 內 | ingest 與 recall 共用一處，呼叫端不需知道批次存在 |
| D2 | 只做分批，不做增量 | 使用者 2026-10-20 選定；速度問題另開 issue |
| D3 | 批次大小可用 `MEMORIA_EMBED_BATCH` 覆寫，預設 32 | 32 筆實測峰值 1.4GB；覆寫只為低記憶體機器保留調整空間，不新增 CLI 旗標 |

## 涉及檔案

- `skills/memoria-vector/embed.mjs` - `embedLocal` 分批
- `scripts/test-pure-functions.sh` - 分批的呼叫次數與順序斷言
- `skills/memoria-vector/README.md` - 記載 `MEMORIA_EMBED_BATCH`

## 驗收條件

1. **AC-1**：`embedLocal` 對 pipeline 的每次呼叫最多處理一個批次，回傳向量的筆數與順序和輸入一致 — 檢查方式：以可注入的假 pipeline 執行 70 筆、批次 32，斷言呼叫 3 次、每次長度 32／32／6，輸出第 i 筆對應輸入第 i 筆
   - 失敗路徑：呼叫次數為 1（未分批）、任何一次長度超過批次、或輸出順序錯位，即判定失敗
2. **AC-2**：`vector-recall.mjs` 的單筆查詢行為不變 — 檢查方式：`bash scripts/test-vector-recall.sh` 全數通過
   - 失敗路徑：任一既有斷言失敗；查詢路徑錯配會讓語意召回靜默回錯結果，這條覆蓋最大風險
3. **AC-3**：直接執行 `vector-ingest.mjs`（不經外部切批）處理至少 771 筆實體成功，`doctor` 的 vector coverage 為 `missing=0` — 檢查方式：維護者機器上以 `/usr/bin/time -v` 量峰值 RSS，數值回寫本文件（CI 不跑 local provider，這條是手動證據）
   - 失敗路徑：行程被 kill、`missing>0`、或峰值 RSS 隨筆數線性成長

- **核准日期**: 2026-10-20
- **核准來源**: 範圍決策——使用者 2026-10-20 對「issue-19 的範圍要多大？」選擇「只做分批 embed」。AC-1～AC-3 與 D3 由規劃推導，使用者 2026-10-20 回覆「照建議」核准（建議內容：預設每批 32 筆、可用 `MEMORIA_EMBED_BATCH` 覆寫；AC-3 門檻為實機 ≥771 筆且 `missing=0`）
- **核准 commit**: 待提交

## 風險與首要驗證

- **最大風險**：`embedTexts` 同時是查詢路徑；分批若改變輸出順序或維度，語意召回會靜默錯配
- **風險等級與理由**：Medium——改動小，但失敗沒有錯誤訊息，只會讓排序悄悄變差
- **首要驗證**：先寫 AC-1 的假 pipeline 斷言（紅），再改 `embedLocal`
- **選擇理由**：順序錯位是唯一會靜默的失敗形態，假 pipeline 能逐筆比對而不需要模型
- **完成證據**：AC-1 斷言紅→綠、`test-vector-recall.sh` 全綠、AC-3 實機數值

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| TBD-1 | AC-1～AC-3 與 D3（`MEMORIA_EMBED_BATCH`，預設 32）需使用者核准 | 已解決 | 2026-10-20 使用者回覆「照建議」，全部核准 |
| TBD-2 | 增量 ingest（跳過 text 未變的實體）；目前直接呼叫 `vector-ingest.mjs` 時不提交 `memory_sync_state` 游標，每次全量重算 | 待確認 | 不影響本 issue 的 AC；另開 issue |

## 實作與驗證步驟

1. 📝 **AC-1：分批呼叫 pipeline** — 驗證方式：AC-1 的假 pipeline 斷言
   - 完成證據：（實作時回寫紅綠燈命令與輸出）
2. 📝 **AC-2：查詢路徑不變** — 驗證方式：`bash scripts/test-vector-recall.sh`
   - 完成證據：（實作時回寫）
3. 📝 **AC-3：實機 ingest** — 驗證方式：`/usr/bin/time -v node skills/memoria-vector/vector-ingest.mjs <payload>`，接著跑 `doctor`
   - 完成證據：（回寫峰值 RSS 與 coverage）
4. 📝 **新版發布後移除本機繞道** — 驗證方式：`~/.claude/skills/memoria/ingest-vectors.sh` 改為直接呼叫一次 `vector-ingest.mjs`，project.md 地雷 M-1 標註失效日期
   - 完成證據：（回寫）

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-20 | 建立；範圍決策「只做分批 embed」 | - |
| 2026-10-20 | AC-1～AC-3 與 D3 核准（「照建議」） | - |

---
**建立日期**: 2026-10-20  
**分級**: Small  
**風險**: Medium\
**狀態**: 待實作
