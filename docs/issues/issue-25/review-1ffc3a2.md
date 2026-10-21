# 審查報告
- 範圍：完整 PR（issue-25 分支 39fb4af..1ffc3a2）
- Reviewed BASE SHA：39fb4afc4c5a1b79fb5a6a3622d0029d5411e205
- Reviewed HEAD SHA：1ffc3a24eee369ca0787f6bc2cc28c6acd6dbf5c
- Reviewed patch-id：c7a0f8f9b58f403731bc67c72b86bf06fabd58dc（`git diff 39fb4af 1ffc3a2 | git patch-id --stable` 實測相符）
- 獨立 reviewer：Claude Code general-purpose subagent（獨立審查，未參與實作）
- Review artifact：docs/issues/issue-25/review-1ffc3a2.md

審查日期：2026-10-21。所有實驗都在 `~/.cache/i25-review-sbx/` 裡進行，並明確指定 `XDG_CACHE_HOME`、`MEMORIA_HOME`、`LIBSQL_URL`，同時 unset 繼承下來的 `LIBSQL_URL`。過程中沒有寫入 `~/.memoria`、`~/.cache/memoria`（事後 `ls ~/.cache/memoria` 確認不存在），也沒有動到全域 npm 套件。warm-up 路徑用一個離線的假 `@huggingface/transformers`（`$SBX/fake-tf`，同時有 CJS 與 ESM 進入點，行為由 env 控制）來驗證，沒有再下載真正的 embedder。repo 內唯一的寫入是本報告與 `dist/`（gitignored）。

## 問題與風險

### MUST FIX

**M-1 `.complete` 在暖機前就寫入，中斷暖機會留下「已安裝」的假象（SCN-006）**
- 位置：`src/cli/runtime.ts:398-400`（npm 成功後就寫 `.complete` 並 rename 到正式目錄）、`:407-421`（暖機失敗時才在 catch 裡移除標記），以及 `:359-361` 的註解。
- 問題：暖機也就是約 120MB 的模型下載，最長可跑 15 分鐘。這段時間正式目錄已經帶著 `.complete`。如果使用者按 Ctrl-C、關掉終端機，或行程被 SIGKILL，catch 不會執行，標記就留在那裡。註解寫「`.complete` is written only once npm and the warm-up have both succeeded … no interrupted run reads as installed」，計畫也寫「`.complete` 安裝與暖機都成功後才寫入」，在中斷的情況下這兩句都不成立。
- 重現（假 transformers，`FAKE_HANG=1` 讓 pipeline 卡住，再對 setup 的 process group 送 SIGINT）：
  ```
  kill -INT -- -<setup pgid>
  ls -a $SBX/memoria/vector/3bfc41e94f289d4a/   → .complete node_modules package-lock.json package.json
  memoria doctor --json → {"name":"vector embedder","ok":true,"value":"@huggingface/transformers installed (…/3bfc41e94f289d4a)"}
  ```
  setup 的輸出沒有任何 `vector-deps` 行。
- 影響：doctor 全綠，但模型還沒下載。之後每次 recall 都會在 helper 裡從頭下載模型。transformers.js 4.2.0 的 `FileCache.put` 是先寫 tmp 檔、下載完才 rename（`dist/transformers.node.mjs` 約 5853 行起），而 recall 的逾時是 4 秒，逾時就 SIGKILL。下載超過 4 秒時永遠存不下來，結果是持續的 `vector_timeout`，doctor 卻顯示正常。這正是本 issue 和 issue-23 想消除的「靜默退回」。SCN-006 的 Then 寫「不會把未完成的目錄當成已安裝」，例子也列了「下載中斷」。
- 建議：讓「最後才寫標記」真正成立。暖機改在 `.partial-<pid>` 目錄上進行，例如 `deps.mjs` 多匯出一個接受明確目錄的載入方式（`importDep(name, location)`），由暖機子行程使用。模型照樣寫到 `<root>/models`。暖機成功後才寫 `.complete`，接著 rename。reuse 路徑維持目前做法。另外補一個 CI 回歸案例：用離線的假 transformers 套件（做法同本次 probe）跑「暖機失敗」與「暖機中斷」兩種情境，斷言 doctor 為失敗。
- `需決策`（只在不打算改程式時才需要）：問題是 `.complete` 的定義要不要改成「只代表依賴裝好，不含模型」。選項 A：照上述修正程式（建議採用）。選項 B：接受中斷視窗，同步改註解、計畫與 SCN-006 的文字，並讓 doctor 另外檢查模型是否存在。選 B 會改動已核准的 SCN-006 語意，需要重新核准。

