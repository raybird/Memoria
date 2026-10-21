# Issue 23 - 全域升級會清空語意召回 helper 的依賴與模型，doctor 與文件都沒說 (Small)

## 概述

語意召回 helper 的依賴（`@libsql/client`、`@huggingface/transformers`）裝在全域套件的 `skills/memoria-vector/node_modules`，e5 模型快取也在同一棵樹裡。`npm i -g @raybird.chen/memoria@<新版>` 會整個換掉套件目錄，兩者一起被清空，之後 `mode:'vector'` 照設計 fail-open，回 `vector_timeout`／`vector_unavailable`，仍有字面命中、沒有錯誤訊息。

2026-10-21 維護者機器從 1.28.1 升到 1.30.0 時實際發生：
- `doctor` 報 `vector embedder: @huggingface/transformers missing`。偵測本身是對的，但 fix 文字只把成因歸給 `--omit=dev` 與 `NODE_ENV=production`，沒提到升級；照文件也不會想到升級後要跑 doctor。
- 模型快取不在 `~/.cache/huggingface`（該目錄沒有 e5 模型）。transformers.js 在 Node 下的預設是 `<@huggingface/transformers 套件目錄>/.cache/`（`dist/transformers.node.mjs` 的 `DEFAULT_CACHE_DIR`），實測模型在 `node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small`（121MB）。helper README 與 OPERATIONS.md 都寫成 `~/.cache/huggingface`。
- 重裝依賴後第一次執行 `vector-recall.mjs` 耗時 14.13 秒，第二次 0.99 秒；第一次超過 recall 的逾時（本機 `MEMORIA_VECTOR_TIMEOUT_MS=10000`，預設 4000），所以剛修好的頭幾次 recall 仍是 `vector_timeout`，看起來像沒修好。

當天第一次 `npm ci` 在 onnxruntime-node 的 postinstall（下載 CUDA 執行檔）出現 `UNKNOWN: unknown error, write`；同日在暫存目錄與全域套件目錄各重現一次，不加任何旗標都成功（723MB，含 CUDA provider），判定為偶發，不在本 issue 範圍。issue-19 完成證據裡「不加 skip 會失敗」的說法一併更正。

本 issue 只讓「升級後要重裝、重裝後要暖機」這件事在 doctor 與文件裡看得到，不改執行行為。把依賴搬出套件目錄（根治）另開 issue。

## 涉及檔案

- `src/cli/commands/doctor.ts` - `vector embedder` 失敗時的 fix 文字補上升級成因與暖機提示
- `scripts/test-vector-recall.sh` - 新增 doctor 報 embedder 缺少時的 fix 斷言
- `skills/memoria-vector/README.md` - 模型快取位置更正、升級後重裝與暖機
- `docs/OPERATIONS.md` - 模型快取位置更正；「silently give you no semantic recall」補上升級這一項；`doctor` 表格的 fix 說明
- `docs/INSTALL.md` - Method A 補升級步驟
- `docs/issues/issue-19/README.md` - 更正 CUDA postinstall 的說法

## 驗收條件

1. **AC-1**：`LIBSQL_URL` 已設、provider 為 `local`、helper 只有 `--omit=dev` 依賴時，`doctor --json` 的 `vector embedder` 為 `ok:false`，其 `fix` 同時指出 (a) 既有成因 `--omit=dev`／`NODE_ENV=production`、(b) 全域 npm 升級會換掉該目錄、需在升級後重裝、(c) 重裝後第一次查詢可能逾時，先直接執行一次 helper 暖機；並仍給出在 `embedderDir` 內執行的安裝命令 — 檢查方式：`scripts/test-vector-recall.sh` 新增案例，以 `--omit=dev` 的 helper 跑 `doctor --json`，斷言上述字串
2. **AC-2**：helper README 與 OPERATIONS.md 不再宣稱模型快取在 `~/.cache/huggingface`，改寫實際位置（`@huggingface/transformers` 套件目錄下的 `.cache/`），並說明它隨全域升級被清除 — 檢查方式：`grep -rn 'cache/huggingface' skills/memoria-vector/README.md docs/OPERATIONS.md` 無結果；人工閱讀兩處新段落
3. **AC-3**：INSTALL.md Method A 與 OPERATIONS.md 的語意召回段落各有一段「升級後」步驟：重裝 helper 依賴的命令、以 `doctor` 確認 `vector embedder` 與 `vector coverage`、暖機一次 — 檢查方式：人工閱讀；命令在維護者機器上照抄執行一次可得 `doctor` 全綠與 `route_mode=hybrid_vector`
4. **AC-4**：issue-19 README 的完成證據不再說「不加 skip 會失敗」，改為記錄偶發與兩次重現成功 — 檢查方式：人工閱讀

- **核准日期**: 2026-10-21
- **核准來源**: 使用者 2026-10-21 對範圍題選「A」（建議內容：只改 doctor 的 fix 文字與文件——fix 補上升級成因與暖機、helper README 更正模型快取位置、INSTALL.md 補升級步驟、test-vector-recall.sh 補斷言鎖住 fix 文字；不改執行行為），並指示依賴搬出套件目錄另開 issue。AC-1～AC-4 由該範圍展開，使用者 2026-10-21 回覆「照建議」核准

## 風險與首要驗證

