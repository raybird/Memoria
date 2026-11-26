# 審查報告
- 範圍：完整交付範圍（main..issue-38-scan-lag-default-branch），以增量覆審完成
- Reviewed BASE SHA：c59a9ec83ff86eb812a511833c2a0483cf549038（main；`git merge-base main 2be3c8d` 相同，與 review-9439f0a.md 的 Reviewed BASE 一致）
- Reviewed HEAD SHA：2be3c8d1cee17efc36d0abcdb283ed1755530187
- Reviewed patch-id：558c52f697992e85c0b819434b4467d79b3b59b0（`git diff c59a9ec 2be3c8d | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（未參與實作），2026-11-26
- 增量覆審：上一份報告 review-9439f0a.md（PASS），增量範圍 `9439f0a..2be3c8d`，中間沒有 merge 提交。27dd97e 只保存報告與記帳，verify-artifact `--reviewed 9439f0a --head 27dd97e` 判 OK。2be3c8d 只處理使用者選了修正的建議（S1，以及順帶的 TBD-1 尖括號），沒有夾帶其他修改，依 review-evidence.md「增量覆審」流程契約 2.8 的規定審查

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
無。

## 已查核維度

### 驗收與證據

逐項確認上一份報告的建議：

| 建議 | 修正位置 | 結論 |
|---|---|---|
| S1：輕量 tag 沒有排序覆蓋，只看 annotated tag 日期的錯誤排序也能通過 | `scripts/test-brief-scope.sh:331-337`：r-b、r-d、r-c 仍為 annotated tag（taggerdate 01-01、01-02、01-04）；r-a 改為輕量 tag，指向用 `commit-tree -p HEAD` 另建、`GIT_COMMITTER_DATE` 與 `GIT_AUTHOR_DATE` 固定為 2026-01-03 的提交，這個提交不在任何分支上。期望順序 r-c、r-a、r-d、r-b 需要用輕量 tag 的提交日期，才能把 r-a 排在兩個 annotated tag 之間。markdown（`:339`）與 `--json`（`:340`）的字面值斷言都沒變 | 已修好 |
| TBD-1 事項欄含尖括號 | `docs/issues/issue-38/README.md:106` 的 `` `repo add <path> --default-branch dev` `` 改成「`repo add` 加 `--default-branch dev`」，意思不變，與同列狀態欄的寫法一致 | 已修好 |

**排序斷言的真偽**：reviewer 暫時改工作樹 `src/core/git/scan-lag.ts:53` 的排序參數，每次都先 `pnpm run build` 再執行 `test-brief-scope.sh`：

| 注入的排序 | 實得順序（`--json`） | 結果 |
|---|---|---|
| `--sort=-taggerdate` | r-c, r-d, r-b, r-a | exit 1，(K/issue-38) 2 項失敗 |
| `--sort=refname` | r-a, r-b, r-c, r-d | exit 1，2 項失敗 |
| `--sort=-refname` | r-d, r-c, r-b, r-a | exit 1，2 項失敗 |
| `--sort=-committerdate` | r-a, r-b, r-c, r-d | exit 1，2 項失敗 |
| `--sort=creatordate`（舊到新） | r-b, r-d, r-a, r-c | exit 1，2 項失敗 |
| 拿掉 `--sort` | r-a, r-b, r-c, r-d | exit 1，2 項失敗 |

上一份報告中唯一能通過的 `-taggerdate` 現在會失敗：輕量 tag 沒有 taggerdate，r-a 被排到最後。實作者說的 `-taggerdate`、`refname`、`-refname` 都會失敗，屬實。這是真斷言。驗完從備份還原，與 `git show HEAD:src/core/git/scan-lag.ts` 逐位元組相同，並重新 build。寫入本報告前，`git status --short` 沒有任何輸出。

reviewer 在 2be3c8d 重跑（前綴 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`，先 `pnpm run build`）：
- `pnpm run check`：exit 0
- `bash scripts/test-brief-scope.sh`：exit 0（`[brief-scope] ✓ all checks passed`）
- `pnpm run release:docs-check`：exit 0（`Release doc sync check passed for v1.39.0`）
- `bash -n scripts/test-brief-scope.sh`：exit 0

