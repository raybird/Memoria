# Issue 25 - 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)，本檔不重複。

## 設計方案

### 位置

```text
${XDG_CACHE_HOME:-$HOME/.cache}/memoria/vector/
  <hash>/                 # hash = sha256(helper 的 package-lock.json) 前 16 碼
    package.json          # 從 helper 複製
    package-lock.json     # 從 helper 複製
    node_modules/         # npm ci 的結果
    .complete             # 安裝與暖機都成功後才寫入；解析只認有這個標記的目錄
  models/                 # transformers.js 的 cacheDir（僅在依賴來自快取目錄時使用）
```

- 雜湊只看 `package-lock.json`，因為它完整決定安裝結果。升級後內容相同，就會解析到同一個目錄。
- `.complete` 是 SCN-006 的防線：中斷的安裝沒有標記，不會被當成已安裝。

### 解析順序（`skills/memoria-vector/deps.mjs`）

```js
// 回傳 { source: 'sibling' | 'cache' | 'none', dir, modelCacheDir: string | null, cacheDir: string | null }
export function resolveDepsLocation(helperDir, env = process.env)
// 以上述位置載入一個依賴，回傳 module namespace
export async function importDep(name)
// `node deps.mjs` 直接執行時印出 resolveDepsLocation() 的 JSON，供 doctor 與 setup --vector 使用
```

1. helper 目錄旁邊有 `node_modules`（整個目錄，不逐一比對套件）→ `source: 'sibling'`，用一般的 `import(name)`，`modelCacheDir: null`（transformers.js 維持預設）。這與現在的行為完全相同（SCN-004）。
2. 否則找快取目錄中「目前 lock 雜湊」的目錄，且要有 `.complete` → `source: 'cache'`，以該目錄解析進入點後 `import()`；`modelCacheDir` 為 `.../vector/models`，在 `embed.mjs` 建 pipeline 前設定 `transformers.env.cacheDir`。
3. 兩者都沒有 → 與現在相同的錯誤（`embed.mjs` 既有的 `--omit=dev` 說明），訊息再補上 `memoria setup --vector`。

進入點的解析方式由 S0 決定：候選做法是 `createRequire(<dir>/package.json).resolve(name)` 取 CJS 進入點再 `import()`，或讀套件的 `exports` 取 `import` 條件。兩個依賴都同時提供 ESM 與 CJS（`@libsql/client`：`lib-esm`／`lib-cjs`；transformers：`transformers.node.mjs`／`.cjs`）。

### 呼叫端

- `vector-recall.mjs`、`vector-ingest.mjs` 的 `import { createClient } from '@libsql/client'` 改為 `await importDep('@libsql/client')`。
- `embed.mjs` 的 `await import('@huggingface/transformers')` 改為 `importDep`，並在 `source: 'cache'` 時設定 `env.cacheDir`。
- helper 的 stdin／stdout 契約不變（HANDOVER §8：下游依賴它）。

### doctor（`inspectVectorLayer`）

- `embedderInstalled` 依同一套順序判定：旁邊有 transformers，或快取目錄有目前雜湊的 `.complete` 且內含 transformers。
- `embedderDir` 回報實際使用的目錄，另加 `embedderSource: 'sibling' | 'cache' | null`。
- 雜湊的算法在 TS 端與 `deps.mjs` 各有一份是漂移風險：TS 端改為以 `node` 子行程執行 `deps.mjs`，只保留一份（S2 決定）。子行程失敗時退回變更前的判定（只看旁邊的 `node_modules`）。測試以獨立計算的雜湊比對 doctor 修法裡的目錄。
- doctor 的 `--json` 不新增欄位，目錄透過 check 的 `value`／`fix` 呈現；`VectorLayerReport` 內部多 `embedderSource`、`embedderCacheDir`。
- 修法字串改為指向 `memoria setup --vector`；保留 `--omit=dev`／`NODE_ENV=production` 的說明（旁邊安裝的情境仍適用）。

### `setup --vector`

