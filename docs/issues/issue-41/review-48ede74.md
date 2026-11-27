# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：fec7d1bc6aa1366ee03ea5961ecd45d2b4a6b0db
- Reviewed HEAD SHA：48ede7435b70baba04d754450f1302b1aa806b3f
- Reviewed patch-id：0113c10c7bde6b4559d1d905fd7555cffdf41c04
- 獨立 reviewer：Claude Code 隔離 subagent（未參與實作），2026-11-27 增量覆審
- 增量覆審：上一份報告 review-91a8edc.md，增量範圍 `91a8edc..48ede74`（處理 PASS 建議後的增量覆審）

## 問題與風險
- MUST FIX：無
- SHOULD FIX：無
- NICE TO HAVE：`docs/issues/issue-41/README.md:67`。步驟 4 的完成證據仍寫「部署的 SKILL 完成判準改為 `promotion: promoted`」，N1 修正後實際內容是「`promoted` 或 `already_promoted`」（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:101`）。README 也沒有記下這次增量的驗證：N3 斷言在 `91a8edc` 上的紅燈，以及重跑了哪些腳本。TBD-4 已經寫明改了什麼，這項只影響證據的完整度，不會讓 verify-artifact、dev-cycle 或懸置掃描判斷錯誤。建議在步驟 4 或 TBD-4 補一句增量的驗證紀錄，並改正那句 SKILL 判準。README 不屬於記帳區段，修改前要先告知使用者。

## 已查核維度
- 驗收與證據：
  - 範圍重算：HEAD 是 `48ede74`，`git merge-base HEAD main` 仍是 `fec7d1b`。`git diff fec7d1b..HEAD | git patch-id --stable` 的結果是 `0113c10c…`，與交付的 patch-id 相同。增量 `91a8edc..48ede74` 有 8 個檔案，每個檔案的結論如下：
    - `src/core/memoria.ts`：N3 已處理到位，詳見下一節。
    - `scripts/test-repo-promotion.sh`：S1、N3 已處理到位，詳見下文。
    - `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:101`：N1 已處理到位，完成判準接受 `promoted` 或 `already_promoted`。
    - `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md:57`、`CHANGELOG.md:14`：N2 已處理到位，兩處都寫成「commit range 或 branch」。
    - `CHANGELOG.md:11`：Fixed 段補了逐筆處理與警告格式 `memory_promotion_failed: <summary id>: <error>`，與程式 `src/core/memoria.ts:1299` 一致。
    - `AGENTS.md:237`：N4 已處理到位，寫回端點列出 `promotion` 的四個值與 `promotion_error`。
    - `docs/issues/issue-41/README.md`：N5 已處理到位，`:52` 指向步驟 1 的紅燈。新增 `## 現況` 與 TBD-4，並在涉及檔案補上 `AGENTS.md`。TBD-4 的狀態是「已解決」，內容與 diff 相符。
    - `docs/issues/issue-41/review-91a8edc.md`：保存上一份報告的記帳提交（`2041ffc`）。
  - 增量覆審條件：H1 `91a8edc` 是 HEAD 的祖先，之後沒有改寫歷史，merge-base 沒變。增量只處理使用者選了修正的 S1、N1～N5，另有記帳提交，沒有夾帶其他修改，符合 review-evidence.md「增量覆審」第四段的條件。
  - HEAD 綠燈：以下命令都 exit 0：
    - 靜態檢查與文件：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`node scripts/check-deployed-skill-sync.mjs`（`ok version=1.40.2`）、`pnpm run release:docs-check`。
    - 測試腳本：以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/<name>.sh` 執行 repo 組 8 支、http-mcp 組 5 支，以及 `test-smoke`。
    - `test-repo-promotion` 的 issue-41 段共 22 項斷言全部通過。
  - 新斷言能抓到錯誤（S1、N3）。做法：在 `91a8edc` 開暫時 worktree，node_modules 以 symlink 共用，用 HEAD 的 `test-repo-promotion.sh` 改成斷言失敗時累計、不中止的副本。驗證完已移除 worktree。結果如下：
    - 程式用 `91a8edc` 的 src build 時，3 項斷言失敗：
      - `AC-3: sync promotes the summary that failed, beyond the latest 50` 得 0。
      - `N3: sync warns about the failure, naming the summary` 得 false，因為舊程式的警告只有錯誤訊息，不含摘要 id。
      - `AC-3: the merge whose write-back failed is promoted too` 得 0。
    - 其餘斷言全過。這證實實作者的說法：在舊程式上，AC-3 那筆沒有被促升。
    - S1 變異測試：把 HEAD 的 `repoSubmitSummary` 改成促升失敗時不執行 `dismissCoveredCommitRanges`（條件加上 `promotion !== 'failed'`）。`AC-1 merge: covered range still dismissed` 得 0，`AC-1 merge: the covered range is dismissed` 得 `pending`，兩項失敗，表示 S1 要守的路徑確實有斷言守住。
    - `N3: once the failure clears, the next sync promotes it` 在舊程式上也會通過。它是回歸防護，用來辨別新舊程式的是前一點的 3 項斷言，這樣分工合理。
  - 既有斷言：增量只改了 `AC-3: nothing else promoted` 的排除清單，加入 `STUCK_ID`、`M_ID`，並把 `a second sync` 改名為 `a further sync`。兩者都是 `91a8edc` 才加的 issue-41 斷言，issue-41 之前就有的斷言沒有改值，AC-4 的失敗路徑不成立。
- 相關失敗面：
  - N3 的分工（`src/core/memoria.ts:1270-1307`）：
    - sync（`:1223-1226`）傳入 `warnings`。任一筆 `promoteSummary` 拋錯時，記下含摘要 id 的警告後處理下一筆；這筆的交易已回滾，下一次 sync 會再試。
    - `repo summarize --promote`（`:1368-1371`）不傳 `warnings`，照舊拋錯，整個結果是 `ok:false`。這是使用者明確點名的一小組摘要，錯誤直接回報比混在警告裡更顯眼；前面已促升的各自在獨立交易裡、不會回滾，這和改動前相同，所以合理。
  - 外層 try/catch（`:1222-1229`）仍有作用：`listSummaries`（`:1283`）、不在逐筆 try 內的 `promotionExists`（`:1290`），以及 `isPromotable` 之類的例外，都還是由它接住。這些失敗會讓整段促升中止，警告不含摘要 id。
    - `listSummaries` 是一次性查詢，失敗時本來就沒有可逐筆處理的清單。
    - `promotionExists` 是唯讀查詢，失敗通常代表整個 DB 有問題（開不了檔或被鎖），不是單筆資料造成的，下一筆多半也會失敗。
    - 兩者都不會留下半寫入的資料，下一次 sync 會重試，所以可以接受。`indexPromotedSession` 自己會吞掉錯誤，不影響這段的流程。
  - 「寫回時促升失敗的 merge，下一次 sync 補上」（`scripts/test-repo-promotion.sh:354`）：merge 在 enriched 時一律可促升（`src/core/db/git-promote.ts:39-41`），trigger 移除後 `M_ID` 不受 `t41_stuck` 影響，sync 應該把它促升為 `gitsum-<id>`。這和 AC-3「sync 補做所有漏掉的促升」相符，斷言的 `memory_id = 'gitsum-$M_ID'` 也和 `promoteSummary` 的 session id 規則一致。它在 `91a8edc` 上失敗，是因為依 `created_at DESC` 排序時 `STUCK_ID` 排在 `M_ID` 之前，舊程式在 `STUCK_ID` 拋錯後整段中止，所以這項斷言也在驗證「失敗後繼續」。
  - 斷言靠排序才能區分新舊程式：`:338-340` 的註解寫明 `STUCK_ID` 比 `FAIL_ID` 晚建立，所以會先被嘗試；這個前提已由上面的紅燈證實。三筆摘要中間隔著多次 CLI 與 HTTP 呼叫，`created_at` 精確到毫秒，不會同時。
  - 注入範圍：`t41_stuck` 只擋 `source_id = STUCK_ID` 的 `memory_sources` INSERT。`AC-3: nothing else promoted` 以 sync 前的總數為基準，排除三筆預期會變的摘要，HEAD 上通過，表示沒有其他摘要被意外促升。
  - 警告格式的消費端：`grep memory_promotion_failed` 在 scripts 與 docs 中只出現在本測試，沒有程式依賴舊的「無 id」格式。CLI 的 `repo sync` 會逐行印出 `warnings`（`src/cli/commands/repo.ts:105`）。
- 需求、架構、安全、品質：
  - 架構：逐筆處理仍在 core，用一個可選參數區分兩種呼叫端，沒有新增函式，也沒有改公開 API。
  - 安全：警告只含摘要 id 與例外訊息。
  - 公開 repo 規範：在 `git diff fec7d1b..HEAD` 新增的行中搜尋家目錄路徑、使用者名稱與已知外部專案名稱，沒有找到。
- 本輪重新查核的項目與理由：
  - `promoteEligible` 的兩個呼叫端（sync、`--promote`）：函式簽名與錯誤處理變了。
  - submit 的 dismiss 路徑：S1 新增了斷言。
  - 部署 SKILL 同步與文件檢查：SKILL、REFERENCE 有改動。
  - repo 組與 http-mcp 組：sync 主路徑有改動，因此重跑。
  - 其餘沿用 review-91a8edc.md：寫回四種結果的判定、`listSummaries` 的 `unpromoted` 查詢、查詢成本、升級影響、填充摘要的設計。這次增量都沒有碰到這些部分。core、adapters 兩組與 `test-npm-install` 沒有重跑：增量只改了部署 SKILL 的一行文字，同步檢查已通過，其餘程式路徑不受影響。
- 豁免、待確認與限制（只寫本輪新增的）：
  - 豁免：沒有 Gate 豁免。TBD-4 已解決。
  - 收尾狀態：暫時 worktree 已移除；審查結束時已在 HEAD 重新執行 `pnpm run build`，工作樹除了本報告以外沒有變更。
  - 記帳提醒：README `## 現況` 的 `**現行 review**` 仍是 review-91a8edc.md。保存本報告的提交要改成 review-48ede74.md，這屬協調者記帳，不是本次發現。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
