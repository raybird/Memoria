# Issue 40 - 一則筆記的效用只記在回報的那一半，另一半與 stale prune 都看不到 (Small)

## 概述

issue-39 的增量覆審（review-03683f0 N1，見 [issue-39 TBD-3](../issue-39/README.md#待確認事項)）發現：

- `remember` 把一則筆記存成兩列，session `note-<指紋>` 與 event `noteev-<指紋>`。`feedback --hits` 把效用記在回報的那個 id 上（`src/core/db/telemetry.ts` 的逐筆歸因），不會同時記到另一半。
- recall 的效用加權以 `hit.id` 查 `memory_utility`（`src/core/db/recall.ts` 的 `applyUtilityWeighting`）。issue-34 之後，一則筆記只留排名較前的那一半；留下的若不是當初回報的那一半，就讀不到累積的效用。
- stale prune 只用 session id 查效用（`src/core/db/prune-export.ts` 的 stale 段，節點經 `memory_node_sources` 對到 session）。回報 `noteev-` 時，那則筆記不會因為效用高而免於刪除；審查以隔離資料根實測，event id 那則的節點照樣被刪。

`mark`、`--supersedes` 與 `--durable` 已經會同時處理兩半（`src/core/memoria.ts` 的 `notePairOf`），效用回報與讀取還沒有。

本 issue 讓一則筆記的效用不論回報哪一半，recall 排序與 stale prune 都看得到。

## 現況

**現行 review**: review-095652d.md

## 涉及檔案

採 TBD-1 做法 (b)：讀取時依筆記指紋合併兩半的效用，寫入不變。

- `src/core/utils.ts` - 可改：合併兩半效用列的共用函式（沿用 `noteFingerprintOf`）
- `src/core/db/recall.ts` - 可改：`applyUtilityWeighting` 改讀合併後的效用
- `src/core/db/prune-export.ts` - 可改：stale prune 的效用豁免改讀合併後的效用
- `src/core/db/brief.ts` - 可改：高效用區塊改讀合併後的效用
- `src/core/db/telemetry.ts` - 不可觸及：寫入與逐筆歸因不變
- `scripts/test-utility-ranking.sh`、`scripts/test-prune.sh`、`scripts/test-brief-scope.sh` - 可改：回歸斷言
- `scripts/pure-fn-driver.mts` - 可改：合併函式的直接斷言
- `scripts/test-cli-memory.sh` - 可改：issue-34 AC-1 原本以兩半各回報不同效用來決定誰排前面，本 issue 讓兩半共用效用後改以時間戳決定，驗證的行為不變
- `docs/agents/architecture.md`、`docs/OPERATIONS.md`、`CHANGELOG.md` - 可改

## 驗收條件

合併規則：同一指紋的 `note-` 與 `noteev-` 兩列，把觀察次數與效用總和分別相加後，依既有的 `effectiveUtility` 算出一個效用，兩半共用。不是筆記的 ref（`gitdec-`、一般 session）照舊只看自己那一列。

1. **AC-1**：recall 的效用加權對筆記用合併後的效用，不論效用記在哪一半、recall 留下的是哪一半。檢查方式：隔離資料根寫一則筆記，以 `--score 0` 只回報 `noteev-`，下次 recall 留下 `note-` 時，它的分數乘上 0.5（效用 0 的係數）；反過來只回報 `note-`、留下 `noteev-` 時同樣成立。
   - 失敗路徑：留下的那一半分數不變，或只部分下調。
2. **AC-2**：stale prune 的效用豁免對筆記用合併後的效用。檢查方式：過期的筆記只對 `noteev-` 回報 0.9，`prune --stale-days` 之後節點與 session 都保留；只回報 0.2 時照舊刪除。
   - 失敗路徑：回報 event id 的筆記被刪，或低分的筆記因合併而被保留。
3. **AC-3**：brief 的高效用區塊對筆記用合併後的效用與觀察次數，一則筆記只佔一列。檢查方式：兩半各回報一次 0.8，brief 列出這則筆記一次（達到觀察次數門檻 2）；只回報一半一次時照舊不列。
   - 失敗路徑：兩半各回報一次仍不列，或同一則筆記列兩次。
4. **AC-4**：寫入與非筆記的 ref 都不變。檢查方式：`telemetry.ts` 沒有 diff；`gitdec-` 與一般 session 的效用加權、prune 豁免與 brief 結果和變更前相同，既有 `test-utility-ranking.sh`、`test-prune.sh`、`test-brief-scope.sh`、`test-memory-attributes.sh` 照常通過。部署的 skill 那句「a low one moves them down in later recalls」對筆記也成立（issue-39 TBD-5），由 AC-1 證明。
   - 失敗路徑：非筆記的記憶排序或保留結果改變。

- **核准日期**: 2026-11-27
- **核准 commit**: dc1f192
- **核准來源**: 使用者 2026-11-27 對 TBD-1 回「依照建議處理」（做法 b），對 TBD-2 回「相加」，對 AC-1～4 回「核准」

## 風險與首要驗證

- **最大風險**：合併會立刻改變既有資料的排序、prune 與 brief 結果。issue-34 之前一次 recall 會同時列出兩半，回報時兩半常一起列進 `--hits`；合併後平均效用不變，但觀察次數加倍，較快達到 brief 的觀察門檻（見 TBD-2）。
- **風險等級與理由**：Medium。效用是 recall 排序與 prune 保留的輸入，既有資料已依舊方式寫入。
- **首要驗證**：先寫 AC-1、AC-2 的斷言，以現行程式取得紅燈（審查已實測到這兩種形態），再實作共用的合併函式。
- **選擇理由**：這是審查實測到的可觀察形態。
- **完成證據**：見「實作與驗證步驟」步驟 1 的紅燈：AC-1、AC-2 的斷言以現行程式失敗，形態與審查實測相同。

## 實作與驗證步驟

1. ✅ **AC-1～3 紅燈** — 先寫斷言再改程式。相依：無。
   - 完成判準：三項斷言以現行程式失敗，失敗訊息對應審查實測到的形態。
   - 完成證據：✅ 2026-11-27。`test-utility-ranking.sh` (E/issue-40)：效用 0 記在 `noteev-` 時，留下的 `note-` 分數不變（AC-1 失敗）。`test-prune.sh` issue-40 段：效用 0.9 記在 event 的孤立筆記與有節點的筆記都被刪（AC-2 兩項失敗）。`test-brief-scope.sh` (J)：兩半各回報一次 0.8 的筆記沒有列出（AC-3 失敗）。
2. ✅ **共用合併函式與三個讀取點** — `utils.ts` 新增 `mergeNoteUtility`，並把 `notePairOf` 從 `memoria.ts` 移入共用；`applyUtilityWeighting`、`loadUtilityMeans`（stale 與 consolidate 共用）、brief 高效用區塊改讀合併後的效用。相依：步驟 1。
   - 完成判準：AC-1～3 綠燈；`telemetry.ts` 沒有 diff；`pure-fn-driver.mts` 直接斷言對稱、平均不變與非筆記 ref 不受影響。
   - 完成證據：✅ 2026-11-27。`pnpm run check` exit 0、`pnpm run build` exit 0 後，`bash scripts/test-utility-ranking.sh`、`test-prune.sh`、`test-brief-scope.sh`、`test-pure-functions.sh` 都 exit 0。三項斷言綠燈；AC-1 改以比例判斷（分數約 4e-6，`s1/s0` 與 0.5 相差小於 1e-6），以舊程式重跑仍失敗。精煉（code-simplify）：把 `notePairOf` 從 `memoria.ts` 移到 `utils.ts` 讓三個讀取點共用，沒有複製一份；其餘為 no-op，recall 與 prune 各四行的讀取流程沒有抽出（見 TBD-4 的 N2）。brief 的 `keptRefs` 改為在觀察門檻前收合，兩半都有列的筆記不再被算兩次「未累積」。GitNexus impact：`applyUtilityWeighting` 為 CRITICAL（recall 主路徑，CLI、HTTP、UI、wiki file-query 都經過），行為只在筆記有效用列時改變，由 AC-4 回歸把關；`loadUtilityMeans`、`notePairOf` 為 LOW。
3. ✅ **AC-4 文件與回歸** — `docs/agents/architecture.md` UFL 段、`docs/OPERATIONS.md` 保留規則、CHANGELOG（Fixed 與升級注意）；跑 core、adapters、wiki、http-mcp 四組。相依：步驟 2。
   - 完成判準：CI 的 core、adapters、wiki、http-mcp、repo 五組全綠，`release:docs-check` 通過。
   - 完成證據：✅ 2026-11-27。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 都 exit 0；五組共 32 支腳本以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/<name>.sh` 逐一執行，全部 exit 0。第一輪 `test-cli-memory.sh` 的 issue-34 AC-1 失敗：它靠兩半各回報 1 與 0 來決定排序，合併後兩半都是 0.5，操控手段失效而非行為退步；改為把較低的那一半時間戳調早一年後兩個方向都通過（session 較舊留 `noteev-`，event 較舊留 `note-`）。`telemetry.ts` 沒有 diff。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 在哪一層合併：(a) 寫入時，回報任一半就同時記到兩半（和 `mark` 一致；既有資料不會自動補）；(b) 讀取時，recall 加權與 prune 依指紋合併兩半的效用（既有資料立即生效，兩半都被回報時要避免重複計算）。建議 (b)：不必回補既有資料，也不改寫入的語意 | 已解決（2026-11-27 使用者回「依照建議處理」）：採 (b)；盤點後 brief 的高效用區塊也只看單一 id，一併納入（AC-3） | 驗收條件、涉及檔案與分級 |
| TBD-2 | 兩半在同一次回報都列進 `--hits` 時，合併後觀察次數算兩次：平均效用不變，但 brief 的觀察門檻（2 次）一次回報就達到。可以接受，或改成取兩半中觀察次數較多的一列（兩半各回報一次時會少算） | 已解決（2026-11-27 使用者回「相加」）：兩半的觀察次數與效用總和直接相加；平均效用不受影響，舊資料裡一次回報兩半的筆記會較快達到 brief 的觀察門檻 | AC-3 |
| TBD-3 | review-095652d S1、S2、S4、N1、N4：consolidate 的行為也變了卻沒有測試與 CHANGELOG；AC-1 只測了留下 `note-` 的方向；完成證據沒寫命令與 exit code、沒記精煉；`test-cli-memory.sh` 的失敗訊息還寫 utility；CHANGELOG 沒寫 explicit 覆蓋兩半的合併語意 | 已解決（2026-11-27 使用者回「照建議」，選修正）：`test-prune.sh` 補 consolidate 斷言，`test-utility-ranking.sh` (E) 補反方向，兩者以舊程式都失敗；CHANGELOG 與 OPERATIONS 補 consolidate 與合併語意；步驟 2、3 的完成證據補命令、exit code 與精煉結果；失敗訊息改寫 | AC-1、AC-2、AC-4 |
| TBD-4 | review-095652d S3、N2、N5：README 缺風險 Medium 必填的 `**核准 commit**`；recall 與 prune 讀效用的流程重複；「風險與首要驗證」的完成證據還寫待核准後補上 | 已解決（2026-11-27 使用者回「照建議」）：S3、N5 修正，補 `**核准 commit**: dc1f192`（reviewer 依 acceptance.md 推導的同一基線），完成證據指向步驟 1；N2 不修：兩處開 DB 的方式不同，抽出共用函式要動 recall 主路徑，效益小 | AC-1～4 |
| TBD-5 | review-095652d N3：stale prune 查效用時每則筆記多帶另一半的 id，`IN` 的參數數量加倍；better-sqlite3 上限 32766，約 16k 則過期筆記候選時 `prune --stale-days` 會丟例外 | 不影響本次交付（2026-11-27 使用者回「照建議」，選記入待確認）。追蹤：無；本機資料約 2k 筆記憶，離上限很遠，原本的上限也存在（約 32k 個候選），之後資料量接近時再分批查詢 | AC-2 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-26 | 建立（來源：issue-39 review-03683f0 N1；使用者 2026-11-26 回「照建議」：另開 issue）；驗收條件待 TBD-1 決定 |
| 2026-11-27 | 補入 issue-39 TBD-5：skill 的效用敘述要對筆記也成立 |
| 2026-11-27 | TBD-1 使用者選 (b)，TBD-2 選相加；撰寫並核准 AC-1～4 |
| 2026-11-27 | 步驟 1～3 完成，待審查 |
| 2026-11-27 | review-095652d PASS，附 SHOULD FIX S1～S4、NICE TO HAVE N1～N5；使用者回「照建議」，結論記在 TBD-3～5，修正後送增量覆審 |

---
**建立日期**: 2026-11-26  
**分級**: Small  
**風險**: Medium\
**狀態**: 待審查
