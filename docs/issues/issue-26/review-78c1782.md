# 審查報告
- 範圍：完整 PR
- Reviewed BASE SHA：1751ec4108d159f74bccd3077d942b77d82af341
- Reviewed HEAD SHA：78c178284a45ae2685b0174595e7de2c5f0c7c85
- Reviewed patch-id：1fa308dea5ab62be56ada6903dbe0133331fac70（`git diff 1751ec4 78c1782 | git patch-id --stable`）
- 獨立 reviewer：Claude（獨立審查 subagent，Opus 5.5），2026-10-21
- Review artifact：docs/issues/issue-26/review-78c1782.md

變更內容：`scripts/test-bootstrap.sh` +15/-2（新增 `cli_ok`，`VEC_OUT`、`VEC_OUT2` 改走它）；`docs/issues/issue-26/README.md`、`docs/issues/issue-27/README.md` 只更新核准狀態與證據文字。

## 問題與風險

### MUST FIX

**M-1（需決策）：issue-25 段裡還有兩個同類呼叫照樣靜默退出，README 對範圍的描述與實際不符**
- 位置：`scripts/test-bootstrap.sh:394` `W1=$(iso_vec …)`、`:437` `W4=$(iso_vec …)`（都在 `[bootstrap] issue-25: setup --vector warm-up` 小節）；`docs/issues/issue-26/README.md:13`「issue-25 段以指令替換呼叫 CLI 的兩處（`VEC_OUT`、`VEC_OUT2`）」。
- 影響：TBD-2 核准的範圍是「`test-bootstrap.sh` 的 issue-25 段」，概述的修法對象是「這類『預期成功、取輸出』的呼叫」。腳本裡有兩個小節都以 `[bootstrap] issue-25:` 開頭，W1、W4 也是 `setup --vector --json` 的「預期成功、取輸出」呼叫，但沒有改。本次實測：PATH 前置一個 `node` 包裝，只在 `FAKE_TF_LOG` 是 `*/w1.log` 時設 `FAKE_TF_MODE=fail`，其餘照常交給真的 node。HEAD 腳本 rc=1，log 最後一行是 `[bootstrap] issue-25: setup --vector warm-up (offline stand-in embedder)`，warm-up 小節的 `✗` 0 筆、`simulated model download failure` 0 筆，症狀與本 issue 描述的 v1.31.0 事件一樣。這個小節同樣寫進 `$TMP`（`cp -R` 假 embedder、model cache），`/tmp` 配額用完時一樣可能出事。README 說 issue-25 段「只有兩處」是錯的，等於把未處理的部分記成不存在。
- 建議（二選一，要由使用者決定「issue-25 段」指哪個範圍）：
  - (A) 把 W1、W4 也改走 `cli_ok`，每處只改一行。本次在 scratch 複本驗證過：`W1=$(cli_ok "setup --vector warm-up (local)" iso_vec XDG_CACHE_HOME="$XW1" FAKE_TF_LOG="$TMP/w1.log")`（W4 同理）。用同一個 node 包裝讓 W1 失敗時，輸出 `✗ setup --vector warm-up (local) exited 1`，後面附上最後一步 `{"step":"vector-deps","ok":false,…,"error":"model warm-up failed (exit 1): simulated model download failure: connect ECONNREFUSED"}`；不加包裝時以 `[bootstrap] ok` 結束。`iso_vec` 是 shell 函式，在 `cli_ok` 的 `"$@"` 裡呼叫沒有問題。
  - (B) 如果核准的意思只限第一小節，就修正 README 的「涉及檔案」，寫明 W1、W4（以及 `:413` 那個 stdout 丟進 `/dev/null`、失敗也一樣靜默的 `iso_vec XDG_CACHE_HOME="$XW5"`）不在範圍內，記成限制或另開 issue。
  - 不論選哪一個，README 都要改。

### SHOULD FIX