1. 照現有步驟完成 setup，再加一步 `vector-deps`。
2. 建立 `<hash>.partial-<pid>` 暫存目錄，複製 `package.json`／`package-lock.json`，執行 `npm ci --no-audit --no-fund`（子行程環境移除 `NODE_ENV`）。provider 為 `local` 時加 `--include=dev`；為 `stub` 時加 `--omit=dev`、不暖機——stub 只需要 `@libsql/client`，CI 也由此路徑測試，不必另靠 npm 設定。
3. provider 為 `local` 時，在**暫存目錄**上暖機：子行程先以 `deps.mjs` 的 `useDepsLocation` 把依賴位置釘在暫存目錄，再經 `embed.mjs` embed 一次 `warm up`（不需要 `LIBSQL_URL`），模型下載到 `deps.mjs` 的 `modelCacheDirFor()`，也就是 `models/`。這樣暖機的一定是即將被標記的那份安裝，不受旁邊的 `node_modules` 影響。
4. npm 與暖機都成功後，才在暫存目錄寫 `.complete`，再改名成正式的 `<hash>/`。任何一步失敗、Ctrl-C 或行程被砍，都不會留下標記；失敗時刪除暫存目錄，以非 0 結束。
   - 原本的寫法是先改名、寫標記再暖機，失敗才移除標記；中斷暖機就會留下標記，經審查 1ffc3a2 M-1 指出後改為現行做法。
5. 已有 `.complete`（local 還要有 transformers）時沿用、不重裝，直接在正式目錄上暖機；暖機失敗則移除標記。殘餘情境：沿用時暖機中途被砍會留下原有標記。只有使用者手動刪過 `models/` 時暖機才需要下載，所以影響有限。
6. 開始前，刪除行程已不存在的 `<hash>.partial-*` 目錄；仍在執行的同時安裝不受影響。npm 逾時 30 分鐘，暖機逾時 15 分鐘。
7. 錯誤訊息：暖機子行程只回傳 `error.message`；npm 失敗時保留 `npm error code …` 起算的四行，加上 log 路徑那一行。
8. `--json` 的 step log 為 `{ step: 'vector-deps', path, provider, reused, warmedUp, modelCacheDir, shadowedBy }`；`modelCacheDir` 取自暖機子行程（來源是 `deps.mjs`）。`shadowedBy` 在 helper 旁邊有 `node_modules` 時指出它，那時快取目錄的安裝不會被使用，文字模式另印一行提示。
9. `XDG_CACHE_HOME` 不是絕對路徑時依 XDG 規範忽略，退回 `~/.cache`。

## 實作步驟

1. ✅ **S0 可行性驗證**（SCN 全部的前提）— 依 README「首要驗證」做 Node 18 與 Node 22 的 spike，決定進入點的解析方式。完成判準：兩個版本都完成 embed 與 `vector_top_k`，記錄命令與輸出；失敗則停下來回報。
   - 完成證據（2026-10-21，維護者機器）：
     - 環境：依賴以 `npm ci --include=dev` 裝在 `~/.cache/i25-spike/deps`（65 個套件，723M）；helper 的 `*.mjs` 複製到 `~/.cache/i25-spike/helper`，該目錄與所有上層都沒有 `node_modules`。spike 腳本以指定目錄解析兩個依賴，設定 `env.cacheDir` 後跑 local provider 的 embed（e5-small、q8），再對暫存 libSQL 建向量索引並查 `vector_top_k`。
     - 對照組：同一目錄直接 `import('@huggingface/transformers')` → `ERR_MODULE_NOT_FOUND`，證明環境確實隔離。
     - 結果：四種組合都輸出 `dims:[3,384]`、`top:["related","unrelated"]`。
       - Node v18.18.2 CJS：21267 ms，含第一次下載模型。
       - Node v18.18.2 ESM：1005 ms。
       - Node v22.20.0 CJS：970 ms。
       - Node v22.20.0 ESM：863 ms。
     - 模型快取：寫到指定的 `models/`（130M），依賴目錄的 `@huggingface/transformers/.cache` 不存在，表示 `env.cacheDir` 確實生效。
     - 決定採用 CJS 進入點，也就是 `createRequire(<dir>/package.json).resolve(name)` 加 `import()`。理由：它走 Node 自己的解析器（`require` 條件），ESM 路線則要自己解析 `exports`——spike 第一版就因 transformers 的 `exports` 不開放 `./package.json` 而失敗，得改寫才通過，屬於脆弱的寫法。代價是 sibling 路徑載入 ESM 建置、cache 路徑載入 CJS 建置，兩者是同一版本的兩種建置。S1 要以測試確認兩條路徑對外的結果相同（向量維度與查詢結果）。