**風險**: Low — 只改一段 fix 字串與文件，不動 recall、doctor 的判定邏輯與輸出結構。唯一要先確認的是 AC-1 的測試真的會走到 `embedderInstalled === false` 這一支（CI 以 `--omit=dev` 安裝 helper、`MEMORIA_EMBED_PROVIDER` 未設時預設為 `local`），先取得改字串前的紅燈。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | AC-1～AC-4 條文需使用者確認 | 已解決 | 2026-10-21 使用者回覆「照建議」，全部核准 |
| TBD-2 | 依賴與模型快取搬出套件目錄，讓升級不再清空（會推翻 2026-08-25「helper 依賴裝在全域套件底下、不再設 `MEMORIA_VECTOR_RECALL_CMD`」的決定） | 另開 issue | 不影響本 issue；本 issue 只讓問題看得到 |

## 實作與驗證步驟

1. ✅ **AC-1：doctor fix 文字** — 驗證方式：先在 `test-vector-recall.sh` 加斷言取得紅燈（現行 fix 不含升級字樣），再改 `doctor.ts` 的字串至綠燈；`pnpm run check`、build 後跑 `test-vector-recall.sh`
   - 完成證據（2026-10-21）：
     - 測試前提：本機 checkout 的 helper 裝了完整依賴、CI 只裝 `--omit=dev`，兩者的 doctor 狀態不同。新案例因此自己組一個暫存版面（`dist/cli.mjs`、`package.json`、指回 repo 的 `node_modules` symlink、沒有 `node_modules` 的 helper），不論機器怎麼安裝都會走到 `embedderInstalled === false`。
     - 紅燈：`bash scripts/test-vector-recall.sh` → exit 1，`Error: embedder fix must mention "npm i -g", got: MEMORIA_EMBED_PROVIDER=local needs @huggingface/transformers, …`。既有的兩個成因斷言都通過，只在升級成因失敗。
     - 最小實作：`vectorChecks` 的 embedder fix 字串補上「每次 `npm i -g` 升級都會換掉這個目錄，連同快取的模型」「每次升級後重裝」，以及暖機命令 `echo '{"query":"warm up"}' | node vector-recall.mjs`（空的 stdin 會直接回空結果、不載入模型，所以命令帶一個查詢）。
     - 綠燈：`pnpm run check` 無錯；`pnpm run build` 後 `node dist/cli.mjs --help` 正常；`test-vector-recall.sh` exit 0，新行 `enabled + embedder missing -> fix names the upgrade wipe and the warm-up`。
     - GitNexus：`vectorChecks` 是模組內私有函式，不在索引中；grep 確認唯一呼叫端是 `registerDoctorCommand`，它的 impact 為 LOW（直接呼叫端只有 `src/cli.ts` 的 `run`）。只改字串，doctor 的判定邏輯與 JSON 結構不變。
     - 精煉：code-simplify no-op。改動是一段字串和一個測試區塊，沒有可收斂的重複。
     - 回歸：CI 全套 34 支依 `ci.yml` 順序逐支執行（清除 `LIBSQL_URL`、`MEMORIA_HOME` 等開發者環境變數，先 `pnpm run build` 與 `release:package`）全數 PASS、exit 0。被測對象是 `817d69a` 加上本次全部改動的工作區，2026-10-21T10:02。
2. ✅ **AC-2、AC-3：文件更正與升級步驟**（相依：步驟 1，fix 文字與文件用同一套說法）— 驗證方式：AC-2 的 grep 無結果；AC-3 的命令在維護者機器照抄執行一次，記錄 `doctor` 輸出與 recall 的 `route_mode`
   - 完成證據（2026-10-21）：
     - AC-2：`grep -rn 'cache/huggingface' skills/memoria-vector/README.md docs/OPERATIONS.md` 無結果（exit 1）。兩處改寫為模型快取在 `node_modules/@huggingface/transformers/.cache/`、隨 `node_modules` 一起被移除。位置依據 transformers.js 的 `DEFAULT_CACHE_DIR`，以及實機目錄 `.cache/Xenova/multilingual-e5-small`。
     - AC-3：INSTALL.md Method A 新增升級段落；OPERATIONS.md 新增「3. Every global upgrade wipes …」，`doctor` 表格的 fix 說明同步更新，標題改為 Three things（repo 內沒有連到舊標題的錨點）。
     - AC-3 實機重現升級後的狀態（維護者機器，全域 1.30.0）：刪除 helper 的 `node_modules` → `doctor` 報 `✗ vector embedder: @huggingface/transformers missing`。照抄文件命令：`npm install` 用 24 秒裝回 65 個套件 → 暖機 17.58 秒（含模型下載），之後 `.cache/Xenova/multilingual-e5-small` 存在 → `doctor` 顯示 `✓ vector embedder: installed`、`vector coverage: embedded=818 expected=818 missing=0` → 暖機後第一次 `recall --mode vector` 就是 `route_mode=hybrid_vector`（971ms）。向量庫在 `LIBSQL_URL`，不受影響，不需要重新 ingest。
     - 另有一次是在既有安裝上直接執行（模型仍在快取），暖機只要 1.03 秒，不能當作升級後狀態的證據，所以又做了上面的重現。
3. ✅ **AC-4：issue-19 證據更正** — 驗證方式：人工閱讀
   - 完成證據（2026-10-21）：issue-19 步驟 4 的說法由「不加 skip 會失敗」改為「當下出現偶發錯誤；同日兩次重現不加 skip 都成功」，並連到本 issue。

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-21 | 建立；範圍決策「A：只改 doctor fix 文字與文件」，依賴搬出套件目錄另開 issue | - |
| 2026-10-21 | AC-1～AC-4 核准（「照建議」） | - |

---
**建立日期**: 2026-10-21  
**分級**: Small  
**風險**: Low\
**狀態**: 進行中
