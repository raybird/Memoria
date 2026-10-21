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
// 回傳 { source: 'sibling' | 'cache', dir, modelCacheDir: string | null }
export function resolveDepsLocation(helperDir, env = process.env)
// 以上述位置載入一個依賴，回傳 module namespace
export async function importDep(name)
```

1. helper 目錄旁邊有 `node_modules/<name>` → `source: 'sibling'`，用一般的 `import(name)`，`modelCacheDir: null`（transformers.js 維持預設）。這與現在的行為完全相同（SCN-004）。
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
- 雜湊的算法在 TS 端與 `deps.mjs` 各有一份是漂移風險：TS 端改為呼叫 `deps.mjs`（以 `node` 子行程或動態 import），只保留一份。由 S2 決定，並在測試中斷言兩端一致。
- 修法字串改為指向 `memoria setup --vector`；保留 `--omit=dev`／`NODE_ENV=production` 的說明（旁邊安裝的情境仍適用）。

### `setup --vector`

1. 照現有步驟完成 setup，再加一步 `vector-deps`。
2. 建立 `<hash>/` 的暫存目錄，複製 `package.json`／`package-lock.json`，執行 `npm ci --include=dev --no-audit --no-fund`（子行程環境移除 `NODE_ENV`）。
3. 以 `embed.mjs` 直接 embed 一次 `warm up` 完成暖機（不需要 `LIBSQL_URL`），模型下載到 `models/`。
4. 成功後寫 `.complete`，再把暫存目錄改名成正式的 `<hash>/`；任何一步失敗都以非 0 結束，暫存目錄刪除。
5. `--json` 的 step log 帶 `{ step: 'vector-deps', dir, hash }`；文字模式印出目錄。

## 實作步驟

1. ⏳ **S0 可行性驗證**（SCN 全部的前提）— 依 README「首要驗證」做 Node 18 與 Node 22 的 spike，決定進入點的解析方式。完成判準：兩個版本都完成 embed 與 `vector_top_k`，記錄命令與輸出；失敗則停下來回報。
2. ⏳ **S1 helper 依賴解析**（SCN-002、SCN-003、SCN-004、SCN-005；相依 S0）— `deps.mjs` 與三個呼叫端。完成判準：`test-vector-recall.sh` 新案例在「旁邊無依賴、快取目錄有 stub 用的 `@libsql/client`」下 recall 與 ingest 成功；旁邊有依賴時解析到 sibling、`modelCacheDir` 為 null；lock 雜湊不同的目錄不被採用；既有案例全綠。
3. ⏳ **S2 doctor 探測與修法**（SCN-001、SCN-003、SCN-004；相依 S1）— 完成判準：doctor 對 sibling／cache／皆無三種狀態各有斷言，`embedderSource` 與目錄正確，修法含 `setup --vector`；`test-npm-install.sh`、`test-no-clone-install.sh` 的 `every(ok)` 不受影響。
4. ⏳ **S3 `setup --vector`**（SCN-001、SCN-006；相依 S1）— 完成判準：`test-bootstrap.sh` 以 `XDG_CACHE_HOME` 指向暫存目錄執行，安裝只裝 `@libsql/client`（CI 不下載 transformers，以 npm 的 `npm_config_omit` 或等價方式控制，由實作選擇並記錄），斷言 `.complete` 與 step log；安裝失敗情境（PATH 裡的 npm 換成必定失敗的假命令）斷言非 0、沒有 `.complete`、doctor 仍為失敗。local provider 的完整安裝與暖機在維護者機器手動驗證：刪掉全域套件內的 `node_modules`，跑 `setup --vector`，再模擬升級（重裝同版全域套件），recall 仍為 `hybrid_vector`，並記錄模型沒有重新下載的證據（SCN-001、SCN-002）。
5. ⏳ **S4 常青文件**（相依 S1～S3）— helper README、INSTALL、OPERATIONS、README／README.zh-TW 的 `setup` 旗標、CLAUDE.md Architecture。issue-23 新增的「升級後重裝」段落改寫為 `setup --vector`，並說明依賴清單改變時才需要重跑。完成判準：文件與 doctor 修法用同一套說法；人工閱讀。

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

- [ ] S0 的兩個 Node 版本 spike 都有證據
- [ ] 旁邊有 `node_modules` 時行為與模型快取位置不變（下游契約）
- [ ] helper 的 stdin／stdout 契約不變
- [ ] 雜湊算法只有一份來源
- [ ] 沒有新增 runtime 依賴（Memoria 本體仍只有 `better-sqlite3`、`commander`、`zod`）
- [ ] 新旗標寫進 README／README.zh-TW 與 CLAUDE.md 的命令清單
- [ ] GitNexus impact（`inspectVectorLayer`、setup 的 action）與提交前 `detect_changes`