增量只動一個測試腳本和 issue README，沒有改 `src/`，其他測試組沒有重跑。

### 相關失敗面

| 輸入／狀態 | 預期 | 實測 | 判定 |
|---|---|---|---|
| 只從 tag r-a 可達、不在任何分支上的提交，在 `:338-340` 產生 brief 時 | 計數範圍是 `refs/heads/main --tags`，這個提交應算進未掃描 commit，tag 斷言不受影響 | brief 狀態行為「未掃描 commit: 1 ｜ 未掃描 tag: r-c, r-a, r-d 等 4 個」（注入測試的失敗訊息可見）。`:339` 以子字串比對 tag 段，多出的 commit 計數不影響斷言 | 正確，符合「預設分支與 tag」的計數規則 |
| `:341` sync 之後，`:343-345`「預設分支不在本機時退回計數為 1」 | sync 以 `--branches --tags HEAD` 掃描，會把 r-a 與它指向的提交記為已觀察；main 改名 trunk 後退回 `--branches --tags HEAD --not 觀察過的 tip`，只有 trunk 上的新提交算進去 | 斷言為 1 並通過。如果另建的提交沒有被當成已觀察的 tip，這裡會得到 2，所以這段仍然有效，也間接確認 sync 涵蓋只從 tag 可達的提交 | 不受影響 |
| `:347-353` 的 k38n（SCN-004） | 另一個 repository，與 k38 的 tag 無關 | 斷言為 2，通過 | 不受影響 |
| 日期穩定性 | 另建提交的作者與提交者日期都固定，annotated tag 的日期由 `GIT_COMMITTER_DATE` 固定，不受執行時間影響 | 四個 tag 都用固定日期，與目前時間無關 | 不會 flaky |

### 需求、架構、安全、品質
- 增量範圍內每個變動檔案的結論：
  - `scripts/test-brief-scope.sh`：只擴充斷言的前置資料。`:331-332` 的註解與實際做法一致。沒有改到其他段落。
  - `docs/issues/issue-38/README.md`：只動記帳區段。在 2be3c8d 新增 TBD-5、改寫 TBD-1，Timeline 加一列；27dd97e 改了 `**現行 review**` 並在 Timeline 加一列。TBD-1 這一列在被審查的提交 2be3c8d 之內，屬於本輪受審內容，不受「審查之後的提交」限制，所以沒有違反記帳規則。
  - `docs/issues/issue-38/review-9439f0a.md`：27dd97e 新增的歷史報告，之後沒有再修改。
- README 格式：`## 現況` 與 `## 待確認事項` 兩節沒有 `<`，以粗體開頭的只有 `**現行 review**`（`README.md:3` 那一行），也沒有以 `[` 開頭的行。TBD-5（`README.md:110`）的狀態欄以 `已解決` 開頭，括號內有日期與使用者原話「好照這樣修」，結論是「選修正」，與使用者的選擇一致。影響欄寫 SCN-003。去掉尖括號之後，TBD-1 不再被 frozen-content 規則凍結。reviewer 在 scratchpad 的 clone 中模擬下一個記帳提交：新增本報告、`**現行 review**` 改成 review-2be3c8d.md、Timeline 補一列，再改 TBD-1 事項欄的一個字。`verify-artifact.py --reviewed 2be3c8d` 判 OK、exit 0，變更區段含「待確認事項」。模擬完已刪除 clone。
- 公開 repo 規則：`git diff 9439f0a 2be3c8d` 與 2be3c8d 的提交訊息裡沒有個人絕對路徑或外部專案真名。README 仍只用「下游」「維護者資料根」等代稱。
- 需求與架構：沒有新增行為，不需要新的 Scenario 或核准。
- 其餘沿用 review-9439f0a.md

### 豁免、待確認與限制
- 沒有 Gate 豁免。
- 限制：本報告沒有提交，也沒有對真正的報告提交跑 verify-artifact，提交後由協調者執行。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
