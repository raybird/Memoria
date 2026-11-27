# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：fec7d1bc6aa1366ee03ea5961ecd45d2b4a6b0db
- Reviewed HEAD SHA：91a8edcbbe5794d67bf0c36212139993488d7fd4
- Reviewed patch-id：21236707de4e1832553b144ae5ea3e7f4b508448
- 獨立 reviewer：Claude Code 隔離 subagent（未參與實作），2026-11-27 第一次審查

## 問題與風險
- MUST FIX：無
- SHOULD FIX：`scripts/test-repo-promotion.sh:295-308`。AC-1 寫的是「對一筆 merge 執行 `repo summarize --submit --json`」，測試注入失敗時用的是 commit_range，JSON 走 HTTP，CLI 只驗人類可讀輸出。merge 寫回還有一條「促升失敗後照樣執行 `dismissCoveredCommitRanges`」的路徑（`src/core/memoria.ts:1453-1460`），目前沒有斷言守住。我用臨時腳本補驗過 merge 加 CLI `--json`（見下方證據），本次驗收仍然成立，這項只關係證據持久力。建議在測試補一筆 merge 的注入失敗，或補一個 CLI `--json` 斷言。
- NICE TO HAVE：`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:101`。完成判準只接受 `promotion: promoted`。同一筆 merge 被重送或被平行寫回時，第二次會得到 `already_promoted`，照字面判準就沒有完成，agent 可能一直重送。建議改成「`promoted` 或 `already_promoted`」。舊判準 `promoted: true` 本來就有同樣缺口，不是這次造成的。
- NICE TO HAVE：`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md:57`、`CHANGELOG.md:14`。這兩處把 `not_eligible` 和「門檻調低後被促升」都寫成只發生在 commit range，但 branch 摘要也走同一個 importance 門檻（`src/core/db/git-promote.ts:39-44`）。建議改成「commit range 或 branch」，或寫「merge、release 以外的摘要」。
- NICE TO HAVE：`src/core/memoria.ts:1221-1229`、`src/core/memoria.ts:1286-1297`。sync 對整段 `promoteEligible` 只包一個 try：任何一筆 `promoteSummary` 拋錯，這次其餘候選全部跳過。清單固定依 `created_at DESC` 排序，所以一筆持續失敗的摘要每次 sync 都會擋住比它舊的那些。這是既有行為，但拿掉 50 筆上限後會被擋住的範圍變大了；警告會寫進 `warnings`。目前想不出會一直失敗的寫入，可以不處理，或改成逐筆 try 並累積警告。
- NICE TO HAVE：`AGENTS.md:237`。HTTP API 表裡 `POST /v1/repos/:ref/summaries/:summaryId` 那一列沒有提到 `promotion`。`docs/agents/project.md` 的常青文件表規定，HTTP 端點契約有變時要同步 `AGENTS.md` 的 HTTP 段。不過之前加 `dismissed_covered` 時也沒寫進那一列，這項屬一致性問題，不是缺漏。
- NICE TO HAVE：`docs/issues/issue-41/README.md:47`。`## 風險與首要驗證` 的「完成證據」還停在「待驗收條件核准後補上。」，實際證據寫在步驟 1。這一節是凍結內容，審查後修改會讓 PASS 失效；要改的話先告知使用者。

