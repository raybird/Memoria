# 審查報告
- 範圍：完整 PR（issue-25 分支 39fb4af..113c6de），本次是 review-1ffc3a2 之後的重審
- Reviewed BASE SHA：39fb4afc4c5a1b79fb5a6a3622d0029d5411e205
- Reviewed HEAD SHA：113c6de3a2e62bceb45a11501078d870aaaa178d
- Reviewed patch-id：17803c8f671f149170c36fe2f97f3909e85bfe54（`git diff 39fb4af 113c6de | git patch-id --stable` 實測相符）
- 獨立 reviewer：Claude Code general-purpose subagent（獨立審查，未參與實作）
- Review artifact：docs/issues/issue-25/review-113c6de.md

審查日期：2026-10-21。

**這次看了哪些差異**
- 上次報告的提交 d2102d5 是 1ffc3a2 的直接後繼，`git diff --name-status 1ffc3a2 d2102d5` 只有 `A docs/issues/issue-25/review-1ffc3a2.md`。
- 本次逐行讀的是 d2102d5..113c6de（patch-id 704d12fb8ccbdfe2c8859f324d0360a68c25a718，實測相符），涵蓋 `src/cli/runtime.ts`、`skills/memoria-vector/deps.mjs`、`src/cli/commands/doctor.ts`、兩支測試腳本與 issue 文件。
- 完整 PR 的其他維度沿用 review-1ffc3a2 的查核結果，並在 HEAD 上重跑測試確認。

**實驗環境與限制**
- 所有實驗都放在 `~/.cache/i25-review-sbx/`，並明確指定 `XDG_CACHE_HOME`、`MEMORIA_HOME`、`LIBSQL_URL`。
- 沒有寫入 `~/.memoria`、`~/.cache/memoria`（事後確認 `~/.cache/memoria` 不存在），沒有動全域 npm 套件，也沒有修改任何追蹤中的檔案。
- 有兩次 `setup --vector` 是用 `dangerouslyDisableSandbox` 跑的，原因是要排除 sandbox 寫入限制造成的 errno -122。寫入範圍仍只有 sandbox 目錄與 `~/.npm` 的下載快取。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE

- **N-A：npm 生命週期腳本失敗時，`npmReason` 仍會漏掉根因**（`src/cli/runtime.ts:302-309`）
  - 實際發生的情況：本機跑真的 `npm ci --include=dev`，onnxruntime-node 的 postinstall 在下載 CUDA EP 時以 errno -122 失敗。回報內容是：
    ```
    npm ci failed (exit 1): npm error code 1 | npm error path …/onnxruntime-node | npm error command failed | npm error command sh -c node ./script/install | npm error A complete log …
    ```
    真正的 `Error: UNKNOWN … write errno: -122` 在第 4 行之後，被截掉了。
  - 目前的輸出已經點出是哪個套件的哪個指令失敗，也附了 log 路徑，所以仍可追查。
  - 建議：`code 1` 這類生命週期失敗時，多保留第一行符合 `/^npm (error|ERR!)\s+\w*Error:/` 的內容。

- **N-B：暖機子行程的 stdout 整段拿去 `JSON.parse`**（`runtime.ts:294`）
  - 如果暖機時 transformers.js 或 onnxruntime 往 stdout 印了任何東西（例如有人把 `env.logLevel` 設成 INFO），暖機明明成功也會被判失敗，暫存目錄跟著被刪。
  - 預設設定下不會發生：本次真實 embedder 實測就通過了。而且 `vector-recall.mjs` 本身的 stdout 契約也依賴同一個假設，所以影響有限。
  - 建議：只解析 stdout 的最後一行。

- **N-C：沿用路徑的殘餘風險可以接受**（計畫「`setup --vector`」第 5 點已記錄）
  - 狀況：沿用既有安裝時，暖機中途被砍會留下原本的標記。只有在 `models/` 被手動刪掉後才會需要下載，而且中斷之前 doctor 本來就是綠的，所以中斷並沒有製造新的假象。
  - 另一個面向：沿用時暖機失敗會拿掉一份完整安裝的標記，下次就得重跑完整的 `npm ci`。這是偏向安全的取捨，不需要處理。