### SHOULD FIX

**S-1 失敗原因被截掉（SCN-006「印出失敗原因」只在假 npm 的情境下成立）**
- 位置：`src/cli/runtime.ts:438`、`:447`，只保留 stderr 最後 5 行。
- Node 的錯誤會先印訊息、後面才是 stack，所以最後 5 行只剩 stack frame 和 `Node.js v22…`。實測暖機失敗時的輸出：`… failed (exit 1):     at exports.pipeline (…/index.cjs:5:36) | at embedLocal (…) | … | Node.js v22.20.0`，真正的訊息 `fake model download failed` 不見了。
- npm 的情況類似。用真的 lockfile 搭配無法連線的 registry（`npm_config_registry=http://127.0.0.1:9/`、空的 npm cache）實測，輸出是 `npm ci failed (exit 1): npm error } | npm error | npm error If you are behind a proxy… | npm error A complete log …`，ECONNREFUSED 這個原因沒有出現。另一個實測裡，lockfile 不同步的 EUSAGE 只留下 `aliases: clean-install…` 這種樣板文字。
- `scripts/test-bootstrap.sh` 的假 npm 只印一行，所以這個測試抓不到截斷問題。
- 建議：暖機用的 inline script 自己 catch 錯誤，只印 `e.message` 一行。npm 的部分優先保留 `npm error code …` 那行與緊接的幾行，再附上 log 路徑。測試裡的假 npm 也改成會輸出多行的版本。

**S-2 helper 旁邊有 `node_modules` 時，`setup --vector` 的暖機會走旁邊的依賴，結果與回報都不正確**
- 位置：`src/cli/runtime.ts:407-427`。
- D1：旁邊有 `node_modules` 但沒有 transformers（例如 `--omit=dev` 的 checkout），provider 為 local。暖機透過 sibling 解析失敗，把剛裝好、本身沒問題的快取目錄的 `.complete` 也拿掉，然後報「dependencies installed in <cache>, but the model warm-up failed … re-run setup --vector」。照這個提示重跑，結果還是一樣失敗。
- D2：旁邊有 transformers。setup 回報 `"warmedUp":true,"modelCacheDir":"…/memoria/vector/models","shadowedBy":"…/node_modules"`，但假套件的紀錄是 `cacheDir=undefined build=esm`，代表實際暖機的是旁邊的安裝，模型寫到它的預設位置，不是回報的路徑。
- 影響：開發者 checkout 下跑 `./cli setup --vector` 一定會碰到這兩種情況之一（repo 模式，旁邊通常有 `node_modules`）。
- 建議：`location.source === 'sibling'` 時跳過暖機，回報 `warmedUp:false`，或改成明確對快取目錄暖機。`modelCacheDir` 改取 `deps.mjs` 的輸出（見 N-3）。

**S-3 旁邊有依賴的路徑現在多依賴 `os.homedir()` 與讀取 `package-lock.json`，與「行為完全相同」的下游契約不一致**
- 位置：`skills/memoria-vector/deps.mjs:115`。`cacheDirFor()` 在判斷 sibling 之前就先執行，會讀 lockfile 並呼叫 `vectorCacheRoot()`，沒設 `XDG_CACHE_HOME` 時就會呼叫 `homedir()`。
- 重現：用 `--import` 預載一段程式，搭配 `syncBuiltinESMExports` 讓 `os.homedir()` 拋錯。base 版（39fb4af）的 helper 回傳 `{"hits":[…]}`，HEAD 版失敗於 `Error: ENOENT … uv_os_homedir`，recall 因此 fail-open。
- 實際觸發條件少見：沒有 `HOME`，且 uid 不在 passwd 裡；Docker 通常會補 `HOME=/`。但 HANDOVER §8 提到下游以「唯讀掛載、非特權使用者」執行，而 sibling 路徑本來就用不到快取目錄。
- 建議：sibling 分支先回傳結果，`cacheDir` 改為延後計算，或包在 try 裡、失敗時給 null。doctor 與 setup 需要的 `cacheDir` 仍可由 `node deps.mjs` 提供。

