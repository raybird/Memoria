# 審查報告
- 範圍：完整 PR
- Reviewed BASE SHA：1751ec4108d159f74bccd3077d942b77d82af341
- Reviewed HEAD SHA：dfa67d364fdf8307b2d97a335c5a5f1a65ae8ebc
- Reviewed patch-id：b5f7f375a980311fdc0aa999562d36d21b418556（`git diff 1751ec4 dfa67d3 | git patch-id --stable`）
- 獨立 reviewer：Claude（獨立審查 subagent，Opus 5.5），2026-10-21
- Review artifact：docs/issues/issue-26/review-dfa67d3.md

Delta 說明：上一輪是 [review-78c1782](./review-78c1782.md)（RETURN TO execute-task）。3e3e6fe 只加入那份報告。本輪的實質差異是 `3e3e6fe..dfa67d3`：
- `scripts/test-bootstrap.sh` +4/-3：`cli_ok` 成功時把 stderr 轉出；`W1`、`W5`、`W4` 改走 `cli_ok`。
- `docs/issues/issue-26/README.md` +8/-1：涉及檔案、TBD-3、審查回應、Timeline。

完整 PR 另外包含 12ba007，只更新 issue-27 README 的核准狀態，沒有程式變更。

## 問題與風險

### MUST FIX
無

### SHOULD FIX
無

### NICE TO HAVE

**N-1：TBD-3 這一列排在 TBD-2 前面**
- 位置：`docs/issues/issue-26/README.md` 待確認事項表。
- 影響：只影響閱讀順序。
- 建議：把 TBD-3 移到 TBD-2 後面。

## 已查核維度

- **驗收與證據**
  - 這次重新以 `git archive dfa67d3` 展開到 scratch（內容與工作目錄的腳本 `cmp` 相同），`env -u LIBSQL_URL -u MEMORIA_HOME`，`HOME`、`XDG_CACHE_HOME`、`TMPDIR` 都指到 scratch。
  - AC-1：PATH 前置假 npm（`npm ci` 印出 `EI26` 原因並以 1 結束，其他子命令交給真的 npm）。rc=1，輸出 `✗ setup --vector (first install) exited 1`，原因 1 筆。紅燈（BASE 靜默退出，`✗` 0 筆、原因 0 筆）沿用上一輪的實測。
  - M-1 已解決：用三個 node 包裝，各自只在 `XDG_CACHE_HOME` 是 `*/xdg-w1`、`*/xdg-w5`、`*/xdg-w4` 時設 `FAKE_TF_MODE=fail`，其餘照常交給真的 node。三次都是 rc=1，分別印出：
    - `✗ setup --vector warm-up (W1) exited 1`
    - `✗ setup --vector (W5, after a dead partial) exited 1`
    - `✗ setup --vector beside a sibling node_modules (W4) exited 1`

    最後一行都是 `{"step":"vector-deps","ok":false,…,"error":"model warm-up failed (exit 1): simulated model download failure: connect ECONNREFUSED"}`。修正前的 W1 在上一輪已重現為靜默退出。
  - issue-25 段沒有遺漏：其餘 CLI 呼叫中，`W2`、`WF`、`WL` 是預期失敗的 `if … then`，`WN` 已有 `|| { … }`，`W3` 是背景執行後刻意砍掉，`SCN-006` 是 `if`，`VEC_HASH` 不是 CLI 呼叫。
  - AC-2：scratch 複本與工作目錄的腳本都是 rc=0，以 `[bootstrap] ok` 結束。和 BASE 的成功 log 比對，把暫存路徑、`ms`、行號正規化後，只差 preflight 回報的剩餘磁碟 MB 數，以及被 kill 行程的 PID。`bash -n` 通過。
  - S-1：執行者回報本機依 `ci.yml` 順序跑完 34/34。我確認 `ci.yml` 裡共有 34 次 `scripts/test-*.sh` 呼叫（33 支不同腳本），數字吻合，但全套我沒有重跑；變更只動到 `test-bootstrap.sh`，這支我獨立跑過。GitHub CI 要等合併後 push main 才會跑，因為執行者沒有 push feature branch 的授權。這點記為限制，不阻擋。
- **相關失敗面**
  - N-1 修正：stdout 仍然逐位元組相同（`cmp` 比對原始位元組，以及經 `$(...)` 後的字串）。成功時 stderr 會原樣轉出，在 `$(...)` 裡與 W5 的直接呼叫都會進 log，不會混進被擷取的 stdout。先成功再失敗時，失敗訊息裡沒有上一次的殘留。
  - W5 是直接呼叫，不在 `$(...)` 裡，所以函式內有 errexit。`"$@" … || rc=$?` 不受影響，失敗時 `exit 1` 會結束整支腳本，`✗` 訊息照樣寫到 stderr。這點和上面的強制失敗實測一致。`>/dev/null` 只丟掉成功時的 stdout，原本的寫法也是如此。
  - `iso_vec` 是 shell 函式，在 `cli_ok` 的 `"$@"` 裡呼叫，`$(...)` 子 shell 會繼承函式定義，實測正常。
  - 上一輪查過的 `env` 轉換、`$TMP/cli-ok.*` 重複使用、label 含空白、`$TMP` 不可寫這幾項，這次的修改都沒有碰到，結論不變。
- **需求、架構、安全、品質（含過度設計）**
  - 每處只改一行呼叫，函式多一行。沒有新的抽象，也沒有動產品程式。label 都標了 W1、W4、W5，能對回腳本裡的變數，失敗時好定位。
  - TBD-3 的理由成立：已核准的 TBD-2 原文是「只改 `test-bootstrap.sh` 的 issue-25 段」，`W1`、`W4`、`W5` 都在以 `[bootstrap] issue-25:` 開頭的小節裡。照原文執行不算擴大範圍，反而是 (B) 才會把已核准的範圍縮小。改的是測試腳本，沒有新增 CLI 介面或 agent 契約，沿用原核准、不另外詢問是合理的。我在上一輪標成 `需決策`，是因為當時 README 的列舉和原文不一致，現在 README 已改成和原文一致，這點已處理。
- **豁免、待確認與限制**
  - TBD-1、TBD-2、TBD-3 都已解決，各有依據。
  - 剩下的限制：GitHub CI 要等合併後才會跑；reuse 那處（`VEC_OUT2`）沒有獨立的失敗證據，但它和其他處用同一個函式。README 都有如實記錄。
  - 審查環境：沒有動追蹤中的檔案、全域 npm、`~/.cache/memoria`、`$LIBSQL_URL`，所有資料根都在 scratch。工作目錄裡另有一個 `docs/issues/issue-27/review-d22e5cb.md` 未追蹤，不是本次審查產生的。

## 流程判定
PASS
