# 審查報告
- 範圍：完整交付範圍（issue-39，分級 Small、風險 Low；3 個提交、10 個檔）
- Reviewed BASE SHA：8d5536301a9371bac4330c5551a2c86b12ce8026（`main`，v1.40.0 發版回填後；`git merge-base main 430907e` 相同）
- Reviewed HEAD SHA：430907edb8e58c7f2dfd370de3862219a74ac7a5
- Reviewed patch-id：0febfd7654e8c9e815714433b95dffd64db7db4c（`git diff 8d55363..430907e | git patch-id --stable`）
- 獨立 reviewer：Claude Code 獨立 subagent（未參與 issue-39 的規劃與實作），2026-11-26

## 問題與風險

- **MUST FIX**：無。
- **SHOULD FIX**
  - **S1** `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:66`：「Those memories accrue utility and rank higher next time.」與程式不符。`src/core/db/recall.ts:12-23` 的效用加權只會往下調：factor = 0.5 + 0.5 × 平均效用，範圍是 [0.5, 1]，註解寫明「utility never boosts a hit above its relevance×decay score」；根目錄 `AGENTS.md:197` 也寫「down-weighted by accrued per-memory utility」。所以帶 `--hits` 回報，最多讓記憶保持原排序（分數 1），分數低就往下排，不會讓它比沒有回報時排得更高。這句是本 diff 新寫的，也是部署給所有 host 的文字。它把 agent 推向帶 `--hits`，方向和最大風險的防守一致，不會造成錯誤寫入，所以不列 MUST FIX；但 agent 可能誤以為回報能把記憶往上推，因而灌高 `--score`。建議改成寫真實效果，例如：「Those memories accrue that score: a low score moves them down in later recalls, a high one keeps their place and spares them from stale pruning.」（stale prune 對有效效用 ≥ 0.5 的記憶豁免，見 `docs/OPERATIONS.md:58`）。改後部署 skill 有變，`check-deployed-skill-sync` 與 `test-npm-install.sh` 要重跑，PASS 也要經增量覆審重新取得。
- **NICE TO HAVE**
  - **N1** `docs/issues/issue-39/README.md:47`：`## 風險與首要驗證` 的「**完成證據**：待實作後補上。」沒有回填；實際證據已寫在步驟 1～3。這一節屬凍結內容，單獨為它修改會讓 PASS 失效，建議只在處理 S1 時一起改成指向步驟 1～3。
  - **N2** `scripts/test-cli-memory.sh:529`：help 斷言要求「no effect」和 `--used` 在同一行。commander 在沒有 TTY 時以 80 欄折行，現在剛好在第一行；之後改寫 help 讓這幾個字折到第二行，斷言會誤報紅燈（不會變成假綠燈）。可改成把 help 壓成一行再比對，例如 `u39 feedback --help | tr -s ' \n' ' ' | grep -qi -- '--used Accepted.*no effect'`。
  - **N3** `src/core/types.ts:448`：`used?: boolean // explicit host signal that the recall was used`。依新的 API 文件，`used` 只在沒有 `utility_score` 時用來推算分數，這個註解可以順手改成同樣的說法。這個檔不在 README「涉及檔案」中，留到之後處理也可以。

## 已查核維度

### 驗收與證據

核准基線：README 沒有 `**核准 commit**` 欄位。依 `acceptance.md`，Small + Low 不需要核准 commit，對照核准原話即可。以該檔的推導命令（`git log -1 -G '^...\*\*核准來源\*\*...' 430907e -- docs/issues/issue-39/README.md`）得到 `641922c5511b1dc63b7fbb461c250e28c610ce19`，它是 HEAD 的祖先。`git diff 641922c 430907e -- docs/issues/issue-39/README.md` 只動到步驟狀態、完成證據、Timeline 與 `**狀態**`，AC-1～4 的文字與核准來源都沒變。核准來源寫的是使用者 2026-11-26 對 TBD-1 回「好 issue-39 選 a」、對 AC-1～4 回「核准」，和 `docs/issues/issue-36/README.md:52` 的 TBD-1、`review-88b341c` S1 對得上。