**S-4 暖機分支與 `modelCacheDir` 的設定沒有任何 CI 證據**
- CI 只跑 stub，所以以下行為都沒有被執行過：`embed.mjs:50-51` 在快取來源時設定 `env.cacheDir`、sibling 來源時不設定（SCN-004 的模型位置），以及 `runtime.ts` 暖機失敗時移除標記的分支。目前 SCN-004 的模型位置只靠 `resolveDepsLocation` 回傳 `modelCacheDir: null` 這個間接斷言。如果把 `embed.mjs` 改成永遠設定 cacheDir，CI 仍會全綠。
- 建議：比照本次 probe，用 `file:` 依賴的離線假 transformers 加進 `test-bootstrap.sh` 或 `test-vector-recall.sh`。可以和 M-1 的回歸測試一起做。

### NICE TO HAVE

- **N-1** `npm ci` 中斷時，`<hash>.partial-<pid>` 會留在磁碟上，而且永遠不會被回收（下次的 pid 不同）。實測：SIGINT 之後 `…/690ebce65e137374.partial-3168684/` 仍在，解析結果為 `source:"none"`，不會被當成已安裝，但真實情況下最多佔約 720MB。建議開始安裝時清掉 pid 已不存在的 `.partial-*`，或寫進 TBD-2 的說明。
- **N-2** `XDG_CACHE_HOME` 是相對路徑時沒有忽略（`deps.mjs:96`）。XDG 規範要求忽略相對路徑。現在每個行程會以自己的 cwd 解析，setup 與 recall 可能指到不同目錄。實測 `XDG_CACHE_HOME=relcache` 印出 `cacheDir:"relcache/memoria/vector/…"`。建議加 `path.isAbsolute` 檢查，不是絕對路徑就退回 `~/.cache`。（`XDG_CACHE_HOME=/` 會得到清楚的 `EACCES: permission denied, mkdir '/memoria'`，空白字串會退回 `~/.cache`，這兩種都正確。）
- **N-3** 模型目錄的規則有兩份：`runtime.ts:425` 的 `path.dirname(target)/models` 與 `deps.mjs:120`，而且 `DepsLocation` 型別把 `modelCacheDir` 丟掉了。建議讓 `node deps.mjs` 一律輸出 models 目錄，並由 `probeDepsLocation` 傳回去。這也能順便修正 S-2 的回報。
- **N-4** `deps.mjs` 匯出的 `vectorCacheRoot`、`lockHash`、`cacheDirFor` 在 repo 內沒有外部使用者，屬於 code-simplify 可以收斂的表面積。
- **N-5** `npm ci` 沒有逾時（`runChild` 沒傳 `timeoutMs`），網路卡住時會一直掛著。
- **N-6** doctor 的修法只寫「Run "memoria setup --vector"」，沒提到 `MEMORIA_HOME`／`--memoria-home`。`setup` 會跑完整流程，沒設 `MEMORIA_HOME` 時會在 cwd 建立 `./memoria`。INSTALL 與 helper README 有寫，但 doctor 是使用者最常照著做的入口。
- **N-7** `runDirectly()` 是啟發式判斷：當 `argv[1]` 剛好是 `deps.mjs` 的路徑時，import 它也會印出 JSON。`test-vector-recall.sh:363-366` 的 `node -e … "$HELPER_DIR/deps.mjs"` 就在 log 留下一行 `{"source":"sibling",…}`。無害，只是測試輸出多一行雜訊。
- **N-8** 計畫的檢查清單「GitNexus impact／detect_changes」仍未勾選。本次 reviewer 跑了 `impact(inspectVectorLayer, upstream)`，結果為 LOW（直接呼叫者只有 `registerDoctorCommand`）。HANDOVER §8 要求 helper 的解析順序有變動時在 CHANGELOG 明寫，發版時記得補上。

## 已查核維度

### 驗收與證據