## 已查核維度
- 驗收與證據：
  - 驗證範圍：BASE 與 merge-base 都是 `fec7d1b`，HEAD 是 `91a8edc`，patch-id 用 `git diff fec7d1b 91a8edc | git patch-id --stable` 重新計算，結果相同。`fec7d1b..HEAD` 沒有改動 AC 文字，只在 `## 涉及檔案` 補了 SKILL 與 SDK 兩列。Small／Low 不需要 `**核准 commit**`，核准日期與核准來源都齊全。
  - 紅燈重現：以 `fec7d1b` 開暫時 worktree（已移除），程式用 BASE 的 src 並 build 成 dist，測試用 HEAD 的 `test-repo-promotion.sh` 改成斷言失敗不中止的副本，以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash` 執行。結果與 README 步驟 1 一致：
    - 4 個 `promotion` 斷言都得到 `undefined`。
    - 錯誤訊息沒有帶出（`false`），CLI 只印「已寫回摘要」。
    - AC-3 最早那筆在 sync 後仍是 0。
    - 只有 issue-41 的斷言失敗，既有斷言全部通過。
  - 對照組：把填充摘要改成 0 筆和 49 筆，BASE 上的 AC-3 都會通過；50 筆才失敗。可見這個斷言抓的正是 50 筆上限，不是候選來源或其他原因造成的紅燈。
  - HEAD 綠燈：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`node scripts/check-deployed-skill-sync.mjs`、`pnpm run release:docs-check` 都 exit 0。以下 13 支腳本都 exit 0，`test-repo-promotion` 的 issue-41 斷言 14 項全過：
    - repo 組 8 支：`test-repo-git-exec`、`test-repo-registry`、`test-repo-sync`、`test-repo-events`、`test-repo-summary`、`test-repo-promotion`、`test-repo-edge`、`test-repo-noninvasive`
    - http-mcp 組 5 支：`test-memory-browser`、`test-ui-http`、`test-http-api`、`test-mcp-e2e`、`test-vector-recall`
  - 沒重跑的部分：core、adapters 兩組和 `test-npm-install` 我沒有重跑，沿用 README 步驟 4 的紀錄。這兩組不碰本次改動的程式路徑；部署 SKILL 的同步已由 `check-deployed-skill-sync` 確認。
  - AC-1 補驗：用臨時腳本以 HEAD 的 dist 跑 merge 加 CLI `--json`，促升失敗用 trigger 注入。結果：
    - 第一次寫回：`ok:true`、`status:enriched`、`promoted:false`、`promotion:failed`、`promotion_error:"injected"`，沒有留下 `gitsum-` session，表示交易已回滾。
    - 移除 trigger 後重送：人類可讀輸出印「已進入 recall」。
    - 第三次重送：`already_promoted`、`promoted:false`，而且沒有 `promotion_error` 欄位。
  - 既有斷言：HEAD 相對 BASE 的測試只新增斷言，沒有改任何既有斷言的期望值，符合 AC-4 的失敗路徑。
- 相關失敗面：
  - 判定順序：先查 `promotionExists` 才查 `isPromotable`。已促升過的摘要即使重送時 importance 調低，也會報 `already_promoted`，和 recall 的實際狀態一致；這種情況下 recall 內容不會更新，屬 issue-42 的範圍，CLI 也有說明。`promoted` 布林值和舊版等價：舊版只在「有 range、可促升、尚未促升、而且這次寫入成功」時為 true。
  - `promoteSummary` 回 `promoted:false` 的情形：session 已存在但 `memory_sources` 沒有對應列時會這樣回，程式記為 `already_promoted`。可以走到這個狀態的情境是 `repo remove --delete-memories` 沒有同時刪摘要：`src/core/db/git-repo.ts:388-394` 會刪 events 與 `memory_sources`，但不刪 sessions。這時摘要的 session 仍在 FTS，「已在 recall」的說法成立，但 `hit.source` 已經不在。影響只有兩點：sync 每次會多一次空的寫入嘗試、不會重複促升，寫回時報 `already_promoted`。這個 repository 已是 disabled，可以接受。
  - 交易回滾：促升在同一個交易裡（`git-promote.ts:67`），所以 trigger 的 ABORT 會連 session 一起回滾，重送與 sync 都能重新促升，臨時腳本也確認沒有殘留 session。
  - 載入設定失敗：`loadMemoriaConfig` 失敗會被 catch 記為 `failed` 並帶出原因。這不算促升寫入本身失敗，重送也不會好，但原因看得到，比舊版吞掉錯誤好。
  - `summary.range` 為 null：記為 `not_eligible`。`getSummaryById` 以 FK 取 range，只有 range 列被刪才會走到這裡，而刪 range 的 `repo remove --delete-summaries` 會一起刪摘要，所以實務上走不到，標成 `not_eligible` 不會誤導。
  - dismissed 摘要：`submitAgentSummary` 一律把狀態寫成 enriched（`git-summary.ts:404`），所以 dismissed 摘要寫回後會照 enriched 的規則判定，和架構文件「之後的 `--submit` 仍會改成 enriched」一致。sync 的補救清單只列 enriched，不會碰 dismissed 摘要。
  - `listSummaries`：另一個呼叫端是 pending 列表（`memoria.ts:1379`），沒有傳 `unpromoted`，預設上限仍是 100，SQL 只多一段空字串，行為不變。force 路徑（`repo summarize --promote`）不會進 `!force` 區塊，也不受影響。`LIMIT -1` 在 SQLite 代表不設上限。
  - 查詢成本：用唯讀方式查本機資料根（`sqlite3 -readonly`），共 808 筆摘要、2441 列 `memory_sources`，其中已增強但未促升的有 49 筆，全部是 commit_range，以 0.7 門檻判定沒有一筆可促升；含 JOIN 與 NOT EXISTS 的清單查詢約 20 毫秒。`memory_sources.source_id` 沒有索引，但同檔已有三處用同樣的 NOT EXISTS，成本隨摘要數乘以 `memory_sources` 列數成長，以目前規模可以忽略。不符資格的摘要在 `isPromotable` 就會跳過，不會多開 DB 連線。
  - 升級影響：CHANGELOG 已寫明「升級後第一次 sync 可能促升較早的摘要」，也點出門檻調低的情形。本機的分布是：門檻降到 0.5 會有 4 筆進入 recall，降到 0.3 會有 45 筆。我另外查了其他可能讓舊資料一次大量進入 recall 的情況，沒有找到：
    - prune 不刪 `memory_sources`，stale prune 刪掉 session 後，`memory_sources` 仍在，摘要不會被當成「未促升」而重新促升。
    - 唯一寫入 enriched 的是 agent 寫回。
    - 門檻調高不會造成影響。
  - 注入方式（AC-1）：trigger 只擋 `memory_sources` 的 INSERT。trigger 存在期間只寫回 commit_range（不會觸發 dismissCovered，HTTP 一次、CLI 一次），sync 前就移除 trigger，所以不影響 dismiss 或其他斷言。
  - 50 筆填充摘要（AC-3）：它們和失敗那筆共用同一個 `summary_range_id`，以 prompt_version 區隔，狀態是 enriched、importance 0.1、內容都是空陣列，結束時刪掉。可能受影響的路徑都只看 pending 或只看 merge／release，不會把它們算進去：
    - pending 列表與 `listPendingCommitRanges` 只看 pending。
    - `listEnrichedMilestoneRanges` 只看 merge、release。
    - brief 的待增強計數只算 pending。
    - pipeline 以「range 加目前的 prompt_version」找既有摘要，不會和填充摘要衝突。
  - 填充摘要的 `created_at` 設在未來時間：用來確保它們排在最新的 50 筆。「沒有其他摘要被促升」的斷言以 sync 前的總數為基準，判準和失敗模式相交，不是同義反覆。
- 需求、架構、安全、品質（含跨 Task 重複與過度設計）：
  - 架構：業務邏輯都在 core；HTTP（`src/server.ts:515-520`）直接回傳 core 的結果，不必改；SDK 與 core 共用 `SubmitSummaryData`，型別一致。
  - 文件一致性：CLI 依四種結果各印一行，失敗時附原因；CLI、API 的中英文文件與部署的 REFERENCE 都寫明四個值，部署 SKILL 同步檢查通過。
  - 公開 repo 規範：diff 裡沒有個人絕對路徑或外部專案真名（外部專案用代稱 downstream-b）。
  - 部署 SKILL 的寫法：`docs/AGENTS.md` 與 project.md 沒有專門規範部署 SKILL 的文字，這次改動以正面表述、可觀察的完成判準書寫。
  - 重複與過度設計：用 `listSummaries` 加選項，不另寫查詢函式；四種結果只在 core 判定一次，CLI、HTTP、SDK 只是轉述。沒有發現跨檔重複或過度設計。
  - 安全：`promotion_error` 只帶例外訊息，不含堆疊或路徑；寫回本來就需要能存取本機服務。
- 豁免、待確認與限制：
  - 豁免與待確認：沒有 Gate 豁免。TBD-1、TBD-2 已解決，TBD-3 標為「不影響本次交付」並寫了理由。
  - 測試限制：只注入一種寫入失敗，但程式用一個 catch 處理所有例外，沒有只認特定錯誤碼。
  - 臨時腳本：merge 加 CLI `--json` 的補驗腳本放在 session 暫存區，沒有進 repo。
  - 收尾狀態：審查結束時已在 HEAD 重新 build，工作樹乾淨，暫時 worktree 已移除。
  - 記帳提醒：README 目前沒有 `## 現況` 與 `**現行 review**`。依流程契約 2.8，保存本報告的提交要建立 `## 現況`（放在 `## 概述` 之後）並寫入本報告檔名；這屬協調者記帳，不是本次發現。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
