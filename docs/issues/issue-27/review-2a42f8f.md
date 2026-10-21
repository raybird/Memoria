# 審查報告
- 範圍：完整 PR（含 delta 複審）
- Reviewed BASE SHA：043d458a72a9070b073ffe23132f82efb8d328df（issue-26 最終 tip）
- Reviewed HEAD SHA：2a42f8fe00c5f80304a688833c9f9df126d7f603
- Reviewed patch-id：d073eac0f6c178b12374413f601f580692fa9480（`git diff 043d458 2a42f8f | git patch-id --stable`）
- 獨立 reviewer：Claude（Opus 5.5，獨立審查 subagent），2026-10-21
- Review artifact：docs/issues/issue-27/review-2a42f8f.md

## Delta 說明
- 前次審查：[review-d22e5cb](./review-d22e5cb.md)（PASS，SHOULD FIX S-1、S-2 與 4 項 NICE TO HAVE）。
- **Rebase 查核成立**：
  - `043d458` 是 `2a42f8f` 的祖先，而且是 `8f9d5a0` 的父提交，所以 `043d458..2a42f8f` 是三個提交的線性範圍（8f9d5a0 → f476916 → 2a42f8f）。
  - `git diff 8f9d5a0~1 8f9d5a0 | git patch-id --stable` = `5c1030ccceb41e38da5019b0ad5ac281b3c1ccf2`，與前次審查的 d22e5cb 相同，所以前次審查的結論可以沿用到 8f9d5a0。
  - f476916 提交的 `review-d22e5cb.md` 與我產出的報告逐字相同。
- 本次的增量是 `f476916..2a42f8f`，改了三個檔案：`src/cli/commands/doctor.ts`、`scripts/test-vector-recall.sh`、`docs/issues/issue-27/README.md`。
- 共用工作目錄仍可能被切換分支，所以以下驗證都在 scratchpad 裡用 `git archive 2a42f8f`／`git archive f476916` 解出的獨立副本上執行。沒有改動任何 tracked 檔案、全域套件、`~/.memoria`、真實的 `$LIBSQL_URL` 或 `~/.cache/memoria`。快取目錄的 mtime 仍是 12:54:59，沒有被寫入。

## 問題與風險

### MUST FIX
無

### SHOULD FIX
無

### NICE TO HAVE
- **N-1　symlink 會被誤判成「指向別處」**：`MEMORIA_DB_PATH` 是指向同一個 `sessions.db` 的 symlink 時，`path.resolve` 的比較結果是不同，於是不印 `Run:`。這是保守方向的誤判，只會少印命令，不會導致假綠燈；而且這種設定很少見。若想精確判斷，可以改用 `realpathSync`，但要另外處理檔案不存在的情況。不改也可以。
- **N-2　OPERATIONS.md 沒提到 `MEMORIA_DB_PATH` 分歧時的行為**：驗證段沒有說明這種情況下不會印出 `Run:`。doctor 輸出本身已經講清楚，文件補一句即可。
- **N-3　README 待確認表的順序**：TBD-4 排在 TBD-2 前面，而且沒有 TBD-3。只是外觀問題。

## 已查核維度

### 驗收與證據
- **綠燈**：在獨立的 `2a42f8f` 副本跑 `tsc --noEmit`、`node scripts/build.mjs`、`node dist/cli.mjs --help`、`bash -n scripts/test-vector-recall.sh` 都通過。`bash scripts/test-vector-recall.sh` 輸出 `修法原樣執行後 missing=0（即使已有 sync 游標）…`、`ingest 失敗時修法以非 0 結束（sh，rc=1）`、`MEMORIA_DB_PATH 指向別處 -> 不印可執行命令，改為說明`、`[vector] ok`。
- **S-1 紅燈**：在 f476916 的 bundle 上跑 2a42f8f 版的測試，得到 `Error: 照修法執行後仍有缺口: embedded=3 expected=7 missing=4`。與 README 一致。
- **變異**（都在 2a42f8f 副本上改動後重新 build）：
  - 拿掉 `--sync-target memoria-doctor-repair`：出現 `照修法執行後仍有缺口: … missing=4`，S-1 的斷言確實在把關。
  - 把 dbPath 防護改成 `if (false && …)`：出現 `MEMORIA_DB_PATH 與資料根不一致時不得印出可執行命令`，S-2 的斷言確實在把關。測試用的是同一份資料庫的副本，筆數完全相同，正好就是會產生假綠燈的情境。
  - 拿掉 `S=$?; … exit $S`：出現 `✗ ingest 失敗時修法仍以 0 結束`，結束碼的斷言在 subshell 形式下仍然有效。
