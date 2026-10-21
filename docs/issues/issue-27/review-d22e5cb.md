# 審查報告
- 範圍：完整 PR
- Reviewed BASE SHA：78c178284a45ae2685b0174595e7de2c5f0c7c85
- Reviewed HEAD SHA：d22e5cb537fd908b78340638e0a5e95705dc3edb
- Reviewed patch-id：5c1030ccceb41e38da5019b0ad5ac281b3c1ccf2（`git diff 78c1782 d22e5cb | git patch-id --stable`）
- 獨立 reviewer：Claude（Opus 5.5，獨立審查 subagent），2026-10-21
- Review artifact：docs/issues/issue-27/review-d22e5cb.md

> 審查途中，共用的工作目錄被另一個行程切到 `issue-26-bootstrap-failure-output`。為了不受影響，以下驗證都在 scratchpad 裡用 `git archive d22e5cb`／`git archive 78c1782` 解出的獨立副本上重跑。副本的 `node_modules` 用 symlink 指回 repo。沒有改動任何 tracked 檔案、全域套件、`~/.memoria`、真實的 `$LIBSQL_URL` 或 `~/.cache/memoria`。

## 問題與風險

### MUST FIX
無

### SHOULD FIX

**S-1　游標存在時，照修法執行會回報成功，`missing` 卻不會變少；README 低估了這種情況出現的機率**（`需決策`）
- 位置：`src/cli/commands/doctor.ts` 的 `ingestFix`；`docs/issues/issue-27/README.md` 完成證據中的「限制」一段
- 實測：在隔離的資料根先跑一次 `build-mcp-bridge-payload.mjs`，再跑 `update-mcp-sync-state.mjs` 推進 `mcp-memory-libsql` 游標，向量庫維持空的。doctor 顯示 `embedded=0 expected=11 missing=11`。照修法原樣執行，ingest 印 `{"ok":true,"embedded":0,"skipped":0}`、rc=0，再跑 doctor 仍是 `missing=11`。
- 影響：
  - 失敗是無聲的：結束碼 0、ingest 回 `ok:true`。依 DEPLOYED_SKILL 收尾步驟操作的 agent，只會看到「修法跑成功，缺口卻還在」，從輸出裡找不到原因。
  - README 寫「有人跑過 `update-mcp-sync-state.mjs`」才會發生，「本機與測試環境都沒有這個游標」。但游標不需要有人手動推進。repo 自己文件化的 hybrid runner `skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh` 只要 `LIBSQL_URL` 有設、內建 MCP ingest 成功，就會自動 `commit_sync_cursor`。這和向量召回用的是同一個環境變數。
  - 更糟的是，這支 runner 的向量 ingest 預設關閉（`MEMORIA_VECTOR_ENABLE=0`），開了也是 fail-open，而且排在游標提交之後執行。所以「游標已推進、向量庫卻短少」正好就是這支 runner 會產生的狀態，也就是 coverage 檢查最該抓到、修法最該修好的那群人。`INGEST_PLAYBOOK.md`（被 DEPLOYED_SKILL 列為參考資料）也教使用者走這條路。
  - AC-1 的「執行後再跑 doctor，missing=0」在這個可以實際出現的設定下不成立。
- 建議：修法仍在 (A) 的範圍內，不新增 CLI 介面。給產生器加上 `--sync-target <一個沒有人會提交的名稱>`，例如 `memoria-vector-repair`，讓 `cursorBefore` 變成 null、取出全部節點。產生器是唯讀的，不會寫回游標，所以這樣做沒有副作用；明確帶旗標也能蓋過使用者環境裡的 `MEMORIA_MCP_SYNC_TARGET`。實測：在同一個有游標的資料根，加上這個旗標後輸出 `{"ok":true,"embedded":11,"skipped":6}`，doctor 顯示 `missing=0`。另外建議在 test-vector-recall.sh 的 issue-27 段補一個「先推進游標再照修法執行」的案例。如果決定不修，至少要把 README 的限制說明改正確，說明 hybrid runner 會自動推進游標。由使用者決定要在本 issue 修，還是另開 issue。

**S-2　設了 `MEMORIA_DB_PATH` 時，修法讀的是另一個資料庫**
- 位置：`src/cli/commands/doctor.ts:170`，`ingestFix(report.helperPath, paths.memoriaHome)`
- 原因：doctor 用 `paths.dbPath` 計算 expected，這個路徑會遵守 `MEMORIA_DB_PATH`。產生器則固定讀 `<--memoria-home>/.memory/sessions.db`，不認 `MEMORIA_DB_PATH`。
- 實測（`MEMORIA_HOME=H`、`MEMORIA_DB_PATH=O/sessions.db`）：
  - A：`H/.memory/sessions.db` 不存在時，修法失敗並印出 `Cannot open database because the directory does not exist`，rc=1。這是有聲的失敗，可以接受。
  - B：`H/.memory/sessions.db` 是另一份內容時，修法 rc=0、`embedded=5`，把**另一份語料**的向量寫進向量庫，doctor 變成 `embedded=5 expected=6 missing=1`。coverage 只比筆數、不比對 id，所以只要那份語料夠大，就會出現 `missing=0` 的假綠燈，而真正的記憶一筆也沒有進向量庫。