- **N-D：`reclaimDeadPartials` 用 pid 判斷存活，有邊界情況**（`runtime.ts:313-332`）
  - 多個 pid namespace（容器）共用同一個 XDG volume 時，另一個容器裡還在跑的安裝，在這裡看起來 pid 已不存在，它的暫存目錄可能被刪掉。結果是那次安裝失敗，不會產生假的已安裝。
  - pid 被不相干的行程重用時，該暫存目錄會被保留，也就是漏清，無害。
  - `EPERM` 視為仍存活，是保守而正確的做法。
  - 只清同一個雜湊的暫存目錄，舊雜湊的不清，與 TBD-2 的範圍一致。
  - 這些都只需要在文件或註解裡提一句。

## 已查核維度

### review-1ffc3a2 各項是否解決，以及新測試是否真的會抓到問題

做法：在 sandbox 裡放一份 `git archive 113c6de` 的複本，逐一植入變異後重跑對應測試。未變異的 baseline：`test-bootstrap.sh` 與 `test-vector-recall.sh` 的 exit 都是 0。

| 項目 | 修正內容 | 變異（reviewer 自己做） | 結果 | 判定 |
|---|---|---|---|---|
| M-1 | 暖機改在 `.partial-<pid>` 上進行，成功後才寫標記再 rename（`runtime.ts:239-262`） | 在暖機前先寫 `.complete` | `✗ M-1: a warm-up killed mid-way left .complete:` | 已解決，測試有效。測試以 `kill -9` 同時砍掉 setup 與暖機子行程；標記即使只在暫存目錄裡也會被 `find` 抓到 |
| S-1（暖機） | 子行程只輸出 `error.message` | 改成輸出 stack 的最後三行 | `✗ warm-up failure lost its reason` | 已解決 |
| S-1（npm） | `npmReason` 從 `npm error code` 那行開始取 4 行，再加 log 路徑 | 改回只取最後 5 行 | `✗ npm failure lost its reason` | 已解決（殘留情況見 N-A） |
| S-2 | 暖機前呼叫 `useDepsLocation` 把依賴位置釘在暫存目錄 | 拿掉 `useDepsLocation` | `test-bootstrap.sh` exit 1 | 已解決。bootstrap 的 W4 情境斷言暖機載入的檔案來自快取目錄，並回報 `shadowedBy` |
| S-3 | sibling 分支的 `cacheDir` 包在 try 裡 | 拿掉 try | `Error: uv_os_homedir: no home` | 已解決 |
| S-4 | bootstrap 用假 npm 加假 transformers，涵蓋暖機成功、失敗、被砍；vector 測試涵蓋 `env.cacheDir` 在 sibling 與 cache 兩種來源下的值 | 計畫記錄了 embed.mjs 改成一律設定 cacheDir 的紅燈；reviewer 另做的 M-1、S-2 變異也打到同一批新案例 | 都會失敗 | 已解決 |
| N-1 | 開始前回收 pid 已不存在的暫存目錄 | 拿掉 `reclaimDeadPartials` 呼叫 | `✗ a dead run's partial dir was left in place` | 已解決 |
| N-2 | 相對路徑的 `XDG_CACHE_HOME` 會被忽略 | 拿掉 `isAbsolute` 檢查 | `relative XDG_CACHE_HOME must fall back…, got relcache/…` | 已解決 |
| N-3 | 模型目錄只由 `modelCacheDirFor()` 定義，runtime 改用暖機子行程回傳的值 | 讀程式確認 | — | 已解決 |
| N-4 | `deps.mjs` 只保留外部有用到的匯出 | 讀程式確認 | — | 已解決 |
| N-5 | npm 逾時 30 分鐘，`runChild` 的 `timeoutMs` 改為必填 | 讀程式確認 | — | 已解決 |
| N-6 | doctor 修法加註 `MEMORIA_HOME`／`--memoria-home`（`doctor.ts:57-58`） | 讀程式確認 | — | 已解決 |
| N-7 | `-e`／`--eval`／`-p`／`--print` 模式下不輸出 JSON | 拿掉 `execArgv` 檢查 | 間接被 S-3 的回歸案例抓到（輸出變成 JSON 而不是 `sibling`） | 已解決 |
| N-8 | 計畫裡 GitNexus 項目已勾選；CHANGELOG 待辦列為發版時處理 | — | — | 已處理；發版時仍需補 CHANGELOG |

