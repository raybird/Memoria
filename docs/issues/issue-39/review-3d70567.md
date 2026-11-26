# 審查報告
- 範圍：完整交付範圍（issue-39，分級 Small、風險 Low）
- Reviewed BASE SHA：a26713142474f87bda61c8478d768efeb24bb940
- Reviewed HEAD SHA：3d70567b924fa83d552f900d579038fd6d0c65d2
- Reviewed patch-id：bbda56d7a9cdd23adc4c0fdad453ddcbf82a52a4（`git diff a267131 3d70567 | git patch-id --stable`）
- 獨立 reviewer：Claude Code 獨立 subagent（未參與 issue-39 的規劃與實作，也未撰寫 review-430907e、review-03683f0），2026-11-26
- 增量覆審：曾經審查過（review-430907e.md、review-03683f0.md，都是 PASS），本次改做完整審查。依 `docs/agents/review-evidence.md`「增量覆審」，兩項條件不成立：
  - 條件 1：上一份報告的 H1 `03683f0` 不是新 HEAD 的祖先（`git merge-base --is-ancestor 03683f0 3d70567` 失敗），分支在 H1 之後 rebase 過，屬改寫歷史。
  - 條件 2：`git merge-base main 3d70567` 是 `a267131`，不是上一份報告的 Reviewed BASE `8d55363`。
  - 規範對「只多了另一個 issue 文件的 rebase」沒有例外，任一條件不成立就完整審查，所以 Reviewed BASE 取 rebase 後的 merge-base `a267131`。

## 問題與風險

- **MUST FIX**：無。
- **SHOULD FIX**：無。
- **NICE TO HAVE**
  - **N1** `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:66`：「a low one moves them down in later recalls」對一般 hit 成立。對 CLI 筆記（`note-`／`noteev-` 兩半）只部分成立，因為 `src/core/memoria.ts:808` 先做效用加權，`:818` 才用 `collapseNoteHits`（`src/core/utils.ts:78`）把兩半收成排名較前的那一半。結果是只有回報的那一半被往下調，沒回報的另一半照原分數接手那個位置。reviewer 在隔離資料根實測：
    - 對 `noteev-{fp}` 回報 `--score 0` 後，下次 recall 留下的是 `note-{fp}`，分數維持 1.1991e-5 不變。
    - 對兩則筆記的 `note-` 半邊回報 0 後，換成 `noteev-` 半邊出現，分數從約 1.2e-5 降到約 7.1e-6～7.2e-6。有往下，但幅度比單一 hit 的 0.5 倍小。
    - 這正是 issue-40 概述第二點描述的 recall 那一面，不是 issue-39 引入的問題。對 agent 的行為也沒有影響：結果用在工作上時本來就該帶 `--hits`。所以 issue-39 不必改。建議 issue-40 寫驗收條件時，把這一行列為要成立的可觀察結果，並放進它的涉及檔案。

## 已查核維度

### 流程前提與 rebase

- `git range-diff 8d55363..25e5b7c a267131..596b896`：六個提交都是 `=`。`git diff 8d55363 25e5b7c` 與 `git diff a267131 596b896` 的 patch-id 都是 `9588e3b6859170ee7f083802a9b0eb4283862e86`；`git diff 25e5b7c 596b896` 只多了 `docs/issues/issue-40/README.md`。rebase 沒有改變 issue-39 的內容。
- `a267131` 只新增 `docs/issues/issue-40/README.md`（52 行），和 issue-39 的檔案沒有交集。
- 核准：Small + Low，依 `acceptance.md` 不需要 `**核准 commit**`，對照核准原話即可。核准來源（`README.md:43-44`）是使用者 2026-11-26 對 TBD-1 回「好 issue-39 選 a」、對 AC-1～4 回「核准」。`git diff 87d292a 3d70567 -- docs/issues/issue-39/README.md` 裡，AC-1～4 的條文、核准日期與核准來源都沒有變動。

### 驗收與證據（2026-11-26T17:53+08:00 起在 3d70567 執行）

每個命令都加 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 前綴：

- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`：exit 0。
- `pnpm run release:docs-check`：exit 0，`Release doc sync check passed for v1.40.0`。
- `node scripts/check-deployed-skill-sync.mjs`：exit 0，`deployed_skill_check=ok version=1.40.0`。
- `bash scripts/test-cli-memory.sh`：exit 0，(Q/issue-39) 段印出「help 寫明 --used 不影響寫入；帶不帶 --used 寫入相同；只給 --score 時沒有記憶累積效用」。
- `bash scripts/test-utility-ranking.sh`（`[ranking] ok`）、`test-http-api.sh`（`[http] ok`）、`test-bootstrap.sh`（`[bootstrap] ok`）、`test-npm-install.sh`（`[npm-install] ok`，含部署 skill 的驗證）：都是 exit 0。

| 驗收 | 證據 | 結論 |
|---|---|---|
| AC-1 | `src/cli/commands/feedback.ts:24-27` 只改 `--used` 的說明與註解，`used: options.used ?? true` 與分數照舊；`test-cli-memory.sh:530-540` 斷言 help、帶 `--used` 時 exit 0、兩列 telemetry 相同、utility 增量 `1\|0.4` 到 `2\|0.8` | 通過 |
| AC-2 | `test-cli-memory.sh:541-547`：只給 `--score 0.7`，telemetry 記 0.7，`memory_utility` 整表前後相同；與 `src/core/db/telemetry.ts:111` 只在有 hits 時寫入一致 | 通過 |
| AC-3 | 兩檔 `grep -- --used` 為 0；`DEPLOYED_SKILL.md:63-70` 是三種情況各一行，「用在工作上」帶 `--hits`、「只是測試或看看」不帶 `--hits` 並說明排序不受影響；sync 檢查與 npm-install 部署驗證通過 | 通過（措辭見 N1） |
| AC-4 | CLI 雙語 `CLI.md:66`、`CLI.zh-TW.md:66`；API 雙語 outcome 段。`used` 推算與 `telemetry.ts:99-101` 一致，SDK `markRecallUseful`（`src/sdk.ts:90-98`）送 `used` 而不送分數，正是文件說的推算情形；`telemetry.ts`、`server.ts`、`sdk.ts` 在 `a267131..3d70567` 沒有 diff | 通過 |

**測試真偽（寫入注入）**：暫時修改程式、build 後跑 `test-cli-memory.sh`，每輪結束都 `git checkout -- src`：

| 注入 | 內容 | 結果 |
|---|---|---|
| I1 | `feedback.ts` 帶 `--used` 時把 telemetry 分數減半 | exit 1，`✗ AC-1：帶與不帶 --used 的 telemetry 應相同` |
| I2 | `telemetry.ts` 沒有 hits 時仍替 `memory_utility` 所有列加一次 explicit 觀察 | exit 1，`✗ AC-2：沒帶 --hits 時 memory_utility 不應改變` |

### 上一份報告建議的修正（N1、N2，使用者選修正）

- **N1**：`DEPLOYED_SKILL.md:66` 已刪掉「a high one keeps their place and protects them from stale pruning」，只留「a low one moves them down in later recalls」。部署檔 grep `prune`、`keeps their place`、`rank higher`、`boost` 都是 0。新句與 `src/core/db/recall.ts:21-24`（係數介於 0.5 到 1，只往下調）一致，不再承諾排序上升或 prune 保護。筆記兩半的限制見本報告 N1。
- **N2**：`test-cli-memory.sh:530` 改成 `'--used ([^-]|-[^-])*no effect'`。暫時改 `--used` 的說明、build 後，以同一條管線（新斷言）與 `03683f0` 的 `[^-]*` 版（前一版）判定：

| 注入 | `--used` 的說明 | 新斷言 | 前一版 | 判定 |
|---|---|---|---|---|
| 基準 | 現行文字（`--score`、`--hits` 在 `no effect` 之後） | 通過 | 通過 | 正確 |
| F | BASE 的 `Mark the recall as used` | 失敗 | 失敗 | 舊 help 會紅燈 |
| W | 說明加長，`no effect` 折到第二行 | 通過 | 通過 | 折行不誤報 |
| X | `--used` 不寫，`no effect` 改寫在 `--hits` 說明裡 | 失敗 | 失敗 | 不會跨到下一個選項，不是假綠燈 |
| Y | `Accepted for back-compat; has no effect` | 通過 | 失敗 | 單一連字號不再誤報 |
| Y2 | `Kept for back-compat and re-use; has no effect` | 通過 | 失敗 | 多個單一連字號也不誤報 |
| Z | `Accepted for compatibility -- has no effect` | 失敗 | 失敗 | 說明裡出現 `--` 仍會紅燈，這是「遇到下一個選項就停」的代價；失敗訊息會印出 help 行，不是假綠燈 |

  驗完 `git checkout -- src` 並重新 `pnpm run build`，`git status --short` 為空（建立本報告前）。

### README 的 TBD-3、TBD-4 與記帳格式

- TBD-3（`README.md:72`）：狀態 `已解決`，狀態欄寫了日期、使用者原話「照建議」與結論；stale prune 的部分指向 `[issue-40](../issue-40/README.md)`。`\|` 是表格內的跳脫，在 code span 裡會顯示成 `|`，渲染結果是 `([^-]|-[^-])*`，與腳本相同。
- TBD-4（`README.md:73`）：狀態 `不影響本次交付`，以「追蹤：無」開頭，理由具體而且與交付有關（該段在審查後凍結，以本列更正，結論不變）。內容與 review-430907e 的注入表相符：改變寫入的是 A～D，F 由 help 斷言抓到。
- `## 現況`（第 15-17 行）與 `## 待確認事項`（第 66-73 行）沒有 `<`；以粗體開頭的只有 `**現行 review**` 一行，屬允許的例外；沒有以 `[` 開頭的行。
- `**狀態**` 為 `審查中`，與進程相符。
- issue-40 README：概述第一行回連 `../issue-39/README.md#待確認事項`（TBD-3）。三點內容與審查發現一致：
  - 兩半分開記效用，見 `telemetry.ts` 的逐筆歸因。
  - recall 以 `hit.id` 查效用；本報告 N1 的實測再次確認這一點。
  - stale prune 只用 session id，見 review-03683f0 N1 的實測。
  - 它另外把 recall 那一面也納入，範圍比 TBD-3 只寫的 stale prune 寬，合理。

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
|---|---|---|---|
| 既有呼叫帶 `--used` | exit 0，寫入與不帶時相同 | AC-1 斷言、I1 注入 | 有覆蓋 |
| 測試查詢只給 `--score` | 任何記憶的效用都不變 | AC-2 斷言、I2 注入 | 有覆蓋 |
| HTTP／SDK 送 `used` 而不送 `utility_score` | 照舊推算 1 或 0 | 三個不可觸及的檔案沒有 diff、`test-http-api` 通過 | 有覆蓋 |
| help 改寫（折行、連字號、`no effect` 移到別的選項） | 不誤報，也不假綠燈 | 上方 N2 注入表 | 有覆蓋；`--` 寫在說明裡會紅燈，已揭露 |
| agent 依新 skill 把正式回報的 `--hits` 也省略 | 不應發生 | `DEPLOYED_SKILL.md:66` 把「用在工作上」放第一行並寫出帶 `--hits` 的效果 | 措辭可以接受 |

