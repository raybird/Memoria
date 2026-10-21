# 審查報告
- 範圍：完整 PR（issue-25 分支 39fb4af..82214e3），review-b525453 之後的第三次重審
- Reviewed BASE SHA：39fb4afc4c5a1b79fb5a6a3622d0029d5411e205
- Reviewed HEAD SHA：82214e31374ad61c91f0f20dee3e6dfa33aa3279
- Reviewed patch-id：3f81c8112f77c7383ed119a0af9ba249f95bf2ed（`git diff 39fb4af 82214e3 | git patch-id --stable` 實測相符）
- 獨立 reviewer：Claude Code general-purpose subagent（獨立審查，未參與實作）
- Review artifact：docs/issues/issue-25/review-82214e3.md

審查日期：2026-10-21。

**這次看了哪些差異**
- 上一份報告的提交 bbd229f 是 b525453 的直接後繼，`git diff --name-status b525453 bbd229f` 只有 `A docs/issues/issue-25/review-b525453.md`。
- 本次逐行讀的是 bbd229f..82214e3（patch-id 128c6e82537126b0e8ff8450b1d75cd4ab2e246e，實測相符），只動了四個檔案：
  - `src/cli/runtime.ts`：只改了 `npmReason`
  - `scripts/test-bootstrap.sh`：lifecycle 與 ECONNREFUSED 兩個夾具，以及新增的雜訊斷言
  - `docs/issues/issue-25/README.md`：Timeline 新增一列
  - `docs/issues/issue-25/implementation-plan.md`：第 7 點，以及「review-b525453（PASS）的建議項」一節
- 完整 PR 的其他部分沒有任何改動。b525453..82214e3 的差異只有上述四個檔案，加上 review-b525453 報告本身。已核准的 Gherkin 區塊與 0f2a550 比對沒有差異。其餘維度沿用 review-113c6de 與 review-b525453 的結論。

**實驗環境**
- 所有實驗都放在 `~/.cache/i25-review-sbx/`，並明確指定 `XDG_CACHE_HOME`、`MEMORIA_HOME`、`LIBSQL_URL`。
- 沒有寫入 `~/.memoria`、`~/.cache/memoria`（事後確認不存在），沒有動全域 npm 套件，也沒有修改任何追蹤中的檔案。
- 本次查明，前幾輪看到的 errno -122 是 `/tmp` 的配額用完了，屬於環境問題（細節見最後的「限制」）。所以測試時以 `TMPDIR=~/.cache/i25-review-sbx/tmp` 執行。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
無新的項目。

另有一個行為差異，只列出來，不算問題：找不到 `npm error code` 那一行時，`npmReason` 現在只回傳最後 5 行；log 路徑如果不在這 5 行裡，就不會再像以前那樣補上去（`runtime.ts` 的 `if (code < 0) return lines.slice(-5)…`）。npm 實際上都把 log 路徑印在最後一行，所以沒有實際影響。

## 已查核維度

### N-A'、N-E 是否解決，以及新測試會不會在沒修時失敗

做法：在 sandbox 裡放一份 `git archive 82214e3` 的複本，逐一植入變異，再跑 `test-bootstrap.sh`。

| 變異 | 結果 |
|---|---|
| 不改動（baseline） | exit 0 |
| 拿掉略過 stack frame 的規則 | `✗ npm failure lost its reason`（ECONNREFUSED 夾具：12 行 frame 排在原因前面，把 8 行額度用完） |
| 拿掉略過空白行與 `^` 的規則 | `✗ … still carries noise 'npm error     ^'` |
| 拿掉略過摘錄位置（`node:…:N`）的規則 | `✗ … still carries noise 'node:internal/process/promises:394'` |
| 拿掉略過摘錄位置下一行原始碼的規則 | `✗ … still carries noise 'triggerUncaughtException'` |
| 整個 `npmReason` 換回 b525453 的版本 | `✗ npm lifecycle failure lost its cause` |

四條篩選規則各自都有測試保護，N-E 已解決。lifecycle 夾具的內容與我從 npm debug log 取得的真實格式逐行相同，只把路徑換成 `/nonexistent`。

**N-A' 的真實重現**：在 82214e3 上照前一輪的方式重跑真的 `npm ci --include=dev`（local provider），onnxruntime-node 的 postinstall 一樣以 errno -122 失敗。這次回報是：