| 編號 | 證據 | 結論 |
|---|---|---|
| AC-1 | `test-cli-memory.sh` (Q) 段 529-540 行。斷言用的是字面值 `1\|0.4 → 2\|0.8`，不是由實作重算出來的，而且兩列 telemetry 互相比對。reviewer 以故障注入確認斷言抓得到錯（見下表 A、B、C、F、G）。HEAD 上 `test-cli-memory.sh` exit 0；`node dist/cli.mjs feedback --help` 顯示 `--used  Accepted for compatibility; has no effect (--score is recorded, --hits picks the memories)` | 通過，不是假綠燈 |
| AC-2 | (Q) 段 541-545 行：先對 `memory_utility` 整表取快照，只帶 `--score 0.7` 回報後再比一次，並斷言 telemetry 的值是 0.7。注入 D（沒有 hits 時也累積效用）會失敗 | 通過，不是假綠燈 |
| AC-3 | `git grep -- --used skills/` 沒有結果；feedback 段改成三種情況（`DEPLOYED_SKILL.md:66-68`）；`node scripts/check-deployed-skill-sync.mjs` 輸出 `deployed_skill_check=ok version=1.40.0`；`test-bootstrap.sh`、`test-npm-install.sh` 都 exit 0 | 通過；措辭見 S1 |
| AC-4 | `git diff 8d55363..430907e -- src/core src/server.ts src/sdk.ts` 為 0 行；`CLI.md:66`／`CLI.zh-TW.md:66`、`API.md:97-99`／`API.zh-TW.md:89-90` 與 `telemetry.ts:99-101,111` 一致；`test-http-api.sh`、`test-utility-ranking.sh` exit 0；`release:docs-check` 輸出 `Release doc sync check passed for v1.40.0` | 通過 |

**故障注入**（在 worktree 暫時修改原始碼，`pnpm run build` 後執行 (Q) 段；每輪結束都 `git checkout -- src`，最後重新 build，`git status --short` 只剩本報告）。A 用完整的 `test-cli-memory.sh` 跑時，在更前面的 explicit 段就失敗了（`✗ no explicit observation recorded`）。為了確認 (Q) 段自己抓得到，另外把腳本開頭的設定與 (Q) 段抽成 scratchpad 的獨立腳本來跑：

| 注入 | 修改 | (Q) 段結果 |
|---|---|---|
| 基準 | 無 | exit 0 |
| A | `feedback.ts`：只有帶 `--used` 時才送 hits（等於做法 (b)） | exit 1：`AC-1：兩次回報對 utility 的增量應相同，實得 1\|0.4 → 1\|0.4` |
| B | `feedback.ts`：帶 `--used` 時把分數改成 1 | exit 1：`AC-1：帶與不帶 --used 的 telemetry 應相同` |
| C | `feedback.ts`：帶 `--used` 時把逐筆效用加倍（telemetry 不變） | exit 1：`實得 1\|0.8 → 2\|1.2000000000000002` |
| D | `telemetry.ts`：沒有 hits 時把分數歸給所有 session 與既有效用列 | exit 1：`AC-2：沒帶 --hits 時 memory_utility 不應改變` |
| E | `feedback.ts`：`options.used ?? true` 改成 `?? false`（寫入不受影響） | exit 0，符合預期：分數一定會送，`used` 不會被讀到 |
| F | `feedback.ts` 換回 BASE 版（舊的 help） | exit 1：`--used  Mark the recall as used` |
| G | `feedback.ts`：帶 `--used` 時丟出錯誤 | exit 1：`AC-1：帶 --used 的既有呼叫應 exit 0` 等 3 項 |

**在 HEAD 重跑**（2026-11-26T17:09+08:00，每個命令都加 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 前綴）：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`release:docs-check`、`check-deployed-skill-sync`，以及 `test-cli-memory`、`test-smoke`、`test-memory-attributes`（第 442 行仍帶 `--used`，確認相容）、`test-utility-ranking`、`test-http-api`、`test-bootstrap`、`test-npm-install`，全部 exit 0。