2. ✅ **S1 helper 依賴解析**（SCN-002、SCN-003、SCN-004、SCN-005；相依 S0）— `deps.mjs` 與三個呼叫端。完成判準：`test-vector-recall.sh` 新案例在「旁邊無依賴、快取目錄有 stub 用的 `@libsql/client`」下 recall 與 ingest 成功；旁邊有依賴時解析到 sibling、`modelCacheDir` 為 null；lock 雜湊不同的目錄不被採用；既有案例全綠。
   - 完成證據（2026-10-21）：
     - 紅燈：新案例在 `deps.mjs` 之前失敗於 `ERR_MODULE_NOT_FOUND: Cannot find package '@libsql/client' imported from …/helper-cache-deps/vector-ingest.mjs`。
     - 綠燈：`bash scripts/test-vector-recall.sh` → `[vector] ok`。新案例四行：`cache dir without .complete -> not used`、ingest＋recall 由快取目錄載入（SCN-005）、`changed lockfile -> old cache dir ignored`（SCN-003）、`sibling node_modules -> source=sibling, model cache untouched`（SCN-004）。
     - 變異：把 `.complete` 判斷改成只看目錄存在 → `✗ an install without .complete must not be used`；已還原。
     - 既有案例：issue-11 的隔離測試改為連同 `deps.mjs` 一起複製（`embed.mjs` 現在 import 它）；`bash scripts/test-pure-functions.sh` → `[pure] ok`。
     - 精煉時補的防護：`deps.mjs` 判斷「是否被直接執行」原本直接呼叫 `realpathSync(process.argv[1])`，以 `node -e '…' no-such-file` 匯入時會丟出 `ENOENT`，連帶讓匯入它的 helper 失敗；改為包在 try 裡。新增回歸案例 `deps.mjs import with a non-path argv[1] -> silent, no throw`：舊寫法得到 `ENOENT`，新寫法為 `ok`。
3. ✅ **S2 doctor 探測與修法**（SCN-001、SCN-003、SCN-004；相依 S1）— 完成判準：doctor 對 sibling／cache／皆無三種狀態各有斷言，`embedderSource` 與目錄正確，修法含 `setup --vector`；`test-npm-install.sh`、`test-no-clone-install.sh` 的 `every(ok)` 不受影響。
   - 完成證據（2026-10-21）：
     - 紅燈：`embedder fix must mention "memoria setup --vector"`（舊修法文字）。
     - 綠燈：`test-vector-recall.sh` 新增五個 doctor 情境：
       - 全域安裝形狀（皆無）→ 修法含 `memoria setup --vector` 與獨立計算的 `$XDG_CACHE_HOME/memoria/vector/<lock hash>`。
       - 快取目錄沒有 `.complete` → 仍失敗（與 S3 合起來覆蓋 SCN-006 的 doctor 部分）。
       - 完成的快取安裝 → 通過並指出該目錄。
       - 快取安裝缺 transformers → 失敗並指向 `setup --vector`。
       - 旁邊有 `node_modules` 時即使快取已完成也以旁邊為準，修法維持 issue-23 的就地 `npm install` 說法（SCN-004）。
     - issue-23 的斷言隨之調整：全域安裝形狀的修法改指 `setup --vector`，`--omit=dev`／`NODE_ENV=production` 等斷言移到 sibling 情境。
     - 變異：把 `deps.mjs` 的 sibling／cache 順序對調 → `✗ sibling node_modules without transformers must fail even with a cache install`；已還原。
     - 安裝測試：`test-npm-install.sh`、`test-no-clone-install.sh` 增加「`deps.mjs` 與 `package-lock.json` 隨套件發佈」的斷言，兩者 `ok`。兩條發佈路徑（npm `files`、release tarball）都以 `*.mjs` glob 收錄，此斷言防的是日後改成逐檔列舉。