**S-1：AC-2 的「CI 全數通過」還沒有證據**
- 位置：`docs/issues/issue-26/README.md:49`「CI 全套待 push 後確認」。
- 影響：AC-2 的檢查方式寫明「CI 全數通過」。分支目前沒有 upstream（`git branch -vv` 只看到本機），這半條還沒成立。變更只動 `test-bootstrap.sh`，其他測試腳本不受影響，所以風險低。
- 建議：push 後補上 CI run 的連結或結果，再標成完成。

### NICE TO HAVE

**N-1：呼叫成功時 stderr 不再進 log**
- 位置：`scripts/test-bootstrap.sh:272-277`。
- 影響：改動前 `VAR=$(cmd)` 只擷取 stdout，stderr 會直接進 log；改動後成功時 `cli-ok.err` 被丟掉。目前沒有實際影響：BASE 與 HEAD 正常跑完的 log，把暫存路徑與 `ms` 正規化後只差一行 bash 印出的 `Killed`，差別在行號（410→423），代表 `setup --vector --json` 成功時 stderr 是空的。但以後如果 CLI 成功時往 stderr 印警告，而後面的 JSON 斷言又失敗，這份診斷資訊就沒了。
- 建議：成功分支加一行 `cat "$TMP/cli-ok.err" >&2`，跟改動前的行為一致；或在註解寫明成功時會丟掉 stderr。

**N-2：README 小地方**
- Timeline 沒有記實作那一筆（78c1782）。
- 限制寫「第二處（reuse）…沒有辦法用同一個 harness 讓它失敗」，就那個 harness 而言是對的；不過本次用 node 包裝就能讓 W1 這類呼叫失敗，如果想補 reuse 那處的證據，可以用同樣做法。不是必要的。

## 已查核維度

- **驗收與證據**
  - harness：`git archive` 分別展開 BASE、HEAD 到 scratch（`node_modules` 用符號連結，`dist/cli.mjs` 複製一份；兩邊的 `src/`、`skills/` 經 `diff -r` 確認相同）。執行時 `env -u LIBSQL_URL -u MEMORIA_HOME`，`HOME`、`XDG_CACHE_HOME`、`TMPDIR` 都指到 scratch。假 `npm`：`ci` 印出 `npm error code EI26` 與 `npm error issue-26 simulated install failure` 並以 1 結束，其他子命令 `exec` 真的 npm。
  - 紅燈（BASE 加假 npm）：rc=1，最後一行 `[bootstrap] issue-25: setup --vector installs helper deps into the user cache`，`✗` 0 筆、`EI26` 0 筆。與 README 一致。
  - AC-1 綠燈（HEAD 加假 npm）：rc=1，`✗ setup --vector (first install) exited 1`，後面附上全部 JSON 步驟，最後一步的 `error` 含 `npm error code EI26 | npm error issue-26 simulated install failure`。AC-1 對 `VEC_OUT` 成立。
  - AC-2：不加假 npm 時，BASE 複本、HEAD 複本、工作目錄裡的 HEAD 腳本都以 rc=0、`[bootstrap] ok` 結束，各 61 行；BASE 與 HEAD 的 `✓/✗/[bootstrap]` 行完全相同。`bash -n` 通過。CI 部分見 S-1。
  - 注意：第一次用「符號連結整個 repo」的 farm 跑 AC-2 時，`shadowedBy` 斷言失敗。原因是 setup 回報的是解析後的真實路徑，不是腳本問題；改用 `git archive` 展開後就消失了。