- 嚴重度：`MEMORIA_DB_PATH` 是有文件的設定（`docs/INSTALL.md:185`），但很少人用。舊版修法也有同樣的問題（同樣只帶 `--memoria-home <home>`），所以不算新引入的 regression。差別在於現在印的是「可以原樣執行的絕對路徑命令」，看起來更可信，使用者更不會懷疑它跑錯資料庫。
- 建議：在 `ingestFix` 加一道防護。`paths.dbPath` 不等於 `path.join(memoriaHome, '.memory', 'sessions.db')` 時不印 `Run:`，改成一句說明：產生器只讀 `<home>/.memory/sessions.db`，`MEMORIA_DB_PATH` 指到別處時需要手動處理。要做到這點，得把 `dbPath` 一起傳進去。

### NICE TO HAVE

- **N-1　`D`、`S` 會留在貼上命令的 shell 裡**：在互動式 shell 貼上執行後，使用者原本的 `D`、`S` 變數會被覆寫。可以把整串包成 subshell：`(D=$(mktemp -d) && … ; S=$?; rm -rf "$D"; exit $S)`。結束碼照樣往外傳，而且不會關掉使用者的 shell。
- **N-2　命令依賴從呼叫端繼承的環境變數**：命令依賴繼承下來的 `LIBSQL_URL`、`LIBSQL_AUTH_TOKEN`、`MEMORIA_EMBED_PROVIDER`。如果 doctor 是用行內環境變數執行的（`LIBSQL_URL=… memoria doctor`），在另一個 shell 貼上時，ingest 會以 `LIBSQL_URL is required` 失敗（有聲，rc=1）。provider 沒帶時預設是 `local`，不會悄悄寫進 stub 向量。OPERATIONS.md 已寫「in a shell with `LIBSQL_URL` set」，fix 文字可以補半句「in the same environment doctor ran in」。
- **N-3　`skillsRoot = dirname(dirname(helperPath))` 依賴一個沒寫出來的前提**：這行假設 coverage 只在沒有 override 時才計算，因此 `helperPath` 一定是我們自己出貨的 helper。目前成立（`inspectVectorLayer` 有 override 時 coverage 為 null），但沒有註解。以後如果有人讓 override 也計算 coverage，這裡會組出錯的路徑。建議加一行註解。
- **N-4　測試只用 bash 執行**：dash 我已手動驗證過（見下文）。可以視需要在測試裡多跑一次 `sh -c`，把「agent 可能貼進 sh」這點固定下來。
- **範圍外，只做紀錄**：`src/cli/commands/setup.ts:176-181` 印出的 `Start server`／`service install` 命令用 `JSON.stringify` 加引號，路徑裡有 `$` 或反引號時不是 shell-safe。這是既有行為，不在本 issue 範圍；之後可以改用同一個 `quoteShellArg`。

## 已查核維度

### 驗收與證據
- **綠燈**：在獨立的 `git archive d22e5cb` 副本跑 `tsc --noEmit`、`node scripts/build.mjs`、`node dist/cli.mjs --help` 都通過。`bash scripts/test-vector-recall.sh` 輸出 `修法原樣執行後 missing=0，資料根沒有多出檔案`、`ingest 失敗時修法以非 0 結束（rc=1）`、`[vector] ok`。審查一開始在 repo 工作目錄跑的結果也相同；當時 HEAD 仍是 d22e5cb。
- **紅燈**：在 `git archive 78c1782` 副本換上 HEAD 版的 test-vector-recall.sh，出現 `Error: missing>0 時 fix 必須以 Run: <命令> 結尾`，fix 內容正是舊版那兩段帶佔位符的說明。與 README 一致。
- **變異**：拿掉 `S=$?; … (exit $S)`、只留 `; rm -rf "$D"` 後，測試輸出 `✗ ingest 失敗時修法仍以 0 結束`，rc=1。失敗路徑的斷言確實在把關。
- **AC-2**：diff 只在 `missing>0` 時改變 fix 字串。`missing=0`、未啟用、override、remote 這幾個分支都沒有動，既有斷言照常通過。
- **全域安裝形狀**：把全域 1.31.0 套件複製到 scratchpad，只把 `dist/cli.mjs` 換成 HEAD 的 bundle（`skills/` 與 HEAD 逐檔相同）。helper 旁邊沒有 `node_modules`，依賴從 `~/.cache/memoria/vector/690ebce65e137374` 唯讀載入，better-sqlite3 取自套件自己的 `node_modules`。從 `/` 執行 doctor 印出的修法得到 `{"ok":true,"embedded":11,"skipped":6}`、rc=0，之後 doctor 顯示 `embedded=11 expected=11 missing=0`，資料根的檔案清單不變，暫存目錄沒有殘留。快取目錄的 mtime 維持原本的 12:54，沒有被寫入。doctor 也正確顯示 `vector embedder: … installed (~/.cache/memoria/vector/690ebce65e137374)`。

