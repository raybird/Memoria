# 審查報告
- 範圍：完整 PR（issue-25 分支 39fb4af..b525453），review-113c6de 之後的第二次重審
- Reviewed BASE SHA：39fb4afc4c5a1b79fb5a6a3622d0029d5411e205
- Reviewed HEAD SHA：b5254531ef26d72a259fd9774150a4ddddf3b611
- Reviewed patch-id：ac6a8e0eff95d0973b92afe1cc3917e14447fed7（`git diff 39fb4af b525453 | git patch-id --stable` 實測相符）
- 獨立 reviewer：Claude Code general-purpose subagent（獨立審查，未參與實作）
- Review artifact：docs/issues/issue-25/review-b525453.md

審查日期：2026-10-21。

**這次看了哪些差異**
- 上次報告的提交 e36e547 是 113c6de 的直接後繼，`git diff --name-status 113c6de e36e547` 只有 `A docs/issues/issue-25/review-113c6de.md`。
- 本次逐行讀的是 e36e547..b525453（patch-id a50a278869625ff98d98c6fd2ccc7be68570d555，實測相符），只動了四個檔案：
  - `src/cli/runtime.ts`：`npmReason` 與暖機回傳值的解析
  - `scripts/test-bootstrap.sh`：假 npm 新增 `lifecycle` 模式，假 embedder 新增 `noisy` 模式
  - `docs/issues/issue-25/README.md`：新增 TBD-5 與一筆 Timeline
  - `docs/issues/issue-25/implementation-plan.md`：第 7 點與「review-113c6de 的建議項」一節
- 完整 PR 中，從 113c6de 到 b525453 只多了上述四個檔案加上 review-113c6de 報告本身，其他維度沿用 review-113c6de 的結論。
- 已核准的 Gherkin 區塊與 0f2a550 比對，沒有任何差異。

**實驗環境**
- 所有實驗都放在 `~/.cache/i25-review-sbx/`，並明確指定 `XDG_CACHE_HOME`、`MEMORIA_HOME`、`LIBSQL_URL`。
- 沒有寫入 `~/.memoria`、`~/.cache/memoria`（事後確認不存在），沒有動全域 npm 套件，也沒有修改任何追蹤中的檔案。
- 有一次實測 local embedder 時關掉了 sandbox，寫入範圍仍只有 sandbox 目錄與 `~/.npm` 的下載快取。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE

- **N-A'：遇到真實的安裝腳本失敗，根因還是可能被截掉**
  - 位置：`src/cli/runtime.ts:306-316`。測試夾具在 `scripts/test-bootstrap.sh:350-365`。
  - 問題在測試夾具與實際輸出不同。夾具在 `Downloading` 之後直接接 `Error: UNKNOWN …`；實際上 Node 對未捕捉的例外會先印三行來源摘錄（`node:internal/…:394`、出錯的那行原始碼、`^`），再印一行空白的 `npm error`，錯誤本身在後面。
  - 在 b525453 上用真的 `npm ci --include=dev` 重現：onnxruntime-node 的 postinstall 下載 CUDA EP 時以 errno -122 失敗。回報如下：
    ```
    npm ci failed (exit 1): npm error code 1 | npm error path …/onnxruntime-node | npm error command failed | npm error command sh -c node ./script/install | npm error Downloading https://api.nuget.org/… | npm error node:internal/process/promises:394 | npm error     triggerUncaughtException(err, true /* fromPromise */); | npm error     ^ | npm error A complete log …
    ```
    8 行的額度用完了，真正的原因 `[Error: Unknown system error -122 … write] { errno: -122 … }` 在第 10 行，被截掉。
  - npm debug log 的原文如下，可以直接拿來當夾具：
    ```
    error code 1 / error path … / error command failed / error command sh -c node ./script/install / error Downloading … / error node:internal/process/promises:394 / error     triggerUncaughtException(err, true /* fromPromise */); / error     ^ / error / error [Error: Unknown system error -122: Unknown system error -122, write] { / error   errno: -122, …
    ```
  - 影響：與修正前相比已經有進步，訊息點出了失敗的套件與指令，也附了 log 路徑；網路錯誤這條常見路徑則完整保留原因（見下一節）。所以維持 NICE TO HAVE，不阻擋。
  - 建議：
    - 篩選時一併略過 Node 的來源摘錄，也就是符合 `/^npm (error|ERR!) node:\S+:\d+$/` 的行、它下一行的原始碼、只有 `^` 的行，以及空白的 `npm error`。或者改成：額度內沒有出現符合 `/\b\w*Error\b[:\]]/` 的行時，補上第一個符合的行。
    - 夾具改用上面的原文。