| Scenario | 證據位置 | 判定 |
|---|---|---|
| SCN-001 | CI：`test-bootstrap.sh`（stub，依賴在 `$XDG/memoria/vector/<lock hash>`、`.complete`、step log）＋ `test-vector-recall.sh`（doctor 通過並列出目錄）；local：implementation-plan.md S3 的手動證據（隔離 prefix，doctor 四項全綠，`hybrid_vector`／`vector`，`models/` 130M） | 成功路徑成立。reviewer 重跑兩支腳本都通過（下方「相關失敗面」列出命令）。 |
| SCN-002 | implementation-plan.md S3 手動證據（`npm rm -g`／`npm i -g` 同一個 tgz，inode 改變，`models/` 的 mtime 不變） | 有已保存的手動證據，可接受。CI 只有「沒有旁邊依賴的 helper 複本從快取載入」這種近似。 |
| SCN-003 | `test-vector-recall.sh`「changed lockfile -> old cache dir ignored」＋ doctor 在「皆無」狀態時的修法斷言（雜湊獨立計算） | 成立。若把雜湊來源改成別的檔案或常數，「changed lockfile」那一步會抓到。 |
| SCN-004 | `test-vector-recall.sh`：旁邊有依賴時優先於已完成的快取、修法維持 issue-23 的說法、`modelCacheDir:null`；CI 既有案例跑的就是 sibling `--omit=dev` | 判定與修法成立。模型位置只有間接證據（S-4）；reviewer 的 probe D2 顯示 sibling 時 `env.cacheDir` 確實沒有被設定。doctor 通過時的 `value` 文字多了目錄，但判定沒變，可以接受。 |
| SCN-005 | `test-vector-recall.sh`：快取來源下 ingest＋recall；reviewer 在 Node 18.18.2 與 22.20.0 都重現了 ingest `{"ok":true,"embedded":2}` 與 recall top-2 一致 | 成立。 |
| SCN-006 | `test-bootstrap.sh` 假 npm（非 0、帶原因、沒有殘留）；`test-vector-recall.sh` 沒有 `.complete` 的目錄不被採用 | **部分不成立**：暖機中斷會留下標記（M-1）；真實的 npm／暖機錯誤原因被截掉（S-1）；暖機失敗分支沒有 CI 證據（S-4）。 |

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 結論 |
|---|---|---|---|
| npm 不存在或失敗（假 npm） | 非 0、帶原因、沒有殘留 | CI | 通過 |
| 真實 npm 網路失敗（registry 127.0.0.1:9） | 非 0、帶原因 | reviewer probe | 非 0 正確，原因被截掉（S-1） |
| 暖機拋錯（`FAKE_FAIL=1`） | 非 0、移除標記 | reviewer probe A | 移除標記正確，原因被截掉（S-1） |
| 暖機中被 SIGINT | 不被當成已安裝 | reviewer probe C | **失敗**（M-1） |
| `npm ci` 中被 SIGINT | 不被當成已安裝 | reviewer probe E | 通過，但留下 partial（N-1） |
| 3 個 `setup --vector` 同時跑（stub） | 最終只有一個完整目錄 | reviewer probe | 3 個都 ok，只剩一個 `690ebce65e137374/`，解析為 cache。rm＋rename 的競態最壞只會報錯或移除標記，不會產生假的已安裝 |
| reuse（第二次執行） | `reused:true` | CI | 通過；stub 升級為 local 時，因缺 transformers 會重裝，邏輯正確 |
| 旁邊有依賴時跑 `setup --vector` | 不誤導 | reviewer probe D1/D2 | 不正確（S-2） |
| `XDG_CACHE_HOME` 為 `/`、空白、相對路徑 | 安全、可預期 | reviewer probe | `/` → EACCES，訊息清楚；空白 → 退回預設；相對路徑 → 依 cwd 解析（N-2） |
| rm -rf 的範圍 | 只刪自己的目錄 | 程式閱讀 | 目標固定是 `<root>/memoria/vector/<16 位 hex>` 與 `<該路徑>.partial-<pid>`，最後一段不受使用者控制，沒有 path traversal |
| npm 子行程的 env | 不受 `NODE_ENV` 影響 | 程式閱讀 | 子行程移除了 `NODE_ENV`；`--include=dev`／`--omit=dev` 明確指定，優先於使用者的 omit 設定 |
| 下游：旁邊有依賴、唯讀 image | import 解析、模型位置、stdin/stdout 都不變 | CI＋reviewer | sibling 時仍是一般的 `import(name)`，由 `deps.mjs`（與 helper 同目錄）發出，解析起點相同；`modelCacheDir:null`；stdin/stdout 不變；沒有任何寫入。原本的 static import 改成 TLA 後的 dynamic import，缺套件時同樣 exit 1、stdout 沒有部分 JSON，fail-open 契約不變。新增的 `homedir()` 依賴見 S-3 |
| 下游：有 `MEMORIA_VECTOR_RECALL_CMD` | doctor 跳過 embedder 探測 | 既有測試 | 不變 |
| helper 依賴在上層目錄（不在旁邊） | 維持原行為 | 程式閱讀 | 沒有快取時 `source:none` 仍走一般 `import()`，祖先目錄解析照舊；只有使用者自己跑過 setup 產生快取時，快取才會優先，可以接受 |
| Node 18 | CJS 進入點可以 `import()` | reviewer 實測 | Node 18.18.2 的 ingest／recall 都正常；`createRequire(...).resolve('@libsql/client')` 解析到 `lib-cjs/node.js`，`mod.default` 就是 module.exports，`createClient` 為 function；`??=` 與 TLA 在 Node 18 都支援 |