### 相關失敗面
- **引號**：在路徑 `…/we ird'd $x/pkg`（套件）與 `…/home it's $HOME \`x\``（資料根）下，`quoteShellArg` 產生的命令在 bash 與 dash 都正確執行，`missing` 從 11 變成 0。
- **暫存目錄與資料根**：以獨立的 `TMPDIR` 執行，結束後暫存目錄是空的，資料根的檔案集合在執行前後相同。
- **`mktemp` 失敗**（`TMPDIR=/nonexistent/x`）：bash 與 dash 都以 rc=1 結束。`rm -rf ""` 不會出聲，也沒有副作用。
- **產生器失敗**（sessions.db 被移走）：bash 與 dash 都以 rc=1 結束，`&&` 正確短路。
- **ingest 失敗**：測試已涵蓋，rc=1。
- **glob**：暫存目錄是新建的，產生器每次只寫一個檔案，所以一定剛好一個符合。產生器失敗時 `&&` 會短路，根本不會展開 glob。萬一沒有符合（例如開了 nullglob 或 failglob），ingest 會以 usage 錯誤 rc=1 結束，不會誤報成功。
- **結束碼**：最後的 `(exit $S)` 在 subshell 裡設定 `$?`，所以貼進互動式 shell 也不會把 shell 關掉。
- **zsh、fish**：本機沒有安裝，未測試。zsh 下 glob 沒有符合時會報錯，rc 非 0，屬於安全的失敗方向。
- **`helperPath` 為 null**：維持一句說明，不印 `Run:`。
- **override**：coverage 不計算，不會走到 `ingestFix`。
- **remote libSQL**：coverage 不計算，同樣不會走到 `ingestFix`。
- **`MEMORIA_DB_PATH`**：見 S-2。
- **游標**：見 S-1。

### 需求、架構、安全、品質（含過度設計）
- **符合 TBD-2 (A)**：只改了 doctor 的 fix 文字，沒有新增 CLI 介面。DEPLOYED_SKILL.md 不需要改：收尾步驟「run the fix it prints」在沒有游標、沒有 `MEMORIA_DB_PATH` 的情況下，已經可以從頭到尾照做。
- **`quoteShellArg` 的共用方式恰當**：`runtime.ts` 與 `doctor.ts` 都在 CLI 層，doctor 從 `../runtime.js` 匯入，沒有循環依賴，也沒有另寫一份。只是把既有函式改成 export，行為不變。
- **沒有過度設計**：`ingestFix` 約 10 行，`skillsRoot` 直接取自 recall 實際解析到的 helper 路徑，沒有另外推導一套路徑規則。
- **安全**：路徑與資料根都經過單引號跳脫；命令裡沒有 token。`LIBSQL_AUTH_TOKEN` 只從環境繼承，不會出現在輸出裡。
- **文件**：OPERATIONS.md 驗證段的更新正確。順手補上的 `NOT INDEXED` 與 recall-vector.ts 的註解一致。
- **測試**：issue-27 段刻意在 repo 以外的工作目錄執行，也同時斷言了「資料根不多出檔案」與「失敗時非 0」，設計合理。沒有涵蓋的是游標與 `MEMORIA_DB_PATH` 兩種情況，分別見 S-1、S-2。

### 豁免、待確認與限制
- README 有把游標限制寫出來，產生器的機制也描述正確。但「只有手動跑過 `update-mcp-sync-state.mjs` 才會發生」的評估不精確，hybrid runner 會自動推進游標，見 S-1。
- README 完全沒有提到 `MEMORIA_DB_PATH` 的分歧。
- expected 與實際 ingest 的範圍不完全對齊，這是既有問題，不在本 issue 範圍。例如產生器只帶出有 `memory_node_sources` 的 session，而 SkillLearned 會依名稱去重。tree index 完整時這些差異不會出現，本次也沒有觀察到。
- 本次只驗證了 stub provider。local provider 要載入快取裡的模型，可能寫入 `~/.cache/memoria`，依約束沒有執行。依賴載入的路徑已經由 `@libsql/client` 從快取載入成功證實。

## 流程判定
PASS

沒有 MUST FIX。S-1 建議在本 PR 一併修正：只要多加一個旗標，並在 README 改正對游標影響範圍的描述；要不要在本 PR 修需要使用者決定。S-2 可以在本 PR 補上防護，或另開 issue 處理。
