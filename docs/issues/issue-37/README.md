# Issue 37 - remember 之後語意召回還查不到這筆，要到收尾跑 doctor 才看得到 (Small)

## 概述

`remember` 會自動建立 tree index，但不會寫進向量庫。在補上向量之前，語意召回查不到這筆記憶，而且沒有任何錯誤訊息。目前只有收尾時跑 `doctor`，`vector coverage` 才會顯示 `missing>0` 並給出修法。

2026-11-25 對 9 個下游 session 做使用體驗調查，有 3 份回報這件事：每次收尾都缺 8 筆左右，要手動複製那條很長的修法來跑；也有 session 剛寫完筆記就以語意查詢找不到它，不知道原因。

本 issue 讓 `remember` 在語意召回啟用、向量庫有缺口時，當下就說出來，並告訴使用者怎麼補。`remember` 本身不碰向量庫、不載入模型，速度不變（2026-11-25 決定不在 remember 內自動 ingest）。

## 涉及檔案

- `src/cli/commands/remember.ts` - 寫入成功後檢查向量覆蓋率，有缺口時提示；`--json` 加欄位
- `src/core/recall-vector.ts` - 把 `inspectVectorLayer()` 的覆蓋率計算抽成 `measureVectorCoverage()`，兩者共用同一份計算（`countEmbeddedRows` 以 `NOT INDEXED` 讀本機向量庫），`inspectVectorLayer()` 的結果不變；由 `src/core/index.ts` 匯出
- `CHANGELOG.md` - `[Unreleased]` 的 `### Added`
- `scripts/test-vector-recall.sh` - 新增：有缺口時提示、沒缺口或未啟用時不提示、檢查失敗時 remember 仍成功
- `docs/CLI.md`、`docs/CLI.zh-TW.md` - remember 段補說明
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - remember 段補一句：看到提示時可以當下補，或留到收尾

## 驗收條件

1. **AC-1**：語意召回啟用、remember 寫入後向量庫有缺口時，人讀輸出多一行，寫出缺幾筆，並指向 `memoria doctor` 的 vector coverage 修法；`--json` 的 `data` 多 `vector_missing`（數字）。檢查方式：以 stub provider 啟用語意召回，remember 一則新筆記，斷言提示與 `vector_missing >= 1`。
   - 失敗路徑：有缺口卻沒提示，或提示的筆數和 `doctor --json` 的 `missing` 不同。
2. **AC-2**：語意召回沒啟用、覆蓋率無法判定（遠端 libSQL、helper 被覆寫等），或沒有缺口時，輸出和變更前相同，`--json` 沒有 `vector_missing`。檢查方式：未設 `LIBSQL_URL` 時 remember，輸出與變更前逐位元組相同；補完向量後重跑同一筆（`created:false`），沒有提示。
   - 失敗路徑：沒啟用語意召回的使用者每次 remember 都看到提示。
3. **AC-3**：覆蓋率檢查本身失敗（向量庫讀不到、被鎖住）時，remember 照常成功，結束碼與寫入內容不受影響。檢查方式：把向量庫換成無法讀取的檔案再 remember，斷言 exit 0 與筆記已寫入。
   - 失敗路徑：檢查失敗讓 remember 失敗，或筆記被撤回。

- **核准日期**: 2026-11-25
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」；做法選「remember 輸出直接提示缺口」

## 風險與首要驗證

**風險**: Low — 無明顯未知，依一般相依順序實作與驗證。檢查是唯讀，而且只在寫入成功之後執行；AC-3 守住「檢查失敗不影響寫入」。

## 實作與驗證步驟