reviewer 重跑的測試（HEAD 1ffc3a2，`pnpm run check`、`pnpm run build` 都通過）：

```
env -u LIBSQL_URL -u MEMORIA_HOME XDG_CACHE_HOME=$SBX/xdg-tests COREPACK_HOME=~/.cache/node/corepack bash scripts/test-vector-recall.sh   → [vector] ok（exit 0）
… bash scripts/test-bootstrap.sh       → [bootstrap] ok（exit 0）
… bash scripts/test-npm-install.sh     → [npm-install] ok
… bash scripts/test-no-clone-install.sh → [no-clone] ok
```

（第一次執行失敗，原因是 reviewer 改了 `XDG_CACHE_HOME`，使 corepack 找不到 pnpm，與本變更無關；pin 住 `COREPACK_HOME` 後全部通過。）

### 需求、架構、安全、品質

- **雜湊只有一份實作**：成立。TS 端透過 `probeDepsLocation` 執行 `node deps.mjs`，`recall-vector.ts:530-542`；doctor 與 setup 共用。測試裡另外算一次雜湊，是作為獨立的對照，屬於刻意設計。模型目錄的規則則有重複（N-3）。
- **架構**：helper 腳本沒有搬位置，`resolveHelperScript()` 沒有改動，Memoria 本體沒有新增 runtime 依賴，`dist/` 不會 import helper。範圍與核准規格一致。
- **安全**：沒有 shell 插值；`spawn` 的參數都是陣列。暖機的 inline script 用 `JSON.stringify(embedUrl)` 嵌入 URL，安全。只有 Windows 上 `spawn('npm')` 需要 shell，而本專案的安裝路徑以 bash 為主，不列為問題。
- **測試真偽**：S1、S2、S3 的變異測試（拿掉 `.complete` 判斷、對調解析順序、拿掉 partial 清理）都有紀錄。`test-npm-install.sh` 與 `test-no-clone-install.sh` 的新斷言在 base 版（沒有 `deps.mjs`）會失敗，是真的斷言。缺口在暖機分支與錯誤訊息品質（S-1、S-4）。
- **code-simplify**：`probeDepsLocation` 合併得好；doctor 的兩個分支清楚。可以收斂的地方：N-3（重複的規則）、N-4（多餘的匯出）。另外 `deps.mjs` 的 `importDep` 與 `depsLocation` 各自做 lazy init，可以共用一個 getter，屬於枝微末節。沒有看到過度設計。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-2（舊雜湊目錄不清理）與 TBD-3（不新增 env）維持原決定；N-1 的 partial 殘留不在 TBD-2 原本的範圍內，建議一併處理或寫進說明。
- 限制：reviewer 沒有用真正的 local embedder 重跑 SCN-001／SCN-002，採信 implementation-plan.md S3 已保存的手動證據。暖機相關的結論用離線的假 transformers 取得，只涵蓋 Memoria 這一側的流程，不涵蓋 transformers 本身的下載行為；下載行為依 4.2.0 原始碼閱讀判斷。S-3 的觸發條件用 monkeypatch 模擬，沒有在真正沒有 passwd 項目的容器裡重現。
- 發版時要依 HANDOVER §8 在 CHANGELOG 寫明 helper 依賴解析順序的變更（N-8）。

## 流程判定
RETURN TO execute-task

理由：M-1 是 SCN-006 的失敗路徑缺口，而且程式註解與計畫宣稱的不變式不成立。如果使用者在 M-1 的 `需決策` 選 B 並重新核准 SCN-006，就改為處理文件與 doctor 檢查。