紅綠燈證據：步驟 1 記錄了 help 斷言的紅燈；reviewer 的注入 F 在 BASE 版 help 上重現了這個紅燈。AC-1 的寫入比對與 AC-2 是回歸保護，README 也這樣揭露，依 `verification.md` 不算缺失；注入 A～D、G 證明它們抓得到錯。步驟 2、3 只動文件，以靜態檢查與部署測試作為等價證據，適用。

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋與判定 |
|---|---|---|
| 正式回報時省略 `--hits`（最大風險） | skill 要求結果用在工作上時帶 `--hits`，並寫出帶上的效果 | `DEPLOYED_SKILL.md:66` 放第一行，命令模板寫明 `ids of the hits you used`；第三種情況限定為「whose results did not go into your work」，界線清楚。措辭可接受，效果的說法有誤，見 S1 |
| issue-36 的情境：只是測試的 recall | 照品質給分、不帶 `--hits`，不累積效用、排序不變 | 第 68 行涵蓋；`recall_telemetry.utility_score` 只用在 stats、校準與 `routeUtility`（`telemetry.ts:192-275`），不進入排序或路由，所以「ranking is unaffected」屬實 |
| 沒有幫助 | `--score 0`，不歸因到個別記憶 | 第 67 行，符合 AC-3；`stats --zero-utility` 照樣列得出來 |
| 既有呼叫帶 `--used` | 照常成功，寫入相同 | 注入 G、`test-memory-attributes.sh:442`、`test-cli-memory.sh:206` |
| HTTP／SDK 的 `used` | 行為不變；文件與 `telemetry.ts:99-101` 一致 | 三個檔沒有 diff；API 文件寫「只在沒有 `utility_score` 時推算，true 為 1、false 為 0」，`hits[]` 決定歸因，與程式相同。SDK `markRecallUseful` 不送 `utility_score`，靠 `used` 推算，和文件一致。根目錄 `AGENTS.md:334` 的 HTTP 範例 `{"signal":"explicit","used":true}` 與新說明一致 |
| 其他地方提到 `--used` | 指導性文字都已更新 | `git grep -- --used`：`skills/memoria-memory-sync/SKILL.md`、README 雙語、`docs/INTEGRATIONS*`、`docs/OPERATIONS.md`、adapter 都沒有。剩下的是 CHANGELOG 的歷史條目（1.40.0 的第 19 行、issue-4 的第 380 行，屬歷史紀錄，不改）、`docs/HANDOVER.md:16` 的進度描述，以及兩支測試的相容呼叫 |

### 需求、架構、安全、品質

- **需求**：符合做法 (a)：寫入語意與 schema 不變，`feedback.ts` 只改 help 與註解（第 24-27 行），`used: options.used ?? true` 照舊。範圍和 README「涉及檔案」一致，沒有超出。
- **架構**：核心、HTTP 與 SDK 都沒動，CLI 介面維持不變，旗標照常接受。
- **安全**：不適用，沒有新的輸入面或權限變更。
- **CHANGELOG**：`[1.40.0]` 之後的內容與 `main` 逐字相同（以 `diff` 比對兩邊從 `## [1.40.0]` 起的內容，沒有差異）。issue-39 的條目只在 `[Unreleased]` 的 `### Changed`，rebase 解衝突沒有波及已發布的區段。
- **公開 repo 規則**：新增的行沒有個人絕對路徑，也沒有外部專案的真實名稱；三個提交的訊息都是 `type(issue-39): 中文摘要`，沒有 AI 署名或 `Co-Authored-By`。
- **writing-rules**：三種情況以正面表述寫成。「and no `--hits`」是無法正面表述的護欄，後面接著寫了效果（不累積效用），不是單純的禁令；每一行都有不同分支在用，不是 no-op。效果描述的事實問題見 S1。
- **品質（重複與過度設計）**：(Q) 段的 `q39`／`u39`／`fail39` 和腳本既有的 `q()` 有部分重複，但為了使用獨立資料根、一次讀多欄，可以接受。中英文文件各自寫一次，屬雙語同步的必要重複。沒有過度設計。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-1 已解決（選 (a)），維持原狀態。
- 故障注入用的是 scratchpad 裡從 (Q) 段抽出的獨立腳本，沒有改動版控中的測試；完整腳本的 HEAD 綠燈另外跑過。
- 沒有跑完整的 CI 清單（wiki、repo、http-mcp 組的其他腳本）；本 diff 沒有動到那些路徑，風險低。
- 給協調者：README 還沒有 `## 現況`。保存本報告的提交依流程契約 2.8，在 `## 概述` 之後建立這一節，`**現行 review**` 指向 `review-430907e.md`；`**狀態**` 依結果更新。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