4. ✅ **S3 `setup --vector`**（SCN-001、SCN-006；相依 S1）— 完成判準：`test-bootstrap.sh` 以 `XDG_CACHE_HOME` 指向暫存目錄執行，安裝只裝 `@libsql/client`（CI 不下載 transformers，以 npm 的 `npm_config_omit` 或等價方式控制，由實作選擇並記錄），斷言 `.complete` 與 step log；安裝失敗情境（PATH 裡的 npm 換成必定失敗的假命令）斷言非 0、沒有 `.complete`、doctor 仍為失敗。local provider 的完整安裝與暖機在維護者機器手動驗證：刪掉全域套件內的 `node_modules`，跑 `setup --vector`，再模擬升級（重裝同版全域套件），recall 仍為 `hybrid_vector`，並記錄模型沒有重新下載的證據（SCN-001、SCN-002）。
   - 完成證據（2026-10-21）：
     - CI 路徑由 provider 決定，不靠 npm 設定：stub 用 `--omit=dev`、不暖機。
     - 紅燈：`error: unknown option '--vector'`。
     - 綠燈：`bash scripts/test-bootstrap.sh` → `[bootstrap] ok`。新三行：
       - 依賴在 `$XDG_CACHE_HOME/memoria/vector/<lock hash>` 並寫入 `.complete`，stub 不裝 transformers，`shadowedBy` 只在旁邊有 `node_modules` 時出現。
       - 第二次執行 `reused: true`。
       - SCN-006：PATH 換成必定失敗的假 npm → 非 0、輸出帶 npm 的原因、快取目錄沒有殘留。
     - 變異：拿掉失敗時刪除暫存目錄 → `✗ SCN-006: a failed install left files behind`；已還原。
     - 手動驗證（local provider，維護者機器）。沒有動到真正的全域套件與 `~/.memoria`，改以本分支 `npm pack` 安裝到隔離 prefix（`~/.cache/i25-manual/prefix`），`XDG_CACHE_HOME`／`MEMORIA_HOME`／`LIBSQL_URL` 都指向同目錄下的暫存位置，recall timeout 用預設 4000ms：
       - setup 前：doctor `✗ vector embedder: no dependency install for this helper (none beside it, none in …/xdg/memoria/vector/690ebce65e137374)`，修法指向 `memoria setup --vector`。
       - `setup --vector`：53 秒，產生 `690ebce65e137374/`（723M）與 `models/`（130M，4 個檔，含 `model_quantized.onnx` 118308185 bytes）。依賴目錄內沒有 `@huggingface/transformers/.cache`，模型確實寫在 `models/`。
       - setup 後（SCN-001）：doctor 的 vector 四項全綠（`@huggingface/transformers installed (…/690ebce65e137374)`）。remember 兩筆後 ingest：`{"ok":true,"embedded":9,"skipped":3}`、coverage `missing=0`。
       - recall：`npm 更新之後 embedding 不見了`（與記憶沒有共同字詞）→ `route_mode=vector`，第一筆是相關記憶，1596ms；`語意召回 依賴` → `hybrid_vector`。字面完全不重疊的查詢沒有可融合的字面命中，回 `vector` 是既有的路由語意；兩者都代表語意層有作用，不是 `vector_unavailable`／`vector_timeout`。
       - 模擬升級（SCN-002）：`npm rm -g` 再 `npm i -g` 同一 tgz 到同一 prefix。helper 目錄 inode 由 25845322 變為 25845326，裡面只有發佈檔、沒有 `node_modules`。
       - 升級後：doctor 四項全綠；兩個查詢分別回 `vector`（1224ms）與 `hybrid_vector`（1155ms），第一筆都是相關記憶；`models/` 四個檔的 mtime 與大小前後完全相同，表示沒有重新下載。
       - Node 18：以 v18.18.2 與 v22.20.0 直接執行該 prefix 裡的 `vector-recall.mjs`（旁邊沒有依賴、從快取目錄載入 local 模型），兩者回傳相同的 top-2。