- **AC-2**：`missing=0`、未啟用、override、remote 這幾個分支都沒有動，既有斷言照常通過。

### 相關失敗面
- **S-1 不是假綠燈**：
  - 用全域安裝形狀測試。做法是把全域 1.31.0 套件複製到路徑 `pkg dir'x/`，換上 HEAD 的 bundle，`skills/` 與 HEAD 逐檔相同。helper 旁邊沒有 `node_modules`，依賴從 `~/.cache/memoria/vector/690ebce65e137374` 唯讀載入。資料根路徑是 `home it's $HOME \`x\``。
  - 先寫入 2999 年的 `mcp-memory-libsql` 游標，再從 `/` 以 bash 與 dash 各執行一次修法。兩種 shell 都得到 `{"ok":true,"embedded":11,"skipped":6}`、rc=0，之後 doctor 顯示 `missing=11 → 0`。
  - 同一套流程換成 f476916 的 bundle，得到 `embedded:0`、`missing` 仍為 11。兩者對照，可以確認是新旗標修好了問題。
  - `--sync-target` 只影響產生器讀游標用的 key。產生器是唯讀的，payload 執行完就刪除，沒有任何流程會替 `memoria-doctor-repair` 寫入游標。
- **S-2 不是假綠燈**：
  - `MEMORIA_DB_PATH` 未設、等於預設路徑的絕對路徑、在資料根下的相對路徑 `.memory/sessions.db`、含 `..`／`./` 的同一路徑：這四種情況都會印 `Run:`，沒有過度攔截。
  - 指向別處：不印 `Run:`，改印說明，並列出兩個路徑。
  - symlink：見 N-1。
- **subshell 形式**：
  - bash 與 dash 在執行前先設 `D=keepD; S=keepS`，修法執行後仍是 `D=keepD S=keepS`。對照之下，舊版會覆寫成暫存路徑與 `0`。
  - `exit $S` 只結束 subshell，後面的指令照常執行，所以貼進互動式 shell 不會把 shell 關掉。
- **其他失敗路徑**：`mktemp` 失敗、產生器失敗、ingest 失敗，在 bash 與 dash 下都是 rc=1。暫存目錄沒有殘留，資料根的檔案集合在執行前後相同。
- **Run: 的擷取**：新增的「Run it in the same environment…」句子不含 `Run: `，所以用 `lastIndexOf('Run: ')` 擷取命令不受影響。
- **回歸**：在 2a42f8f 副本跑 `test-smoke.sh`、`test-cli-memory.sh`，以及先跑 `package-release-artifacts.sh` 再跑 `test-no-clone-install.sh`，結果都是 rc=0。後者會斷言乾淨安裝時 doctor 全綠。`check-release-doc-sync.mjs` 也通過。完整 CI 34/34 是協調者的回報，我只跑了上述與 doctor 相關的子集。

### 需求、架構、安全、品質（含過度設計）
- **符合 TBD-2 (A) 與 TBD-4**：沒有新增 CLI 介面，只用了產生器既有的 `--sync-target` 旗標。
- `vectorChecks`／`ingestFix` 改傳整個 `MemoriaPaths`，因為防護需要 `dbPath`。只有 `registerDoctorCommand` 一個呼叫端，影響範圍很小。
- 新增的註解都說明了為什麼這樣做：專用 sync target 的理由、防護擋的是哪一種假綠燈、`dirname(dirname)` 依賴的前提。沒有過度設計。
- 安全：路徑與資料根仍然經過 `quoteShellArg` 跳脫，命令裡沒有 token。

### 豁免、待確認與限制
- README 已把原本的游標限制劃掉，改寫成審查回應，對影響範圍的描述正確。TBD-4 記錄了使用者 2026-10-21 選「這次一起修」。
- `setup.ts` 的 `JSON.stringify` 加引號問題已明確記為範圍外，同意。
- 本次只驗證了 stub provider。local provider 可能寫入 `~/.cache/memoria`，依約束沒有執行。依賴從快取載入的路徑已經由 `@libsql/client` 實際載入成功證實。

## 流程判定
PASS