TBD-4 記錄了 M-1 的決策：照 reviewer 建議修改程式。核對已核准的 Gherkin 區塊：`diff <(git show 0f2a550:…README.md 的 gherkin 區塊) <(git show 113c6de:… 的 gherkin 區塊)` 沒有差異，所以 SCN-006 維持原核准，不需要重新核准。

### 驗收與證據（完整 PR）

| Scenario | 證據位置 | 判定 |
|---|---|---|
| SCN-001 | CI：bootstrap 的 stub 安裝與本次新增的 local 暖機（假 embedder，`env.cacheDir` 與回報的 `modelCacheDir` 都是 `…/models`）；local 實機：plan S3 的手動證據，加上本次 reviewer 在 113c6de 上的實測（見下一節） | 通過 |
| SCN-002 | plan S3 的手動升級證據（新流程沒有改動沿用與解析這兩段）；本次實測模型檔的 mtime 與大小前後相同（`1786280748 118308185`） | 通過 |
| SCN-003 | `test-vector-recall.sh`「changed lockfile -> old cache dir ignored」與 doctor 修法 | 通過 |
| SCN-004 | vector 測試：sibling 優先、`env.cacheDir` 為 null；S-3 的回歸案例；bootstrap W4 情境 | 通過 |
| SCN-005 | vector 測試從快取目錄做 ingest＋recall；本次 reviewer 以 Node 18.18.2 與 22.20.0 跑真實 embedder，從 rename 後的快取目錄 ingest 與 recall 都成功 | 通過 |
| SCN-006 | bootstrap：假 npm 失敗（含夾雜雜訊的版本）、暖機失敗、暖機被砍、死掉的暫存目錄被回收；本次真實 npm 失敗（onnxruntime postinstall）後，暫存目錄也確實被清掉，只剩 `models/` | 通過 |

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 結論 |
|---|---|---|---|
| npm ci 與暖機後才 rename 暫存目錄（onnxruntime-node、sharp、`.bin`） | rename 後能正常載入 | reviewer 用真實依賴實測 | 安全。說明見下方 |
| 真實 npm 失敗 | 非 0、帶原因、不留殘留 | reviewer 實測 | 非 0，暫存目錄已清；原因部分保留（N-A） |
| 4 個 local 安裝同時執行（假 embedder） | 只留一份完整安裝 | reviewer 實測 | 4 個都 ok（第 4 個走沿用路徑），最後只有一個 `3bfc41e94f289d4a/`。race 最壞的情況是報錯或少了標記，不會產生假的已安裝 |
| 沿用路徑暖機失敗 | 非 0，移除標記 | reviewer 實測 | `model warm-up failed (exit 1): fake model download failed`，`.complete` 已移除 |
| 沿用路徑暖機被中斷 | 已記為殘餘風險 | 計畫第 5 點 | 可以接受（N-C） |
| `isAlive` 遇到 `EPERM` | 視為存活 | 讀程式 | 正確（另見 N-D） |
| 下游：旁邊有依賴、唯讀 image、沒有 HOME | 行為與變更前相同 | S-3 回歸案例、review-1ffc3a2 的查核 | 通過；sibling 分支已不依賴 `homedir()` |
| `XDG_CACHE_HOME` 為相對路徑、`/`、空白 | 安全、可預期 | N-2 回歸案例、review-1ffc3a2 | 通過 |
| Node 18 | 載入、暖機 script、`execArgv` 判斷都正常 | reviewer 用 v18.18.2 實測真實 embedder | 通過 |