5. ✅ **S4 常青文件**（相依 S1～S3）— helper README、INSTALL、OPERATIONS、README／README.zh-TW 的 `setup` 旗標、CLAUDE.md Architecture。issue-23 新增的「升級後重裝」段落改寫為 `setup --vector`，並說明依賴清單改變時才需要重跑。完成判準：文件與 doctor 修法用同一套說法；人工閱讀。
   - 完成證據（2026-10-21，人工閱讀）：
     - helper README「Install」：全域安裝用 `setup --vector`、checkout 用就地 `npm install`；Scripts 表格新增 `deps.mjs`。
     - INSTALL：升級段改為 `setup --vector` 加 `doctor`，並提醒沒設 `MEMORIA_HOME` 時要加 `--memoria-home`。
     - OPERATIONS：doctor 表格拆成「旁邊沒有依賴」與「旁邊有 `node_modules` 但缺 transformers」兩列；安裝段、模型位置段、「Three things」第 1、3 點都改寫。
     - MCP_INTEGRATION 的一次性安裝命令。
     - README／README.zh-TW 的 `--vector` 段落。
     - CLAUDE.md／AGENTS.md 的 helper 依賴位置說明。
     - 舊雜湊目錄不自動清除（TBD-2）寫在 helper README、INSTALL、OPERATIONS 三處。
     - 用 `grep` 掃過，沒有其他常青文件還在指示到套件目錄就地 `npm install`；CHANGELOG 與 RFC 是歷史紀錄，維持原文。
   - 精煉（code-simplify）：doctor 與 `setup --vector` 原本各自執行 `node deps.mjs` 並解析結果，合併為 `src/core/recall-vector.ts` 匯出的 `probeDepsLocation`；doctor 的退回判定留在 `inspectVectorLayer`。合併後重跑 check、build 與完整 CI。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| 第一次啟用語意召回 | `cd <全域套件>/skills/memoria-vector && npm install`，再暖機 | `memoria setup --vector` |
| 升級（依賴不變） | 重裝 723MB、重新下載模型、暖機 | 不需動作 |
| 升級（依賴改變） | 同上 | doctor 提示 → `memoria setup --vector` |
| 開發者 checkout／下游 image | 旁邊的 `node_modules` | 不變 |

## 測試策略

| 驗收 | 層級 | 方式 |
|------|------|------|
| SCN-001 | e2e（CI，stub）＋手動（local） | `test-bootstrap.sh` 驗安裝流程；local 模型與暖機在維護者機器驗 |
| SCN-002 | 手動 | 維護者機器模擬升級；CI 以「換掉 helper 旁的目錄內容、快取目錄不動」近似 |
| SCN-003 | e2e（CI） | `test-vector-recall.sh`：改寫暫存 helper 複本的 lock 內容，斷言 doctor 失敗與不採用舊目錄 |
| SCN-004 | e2e（CI） | 既有案例（CI 用旁邊的 `--omit=dev` 安裝）全綠，並新增「`modelCacheDir` 為 null」斷言 |
| SCN-005 | e2e（CI，stub） | `test-vector-recall.sh`：快取目錄來源下跑 `vector-ingest.mjs` |
| SCN-006 | e2e（CI） | `test-bootstrap.sh`：假 npm 失敗 |

CI 不跑 local embedding（project.md 環境限制），所以 local provider 的部分以維護者機器的手動證據補足，並記錄量測值。

## 檢查清單

- [x] S0 的兩個 Node 版本 spike 都有證據
- [x] 旁邊有 `node_modules` 時行為與模型快取位置不變（下游契約）
- [x] helper 的 stdin／stdout 契約不變
- [x] 雜湊算法只有一份來源（`deps.mjs`；TS 端經 `probeDepsLocation` 詢問）
- [x] 沒有新增 runtime 依賴（Memoria 本體仍只有 `better-sqlite3`、`commander`、`zod`）
- [x] 新旗標寫進 README／README.zh-TW；CLAUDE.md 的命令清單只列命令名稱、不列旗標，改在 Architecture 說明
- [x] GitNexus impact（`inspectVectorLayer`、setup 的 action）與提交前 `detect_changes`
- [ ] 發版時 CHANGELOG 寫明依賴解析順序的變更（HANDOVER §8 下游契約；審查 1ffc3a2 N-8）

