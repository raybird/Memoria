# 審查報告
- 範圍：完整交付範圍（issue-39，分級 Small、風險 Low），增量覆審
- Reviewed BASE SHA：8d5536301a9371bac4330c5551a2c86b12ce8026
- Reviewed HEAD SHA：03683f0fa406ef18a843dcfd671957fdc828e3d4
- Reviewed patch-id：e2fdf4e2d349d2be56dc4cd0b40a79513902b569（`git diff 8d55363 03683f0 | git patch-id --stable`）
- 獨立 reviewer：Claude Code 獨立 subagent（未參與 issue-39 的規劃與實作，也未撰寫 review-430907e），2026-11-26
- 增量覆審：上一份報告 `review-430907e.md`（PASS），增量範圍 `430907e..03683f0`。增量只處理該報告的建議，使用者選了 S1、N1、N2、N3 四項都修正（README TBD-2）。條件核對：`git merge-base main 03683f0` 為 `8d55363`，與原 Reviewed BASE 相同；`430907e` 是 `03683f0` 的祖先，之後沒有改寫歷史；`b20c86e` 以 verify-artifact 判為只有記帳變更（新增報告、狀態、Timeline、現況、現行 review）。

## 問題與風險

- **MUST FIX**：無。
- **SHOULD FIX**：無。
- **NICE TO HAVE**（都是本輪增量引入的措辭或寫法，不影響寫入與判定）
  - **N1** `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:66`：新句「a low one moves them down in later recalls, a high one keeps their place and protects them from stale pruning」方向正確（不再宣稱往上推），但後半句略為過度承諾，有兩處：
    - 「keeps their place」只在分數為 1 時嚴格成立。`src/core/db/recall.ts:21-24` 的係數是 0.5 + 0.5 × 平均效用，分數 0.9 的係數是 0.95，仍會略微往下，可能被沒有回報過的記憶超過。
    - 「protects them from stale pruning」只對 session id 的 hit 成立。`src/core/db/prune-export.ts:248-267` 的 stale prune 只用 session id（level-2 節點經 `memory_node_sources` 對到的 session，以及孤兒 session）查 `memory_utility`；回報的 hit 是 event id 時（CLI 筆記的 `noteev-{fp}`、匯入 session 的決策事件），效用寫在 event id 上，不會被查到。reviewer 在隔離資料根實測：兩則筆記各以 `--score 0.9` 回報一次，一筆用 `note-` id、一筆用 `noteev-` id，把時間改舊後執行 `prune --stale-days 30`，結果 `removedNodes:1`，被刪的是 `noteev-` 那則的 `node:session:note-…`。門檻本身沒有問題：CLI 預設 `--signal explicit`，`EXPLICIT_UTILITY_MIN_OBS = 1`（`src/core/utils.ts:149`），一次回報就達標；豁免條件是平均效用 ≥ 0.5（`prune-export.ts:16`），比「high」寬。
    - 這個寫法是 review-430907e S1 自己建議的句子，根源是 `docs/OPERATIONS.md:58` 把豁免寫成「memories」而沒有限定 session，那段屬沒有改動的既有內容。對 agent 的行為沒有影響（結果用在工作上時本來就該帶 `--hits`），所以不阻擋。若要精確，可改成「a score below 1 moves them down in later recalls, the lower the further; a score of 1 leaves their place unchanged」，並刪掉 stale prune 子句或改成「and, for session hits, spares them from stale pruning at 0.5 or above」。改了部署 skill 就要重跑 `check-deployed-skill-sync` 與 `test-npm-install.sh`，PASS 也要再經覆審。prune 不認 event id 的效用是否另開追蹤，由協調者詢問使用者。
  - **N2** `scripts/test-cli-memory.sh:530`：新斷言 `'--used [^-]*no effect'` 確實不再依賴折行，但多了一種誤報紅燈的情況：`--used` 的說明在「no effect」之前出現任何連字號時（例如 `back-compat`），斷言會失敗，舊的同行比對反而通過（見下表注入 Y）。這種失敗是紅燈，不是假綠燈，失敗訊息也會印出 help 行，容易診斷。若要兼顧，可改成 `'--used ([^-]|-[^-])*no effect'`：允許單一連字號，遇到下一個 `--` 選項就停。reviewer 以四種字串驗證過這個寫法（連字號、`no effect` 只在 `--hits` 說明裡、現行文字、舊文字），判定都正確。
  - **N3** `docs/issues/issue-39/README.md:52`：回填的完成證據寫「review-430907e 另以 6 種會改變寫入的注入錯誤確認這兩項斷言都會失敗」，與上一份報告的表格有出入。上一份報告共有 7 種注入，其中 6 種讓測試失敗（A、B、C、D、F、G）。真正改變寫入的是 A～D 四種；F 只換回舊的 help，抓到它的是 help 斷言，不是 AC-1、AC-2 的回歸斷言；G 是丟出錯誤。每種注入也只讓其中一項斷言失敗，不是「兩項都失敗」。證據本身存在，只是轉述不精確，不算不實回報。這一節屬凍結內容，再改又會讓 PASS 失效，建議不改；若要留下更正，依 `review-evidence.md` 記在待確認事項，PASS 可沿用。