### 需求、架構、安全、品質

- 需求與範圍：13 個異動檔都在 README「涉及檔案」之內；程式只改 `feedback.ts` 的 help 與註解、`types.ts` 的一行註解，寫入語意不變，符合做法 (a)。
- 架構：沒有新的模組或介面；CLI、HTTP、SDK 共用 core 的寫入路徑不變。
- 安全與權限：不適用，沒有新的輸入面、權限或依賴；lockfile 沒有變動。
- 品質：(Q) 段的 helper（`u39`、`q39`、`recall39`）只在本段使用，和其他段的寫法一致，沒有跨段重複或過度設計。CHANGELOG 與雙語文件的描述一致。
- 公開 repo 規則：新增行裡沒有個人絕對路徑，也沒有外部專案的真實名稱。`a267131..3d70567` 七個提交的訊息都是 `type(issue-39): 中文摘要`，沒有 AI 署名或 `Co-Authored-By`。

### 豁免、待確認與限制

- 沒有 Gate 豁免。TBD-1～TBD-4 維持各自的狀態，都沒有未解決、會影響交付的項目。
- core 組 10 支沒有在本 HEAD 全部重跑。`git diff 03683f0 3d70567` 沒有動到 `src/`，只有 issue 文件、`test-cli-memory.sh` 的一行與部署 skill 的一行。受影響的 `test-cli-memory`、`test-bootstrap`、`test-npm-install`，以及 AC-4 指定的 `test-http-api`、`test-utility-ranking`，都已在本 HEAD 重跑。
- N1 的實測用 scratchpad 的隔離資料根，沒有動到版控檔案。
- 給協調者：保存本報告的提交，要把 README `## 現況` 的 `**現行 review**` 改成 `review-3d70567.md`。Timeline 第 85 行寫的是「送增量覆審」，實際是完整審查，可以在同一個記帳提交補一列說明。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