## 審查回應

### review-1ffc3a2（RETURN TO execute-task）

修正後各項的處理與證據（2026-10-21）：

- **M-1 暖機中斷留下 `.complete`**：已修正。暖機改在暫存目錄上進行，兩者都成功後才寫標記再改名，見「`setup --vector`」第 3、4 點。
  - 回歸：`test-bootstrap.sh` 的 `warm-up killed mid-way -> no .complete anywhere`。做法是用假 transformers 讓暖機卡住，再以 `kill -9` 結束 setup 與暖機子行程。舊寫法下得到 `✗ M-1: a warm-up killed mid-way left .complete`。
- **S-1 失敗原因被截掉**：已修正，見第 7 點。
  - 回歸：`warm-up failure -> non-zero with the embedder's reason…`。舊寫法下得到 `✗ warm-up failure lost its reason`，輸出只剩 stack frame。
  - 回歸：`noisy npm failure -> the reason line survives`。假 npm 先印原因，再印 12 行雜訊和 log 路徑。
- **S-2 sibling 影響暖機**：已修正，暖機固定在暫存目錄上。
  - 回歸：`sibling node_modules present -> warm-up still exercises the cache install, shadowedBy reported`。舊寫法下 setup 以非 0 結束。
- **S-3 sibling 路徑依賴 `homedir()`**：已修正。sibling 分支的 `cacheDir` 包在 try 裡，失敗時給 null。
  - 回歸：`test-vector-recall.sh` 的 `sibling resolution -> independent of os.homedir()`，以 `--import` 預載讓 `os.homedir()` 拋錯。舊 `deps.mjs` 會拋出 `uv_os_homedir: no home`。
- **S-4 暖機分支與模型快取位置缺 CI 證據**：已補。
  - `test-bootstrap.sh` 以 installed 形狀的套件複本搭配假 npm 和假 transformers，涵蓋暖機成功與失敗兩條路徑，並斷言 `env.cacheDir` 和回報的 `modelCacheDir` 都是 `$XDG_CACHE_HOME/memoria/vector/models`。
  - `test-vector-recall.sh` 的 `sibling deps -> embed.mjs leaves the model cache at transformers.js's default` 與 `cache deps -> … models`。變異：把 `embed.mjs` 改成一律設定 cacheDir 後，得到 `Error: sibling deps must leave env.cacheDir at the transformers.js default, got /mutated`。
- **N-1** 已修正，見第 6 點。回歸：`partial dir of a dead run -> reclaimed`；舊寫法下得到 `✗ a dead run's partial dir was left in place`。
- **N-2** 已修正，見第 9 點。回歸：`relative XDG_CACHE_HOME -> ignored, falls back to ~/.cache`；舊 `deps.mjs` 回傳 `relcache/memoria/vector/…`。
- **N-3** 已修正。模型目錄只在 `deps.mjs` 的 `modelCacheDirFor()` 定義，`runtime.ts` 改取暖機子行程的輸出。
- **N-4** 已修正。`deps.mjs` 只匯出外部有使用的 `resolveDepsLocation`、`modelCacheDirFor`、`useDepsLocation`、`importDep`、`depsLocation`。
- **N-5** 已修正，npm 逾時 30 分鐘。
- **N-6** 已修正。doctor 的修法加註「以 `MEMORIA_HOME` 或 `--memoria-home` 執行」，否則會在目前目錄建立 `./memoria`。
- **N-7** 已修正。`node -e '…' <deps.mjs 路徑>` 這種情況原本會誤判為直接執行並多印 JSON，在 S-3 的回歸測試裡實際觸發；改為 eval 模式一律不輸出。
- **N-8** 檢查清單已勾選 GitNexus 項目，並新增發版時寫 CHANGELOG 的待辦。