rename 安全性的實測細節：
- 做法：用與 HEAD 相同的 dist 建一份 installed 形狀的套件，以 `MEMORIA_EMBED_PROVIDER=local` 跑真的 `setup --vector`。模型以 hardlink 預先放進 `models/`，避免重新下載。結果 3.3 秒完成，回傳 `{"ok":true,"reused":false,"warmedUp":true,"modelCacheDir":"…/realxdg/memoria/vector/models"}`。
- rename 後的安裝目錄：`grep -rlI "690ebce65e137374.partial"` 沒有任何結果；`find -type l -lname '/*'` 沒有絕對路徑的 symlink；`.bin/semver -> ../semver/bin/semver.js` 是相對路徑；transformers 底下沒有 `.cache`。
- 用 Node 22 與 18 從 rename 後的目錄跑 `vector-ingest.mjs` 與 `vector-recall.mjs`（真實的 e5 模型，載入 onnxruntime_binding.node 與 sharp），都得到 `{"ok":true,"embedded":2}`，以及同樣的 top-2：`session:a` 0.138、`session:b` 0.270。doctor 回報 `vector embedder ok (…/690ebce65e137374)`。
- 限制：這台機器上 onnxruntime-node 的 postinstall 下載 CUDA EP（約數百 MB，來自 nuget）時兩次都以 errno -122 失敗，關掉 sandbox 也一樣，看起來是環境的寫入限制。因此實測時加了 `ONNXRUNTIME_NODE_INSTALL=skip`，**沒有驗證帶 CUDA EP 的安裝在 rename 後是否正常**。依據是 onnxruntime 在執行期才以 binding 所在目錄 dlopen provider，rename 應無影響；而 plan S3 的手動證據已經涵蓋舊流程「npm ci 後 rename，再載入」，同樣成立。

reviewer 在 HEAD 113c6de 上跑過的檢查：`pnpm run check` 通過；`pnpm run build` 成功，`node dist/cli.mjs --help` 正常；`bash -n` 兩支測試腳本通過；`test-bootstrap.sh`、`test-vector-recall.sh`、`test-npm-install.sh`、`test-no-clone-install.sh` 全部 ok（`env -u LIBSQL_URL -u MEMORIA_HOME`，`COREPACK_HOME` 指向既有位置）。

### 需求、架構、安全、品質

- **雜湊與目錄規則各只有一份**：lockfile 雜湊與模型目錄都只在 `deps.mjs` 定義，TS 端透過 `node deps.mjs` 或暖機子行程取得。
- **架構**：helper 的位置與 stdin/stdout 契約都沒變；`useDepsLocation` 只有暖機子行程會呼叫，recall 與 ingest 的路徑完全不經過它。
- **安全**：
  - 暖機 script 中的路徑都經過 `JSON.stringify` 嵌入，沒有注入風險。
  - rm 的對象只有 `<root>/memoria/vector/<16 位 hex>`、它的 `.partial-<pid>`，以及符合同一雜湊前綴、pid 為正整數的項目，沒有路徑穿越。
- **品質與 code-simplify**：
  - `installVectorDeps` 改成「先在暫存目錄裝好並暖機，再標記、rename」的單一路徑，比原本的兩段式清楚；`runChild` 改為回傳結果，由呼叫端組錯誤訊息，責任劃分合理。
  - 沒有看到過度設計。`reclaimDeadPartials` 與 `isAlive` 都很小，且各對應一個已知問題。
  - `runChild` 的 stdout 現在改為 pipe 並持續讀取；npm 加了 `--no-audit --no-fund`，生命週期腳本的輸出由 npm 自己吸收，量很小。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-1～TBD-4 都已解決。
- 待辦：發版時依 HANDOVER §8 在 CHANGELOG 寫明 helper 依賴解析順序的變更（計畫檢查清單的最後一項，尚未勾選，這屬於發版時要做的事）。
- 限制：CUDA EP 安裝沒有驗證（見上方 rename 實測的限制）；真實模型的冷下載沿用 plan S3 的證據，本次沒有重新下載。

## 流程判定
PASS