## 已查核維度

### 上一份報告的建議逐項確認

| 建議 | 修正位置 | 結論 |
|---|---|---|
| S1 | `DEPLOYED_SKILL.md:66` 改成「Those memories accrue that score: a low one moves them down in later recalls, a high one keeps their place and protects them from stale pruning.」`git grep` 在 skills、CLI／API 雙語、README、INTEGRATIONS 與 `src/cli` 都找不到「rank higher」「boost」這類往上推的說法 | 已修好：不再宣稱效用會讓排序上升，「accrue that score」與 `feedback.ts` 把同一個分數歸給每筆 hit 的寫法一致。殘留的不精確見 N1 |
| N1 | `README.md:52` 回填完成證據 | 已回填；轉述的注入數與性質不精確，見 N3 |
| N2 | `test-cli-memory.sh:529-530` 先以 `tr -s ' \n' ' '` 合併換行與空白，再以 `grep -qiE -- '--used [^-]*no effect'` 比對，並加註原因 | 已修好，注入驗證見下表；新增的誤報紅燈情況見 N2 |
| N3 | `src/core/types.ts:448` 改成 `derives a score only when utility_score is absent (true → 1, false → 0)`；README「涉及檔案」第 29 行列入此檔，限定只改這個註解 | 已修好：與 `src/core/db/telemetry.ts:99-101` 的推算邏輯、`docs/API.md` 的新說明一致；`git diff 430907e..03683f0 -- src/core/types.ts` 只有這一行 |

**help 斷言的注入驗證**：在 worktree 暫時修改 `src/cli/commands/feedback.ts`，`pnpm run build` 後，以腳本第 530 行的同一條管線（新斷言）與上一版的同行比對（舊斷言）分別判定。每輪結束都 `git checkout -- src`，最後重新 build，`git status --short` 只剩本報告。

| 注入 | `--used` 的說明 | 新斷言 | 舊斷言 | 判定 |
|---|---|---|---|---|
| 基準 | 現行文字，`no effect` 在第一行 | 通過 | 通過 | 正確 |
| F | 換回 BASE 版 `Mark the recall as used` | 失敗 | 失敗 | 不是假綠燈 |
| W | 說明加長，`no effect` 折到第二行 | 通過 | 失敗 | 折行不再誤報紅燈 |
| X | `--used` 不寫 `no effect`，改寫在 `--hits` 的說明裡 | 失敗 | 失敗 | `[^-]*` 不會跨到下一個選項，不是假綠燈 |
| Y | `Accepted for back-compat; has no effect …` | 失敗 | 通過 | 誤報紅燈，見 N2 |

### S1 新敘述與程式、文件的一致性