1. ✅ **AC-2 基準** — 未啟用語意召回時，保存 remember 的人讀與 `--json` 輸出。
   - 完成證據：✅ 2026-11-26。`evidence/baseline.sh` 在隔離資料根、清掉所有向量相關環境變數後跑 4 次人讀 remember（新筆記、同文字重寫、`--verify`、`--type skill --durable`）與 2 次 `--json`（新筆記與重寫，去掉 `timestamp`、`latency_ms`）。改動前在 main `97273a8` 的 build 上連跑兩次逐位元組相同，sha256 前 12 碼：`human.txt` 17aaef2cf246、`json.txt` 16db2c3907ce。
2. ✅ **AC-1、AC-3：提示缺口** — 在 `test-vector-recall.sh` 先寫 AC-1、AC-3 的斷言並取得紅燈，再改 `remember.ts`。
   - 完成證據：✅ 2026-11-26。新增 `[vector] issue-37` 一段，以 stub provider、從未 ingest 的向量庫寫兩則筆記。紅燈（改動前的 build）：`✗ AC-1：--json 的 data.vector_missing (undefined) 應等於 doctor 的 missing (9)`、人讀輸出沒有提示等 4 項失敗；同段的 AC-2（補完後重寫、未啟用、helper 被覆寫）與 AC-3（向量庫是非 SQLite 檔案、是目錄）斷言在舊程式上就通過，用來守住回歸。實作：`remember.ts` 寫入成功後呼叫 `measureVectorCoverage(core.paths.dbPath)`，包在 try/catch 裡，缺口大於 0 才在人讀輸出加一行、`--json` 的 `data` 加 `vector_missing`。覆蓋率計算從 `inspectVectorLayer()` 抽出共用，是為了讓兩邊的筆數同一份來源，也避開 `inspectVectorLayer()` 另外做的 embedder 探測（會 spawn `deps.mjs`），remember 不因此變慢。綠燈：`[vector] issue-37` 印出「有缺口時提示且筆數與 doctor 一致；補完、未啟用、覆寫時不提示；向量庫讀不到時照常寫入」，整支 `test-vector-recall.sh` exit 0。GitNexus：`inspectVectorLayer` 影響評為 CRITICAL（doctor、setup 直接呼叫），所以只抽出計算、不改判定順序；`test-setup-onboarding.sh` 與 doctor 相關段落全綠。`remember` 的影響為 LOW。
3. ✅ **AC-2 回歸與文件** — 比對步驟 1 的基準；更新 `docs/CLI.md`、`docs/CLI.zh-TW.md`、`DEPLOYED_SKILL.md`；跑 `core`、`http-mcp` 組。
   - 完成證據：✅ 2026-11-26。改動後的 build 重跑 `evidence/baseline.sh`，`diff -r` 與基準相同，sha256 一致。`docs/CLI.md`、`docs/CLI.zh-TW.md` 的本地存取段之後加一段說明提示、`data.vector_missing` 與不提示的情況；`DEPLOYED_SKILL.md` remember 段加一句：看到提示時要語意查這筆就先跑 doctor 的修法，否則收尾會補。以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`（地雷 M-4）跑 core 組 10 支與 http-mcp 組 5 支，全部 exit 0；文件改完後再跑 `test-bootstrap.sh`、`test-setup-onboarding.sh`、`test-npm-install.sh`，三支 exit 0、沒有 ✗。`pnpm run check`、`check-deployed-skill-sync.mjs`、`release:docs-check` 通過。精煉：`inspectVectorLayer()` 改在建立報告物件時直接帶入覆蓋率結果，不再先填 null 再覆寫；改完重跑 `test-vector-recall.sh` 與 `test-setup-onboarding.sh`，皆 exit 0、沒有 ✗。

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 AC-1～3（來源：9 個下游 session 的使用體驗調查） |
| 2026-11-26 | 實作時把覆蓋率計算從 `inspectVectorLayer()` 抽成共用函式，涉及檔案改為修改 `recall-vector.ts`（原寫不改）；驗收條件不變 |

---
**建立日期**: 2026-11-25  
**分級**: Small  
**風險**: Low\
**狀態**: 實作中