- **N-E：略過 stack frame 的那條規則沒有測試保護**
  - 位置：`runtime.ts:313` 的 `!/^npm (error|ERR!)\s+at /`。
  - 變異實驗：拿掉這個 filter（只留 `.slice(0, 8)`），`test-bootstrap.sh` 仍然 exit 0。
  - 原因：ECONNREFUSED 夾具的原因在前三行；lifecycle 夾具只有一行 frame，原因落在第 6 行。兩者都不靠這個 filter 也能通過。
  - 建議：在 lifecycle 夾具的原因之前多放幾行 `npm error     at …`。

## 已查核維度

### N-A、N-B 的修正，以及新測試會不會在沒修時失敗

做法：在 sandbox 裡放一份 `git archive b525453` 的複本，逐一植入變異後跑 `test-bootstrap.sh`。

| 變異 | 結果 | 判定 |
|---|---|---|
| 不變異（baseline） | exit 0 | — |
| `npmReason` 改回舊寫法：`lines.slice(code, code + 4)` | `✗ npm lifecycle failure lost its cause` | 新測試有效 |
| 拿掉 frame filter | exit 0 | 這條規則沒有測試保護（N-E） |
| 暖機結果改回解析整段 stdout：`JSON.parse(run.stdout)` | `✗ warm-up with stdout chatter was reported as failed` | 新測試有效，N-B 已解決 |

- **N-A**：夾具描述的情境已解決，真實的 postinstall 失敗格式只解決一部分（N-A'）。
- **N-B**：已解決。暖機子行程在結果前面多輸出一個換行，父行程用 `trim().split('\n').pop()` 取最後一行。在 b525453 上用真實 embedder 跑 `setup --vector`（模型預先放好、`ONNXRUNTIME_NODE_INSTALL=skip`）：
  ```
  {"ok":true,"reused":false,"warmedUp":true,"modelCacheDir":"…/realxdg3/memoria/vector/models"}
  ```
  之後用 Node 18.18.2 從同一份安裝跑 recall，top-2 與上一輪相同（`session:a` 0.138、`session:b` 0.270）。

### 會不會弄壞既有情況

- **網路錯誤（多行雜訊）**
  - 真實重現：b525453，`npm_config_registry=http://127.0.0.1:9/`，npm cache 指向空目錄，stub provider。
  - 回報：`npm error code ECONNREFUSED | … | npm error FetchError: request to http://127.0.0.1:9/… failed, reason: connect ECONNREFUSED 127.0.0.1:9 | … | npm error A complete log …`
  - 判定：原因保留，而且比 113c6de 的 4 行版本完整。bootstrap 的 `noisy npm failure -> the reason line survives` 也通過。
- **只有一行輸出、沒有 `code` 行的假 npm**：程式在找不到 `code` 行時退回取最後 5 行，`simulated npm failure` 有保留。SCN-006 的 bootstrap 斷言通過。
- **log 路徑那一行**：先從清單中排除，再補在最後，不會出現兩次。
- **暖機子行程成功時 stdout 只有結果**：前面多一個換行，`trim()` 之後取最後一行，結果不變。
- **暫存目錄的清理**：真實的 postinstall 失敗之後，`realxdg2/memoria/vector/` 是空的，失敗時的清理行為沒有退化。

### 驗收與證據（完整 PR）

SCN-001～SCN-006 的證據與判定沿用 review-113c6de，全部通過。本次的差異只影響 SCN-006 的「印出失敗原因」與 SCN-001 的暖機判讀：前者兩種主要格式都有測試，後者有測試也有真實 embedder 實測。

在 HEAD b525453 上跑過的檢查：
- `pnpm run check` 通過；`pnpm run build` 成功，`node dist/cli.mjs --help` 正常；`bash -n scripts/test-bootstrap.sh` 通過。
- `test-bootstrap.sh` 輸出 `[bootstrap] ok`，新的兩行都是 ✓。
- `test-vector-recall.sh` 輸出 `[vector] ok`。

### 需求、架構、安全、品質

- 差異範圍小，責任集中在 `npmReason` 與 `warmUp`，沒有動到 helper、deps.mjs、doctor，也沒有動 recall 路徑。
- 子行程的 script 只多了一段固定字串，沒有新的注入面。
- code-simplify：`npmReason` 先找出 log 那一行、再從 `code` 起篩選與截斷，寫法清楚，沒有過度設計。
- TBD-5 把 N-D 記為「本次不做」，有附理由、後果與使用者回覆，符合待確認事項的格式。N-C 維持計畫第 5 點已記錄的殘餘風險。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-1～TBD-4 已解決，TBD-5 是本次不做，有理由。
- 待辦：發版時依 HANDOVER §8 在 CHANGELOG 寫明 helper 依賴解析順序的變更。
- 限制：
  - 沒有驗證帶 CUDA EP 的安裝，原因同 review-113c6de：這台機器下載 CUDA EP 時出現 errno -122。這次這個失敗剛好提供了 N-A' 的真實輸出。
  - 真實模型的冷下載沿用 plan S3 的證據，本次沒有重新下載。

## 流程判定
PASS