- 「accrue that score」：`feedback.ts` 把 `--score` 原值放進每筆 hit 的 `utility_score`；`signal` 預設 `explicit`，寫入 `explicit_observations`／`explicit_sum`（`telemetry.ts:111-120`）。一致。
- 「a low one moves them down」：`effectiveUtility` 對 explicit 只要 1 次觀察（`utils.ts:149,162`），所以一次回報就生效，不需要累積門檻；係數 < 1 就往下調。一致。後續回報會和之前的分數平均，單次低分不一定讓排序往下，句子沒有承諾到那麼細，可以接受。
- 「keeps their place」「protects them from stale pruning」：見 N1。`docs/OPERATIONS.md:58` 的豁免條件（explicit 1 次觀察、平均 ≥ 0.5）與 `prune-export.ts:16,265` 一致，但只對 session id 成立。
- 第 68 行「Without `--hits` no memory accrues utility, so ranking is unaffected」沒有改動，結論沿用上一份報告。

### README TBD-2 與記帳格式

- `## 現況`（第 15-17 行）與 `## 待確認事項`（第 66-72 行）沒有 `<`；以粗體開頭的只有 `**現行 review**` 一行，屬允許的例外；沒有以 `[` 開頭的行。TBD-2 是照範本補的表格列。
- TBD-2 的狀態為 `已解決`，寫了日期、使用者原話（「是否能增量複審先」）與四項的結論，和使用者選擇四項都修、走增量覆審一致；影響欄 `AC-1、AC-3` 對應 N2（AC-1 的 help 斷言）與 S1（AC-3 的 skill 措辭），合理。TBD-1 維持原狀。
- `**狀態**` 為 `審查中`，Timeline 補了審查結果與送增量覆審兩列，與實際進程一致。
- 以 `430907e` 為被審查提交、`03683f0` 為 HEAD 執行 verify-artifact，結果是 `INVALID：被審查提交之後變更了 scripts/test-cli-memory.sh（M）`，符合預期（這次本來就需要覆審）。

### 驗收與受影響的測試（在 03683f0 重跑）

2026-11-26T17:20+08:00 起，每個命令都加 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 前綴：

- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`：exit 0。
- `pnpm run release:docs-check`：exit 0，`Release doc sync check passed for v1.40.0`。
- `node scripts/check-deployed-skill-sync.mjs`：exit 0，`deployed_skill_check=ok version=1.40.0`。
- `bash scripts/test-cli-memory.sh`：exit 0，(Q/issue-39) 段通過，`✓ all checks passed`。
- `bash scripts/test-npm-install.sh`：exit 0，`[npm-install] ok`（包含部署 skill 的驗證）。

AC-1～4 的其他結論與證據不受本輪變更影響（`types.ts` 只改註解，`feedback.ts` 與 core 都沒動），沿用上一份報告。

### 需求、架構、安全、品質

- 需求與範圍：增量只動五個檔，都對應 S1、N1～N3 與記帳；`types.ts` 已列入涉及檔案，沒有超出範圍。
- 架構、安全：不適用，沒有改程式邏輯、輸入面或權限。
- 公開 repo 規則：增量新增的行沒有個人絕對路徑，也沒有外部專案的真實名稱；`b20c86e`、`03683f0` 的提交訊息都是 `docs(issue-39): 中文摘要`，沒有 AI 署名或 `Co-Authored-By`。
- 品質：新斷言加了一行註解說明為何合併換行，沒有重複或過度設計。

其餘沿用 review-430907e.md。

### 豁免、待確認與限制

- 沒有 Gate 豁免。
- N1 的 stale prune 實測用 scratchpad 的隔離資料根，以 better-sqlite3 把 `sessions.timestamp` 與 `memory_nodes.updated_at` 改成 2020 年來模擬過期，沒有動到版控檔案。
- 給協調者：保存本報告的提交要把 README `## 現況` 的 `**現行 review**` 改成 `review-03683f0.md`，`**狀態**` 依結果更新。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