- **相關失敗面**
  - stdout 逐位元組一致：用一個會印出前導空白、`\n` 字面、`%s`、`-n`、tab、UTF-8 與三個結尾換行的函式比對，`cli_ok … | cmp` 原始位元組相同，經 `$(...)` 後的字串也與直接呼叫相同（結尾換行一樣被 `$(...)` 去掉）。下游 JSON 解析不受影響，AC-2 實跑也證明這點。
  - `env VAR=x cmd` 與 `VAR=x cmd`：dump 子行程的完整環境比對（值含空白），只有 `_`（`/usr/bin/env` 對上 node 路徑）與 `SHLVL`（2 對上 1，因為原寫法在 `$(...)` 裡直接 exec 單一命令）不同。Memoria 不讀這兩個變數，沒有影響。`$CLI` 是絕對路徑，`env` 不需要查 PATH。
  - `$TMP/cli-ok.*` 重複使用：每次都用 `>` 截斷，呼叫是依序執行，沒有並行。先成功（stdout 與 stderr 都有內容）再失敗時，失敗訊息裡沒有上一次的殘留（`FIRST` 0 筆）。
  - `set -euo pipefail`：bash 5.3 的 `inherit_errexit` 是關閉的，所以 `cli_ok` 在 `$(...)` 裡跑時沒有 errexit，要靠明確的 `|| rc=$?` 與 `exit 1`，現在的寫法正確。頂層 `V=$(cli_ok …)` 失敗時腳本會中止，實測 rc=1，後面的 echo 沒有執行。在 `$(...)` 外直接呼叫時，`exit 1` 會結束整支 shell。被訊號終止時回報 `exited 143`。`nounset` 下 `$TMP` 已在第 9 行定義。沒有用到管線，`pipefail` 不相關。README 說「拿掉 `exit 1` 沒有測試能區分是否印出原因」，與 errexit 不繼承這點一致，屬實。
  - label 含空白與特殊字元：`"a  b -n \t %s *"` 原樣印出（`local label=$1` 不做字詞分割，`echo` 開頭是 `✗`，不會被當成選項）。
  - `$TMP` 不可寫（chmod 555）：命令根本沒執行，rc=1。stderr 先出現 bash 的 `…/cli-ok.out: Permission denied`，再出現 `✗ … exited 1` 與兩行 `cat: No such file`。`exited 1` 這幾個字容易誤導，但前一行已經說明原因，而且結束碼仍非 0，不會變成假綠燈。`$TMP` 是 `mktemp -d` 建立的，實務上一定可寫。配額用完時檔案寫入也可能失敗，但 `✗ <label>` 是印到 stderr 的，仍會出現，至少比改動前好。
  - 假綠燈：`exit 1` 與後面的 JSON 斷言是兩道防線，`|| rc=$?` 取得的是命令本身的結束碼，沒有路徑會把失敗吞成 0。
- **需求、架構、安全、品質（含過度設計）**
  - 只改測試腳本，沒有動產品程式。`PREFLIGHT_OUTPUT` 依 TBD-2 維持原樣。函式 9 行、註解 3 行，說明為什麼要印到 stderr，沒有過度設計。範圍不足的問題見 M-1。
  - 範圍裡另外有 12ba007，只把 issue-27 README 的狀態改成已核准（採 TBD-2 (A)），沒有程式變更。
  - 安全：沒有新增外部輸入，也沒有寫到 `$TMP` 以外的地方。
- **豁免、待確認與限制**
  - TBD-1、TBD-2 已解決，核准來源有記錄。
  - README 的限制大致屬實（reuse 那處無法用 npm ci harness 失敗、`exit 1` 無法區分），但對 issue-25 段範圍的描述不屬實（M-1）。CI 還沒確認（S-1）。
  - 審查環境：所有 CLI 呼叫都 unset `LIBSQL_URL`、`MEMORIA_HOME`，`HOME`、`XDG_CACHE_HOME`、`TMPDIR` 指到 scratch；沒有動全域 npm 套件，也沒有改任何追蹤中的檔案。`~/.cache/memoria` 在審查期間沒有變動。`~/.memoria/.memory/sessions.db` 的 mtime 在 13:22 變過，但本次沒有任何命令以它為資料根；腳本裡唯一沒帶 `MEMORIA_HOME` 的呼叫（`:79`）是以參數傳入 `$TMP`。執行中的 `memoria serve` 在 TeleNexus 容器裡（`MEMORIA_HOME=/data`），寫入應該來自本機其他 session。

## 流程判定
RETURN TO execute-task

理由：M-1。issue-25 段裡還有兩個同類呼叫（W1、W4）照樣靜默退出，README 卻寫成這一段只有兩處。要請使用者決定採 (A) 一起修、或 (B) 修正文件並記成限制，再回到 execute-task 處理。`VEC_OUT`、`VEC_OUT2` 本身的改法正確，AC-1 對它們成立，AC-2 本機成立。