```
npm ci failed (exit 1): npm error code 1 | npm error path …/690ebce65e137374.partial-3491875/node_modules/onnxruntime-node | npm error command failed | npm error command sh -c node ./script/install | npm error Downloading https://api.nuget.org/…/microsoft.ml.onnxruntime.gpu.linux.1.24.3.nupkg | npm error [Error: Unknown system error -122: Unknown system error -122, write] { | npm error   errno: -122, | npm error   code: 'Unknown system error -122', | npm error A complete log of this run can be found in: …-debug-0.log
```

- 有包含 `Unknown system error -122`，也點出了失敗的套件與指令；log 路徑只出現一次。
- 失敗後 `realxdg4/memoria/vector/` 是空的，暫存目錄已經清掉。
- N-A' 已解決。

另外推算了第一輪看到的 adm-zip 寫入失敗格式：`Downloading` 之後有兩行 `Extracting …`，再接 `node:fs:923` 的摘錄。套用新規則後，原因落在第 8 行，剛好還在額度內。

### 既有情況有沒有退化

| 情況 | 證據 | 結論 |
|---|---|---|
| 網路錯誤，雜訊很多 | 真實重現：82214e3，`npm_config_registry=http://127.0.0.1:9/`，npm cache 指向空目錄，stub provider。回報 `npm error code ECONNREFUSED \| … \| npm error FetchError: request to http://127.0.0.1:9/… failed, reason: connect ECONNREFUSED 127.0.0.1:9 \| … \| npm error A complete log …`。bootstrap 的 `noisy npm failure -> the reason line survives` 也通過，並斷言輸出不含 `noise-frame` | 沒有退化 |
| 只印一行、沒有 `code` 行的假 npm | bootstrap 的 SCN-006 斷言 `simulated npm failure` 通過 | 沒有退化 |
| log 路徑不重複 | 有 `code` 行時，log 那一行先從清單中排除，最後補一次；兩次真實重現的訊息裡都只出現一次 | 沒有退化 |
| 輸出完全空白 | 找不到 `code` 行時，空的結果仍回傳 `'no error output'`；有 `code` 行時結果至少包含 code 那一行，不會是空的 | 沒有退化 |

### 驗收與證據（完整 PR）

SCN-001～SCN-006 的證據與判定沿用 review-113c6de 與 review-b525453，全部通過。本次的差異只影響 SCN-006「印出失敗原因」的品質，現在兩種真實格式（網路錯誤、安裝腳本失敗）都有實測，也都有 CI 夾具。

在 HEAD 82214e3 上跑過的檢查（`TMPDIR` 指向 sandbox）：
- `pnpm run check` 通過；`pnpm run build` 成功，`node dist/cli.mjs --help` 正常；`bash -n scripts/test-bootstrap.sh` 通過。
- `test-bootstrap.sh` 輸出 `[bootstrap] ok`。
- `test-vector-recall.sh` 輸出 `[vector] ok`。

### 需求、架構、安全、品質

- 差異只在 `npmReason`：每條篩選規則都有一行註解說明，各自有測試保護，提早 return 讓兩條路徑分得很清楚。
- 計畫裡寫明，實作者試過兩個沒有測試保護的條件後又拿掉了：「額度內沒有 Error 行時補上第一個 Error 行」，以及「只保留帶 `npm error` 前綴的行」。這符合 code-simplify，沒有過度設計。
- 沒有新的注入面，也沒有改到檔案系統操作。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-1～TBD-4 已解決；TBD-5 標為本次不做，有附理由。
- 待辦：發版時依 HANDOVER §8，在 CHANGELOG 寫明 helper 依賴解析順序的變更。
- 限制：
  - 本次查明 errno -122 的來源：`/tmp` 是 16G 的 tmpfs，已用到 80%，有使用者配額。在這個狀態下，`XDG_CACHE_HOME` 指向 `/tmp` 時連 stub 的 `npm ci` 都會出現 `Unknown system error -122, write`。onnxruntime 安裝 CUDA EP 時會先把檔案下載到系統暫存目錄，所以才失敗。這是環境問題，不是本 PR 的問題；因此帶 CUDA EP 的安裝在 rename 後是否正常，這次仍沒有驗證。`/tmp` 裡佔空間的主要是其他工作階段的暫存資料，reviewer 沒有去清理。
  - 真實模型的冷下載沿用 plan S3 的證據，本次沒有重新下載。

## 流程判定
PASS
