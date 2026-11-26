# 審查報告
- 範圍：完整交付範圍（main..issue-38-scan-lag-default-branch），以增量覆審完成
- Reviewed BASE SHA：c59a9ec83ff86eb812a511833c2a0483cf549038（main；`git merge-base main 9439f0a` 相同，與 review-2cca66c.md 的 Reviewed BASE 一致）
- Reviewed HEAD SHA：9439f0a92c26eeb686c2e41fb056b8ac9201a620
- Reviewed patch-id：935ef037b8f866b17536bd464e344024ef5a205e（`git diff c59a9ec 9439f0a | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（未參與實作），2026-11-26
- 增量覆審：上一份報告 review-2cca66c.md（PASS），增量範圍 `2cca66c..9439f0a`。3b5fcec 只保存報告與記帳；9439f0a 只處理使用者選了修正的建議（S1、S2 做法 B、N2、N5），沒有夾帶其他修改，依 review-evidence.md「增量覆審」流程契約 2.8 的規定審查

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
1. **輕量 tag 不再有測試覆蓋，文件新寫的「輕量 tag 用提交日期」也沒有斷言。** 增量把 `scripts/test-brief-scope.sh:332-334` 原本的 4 個輕量 tag（`git tag "$t"`）換成 4 個 annotated tag（`tag -a`）。目前所有測試腳本建立的 tag 都是 annotated，所以 review-2cca66c.md 相關失敗面的結論「annotated／輕量 tag 都會列出，測試兩種都有」在新 HEAD 不再成立。reviewer 把排序改成 `--sort=-taggerdate`（只看 annotated tag 的日期，輕量 tag 的 taggerdate 是空的）再 build，`test-brief-scope.sh` 仍 exit 0，也就是 `docs/CLI.md:68`、`docs/API.md:92-93`、兩份 zh-TW 的「輕量 tag 用提交日期」寫錯也不會被抓到。行為本身正確，reviewer 手動實測（見下方相關失敗面），所以不阻擋。建議把 4 個 tag 之一改成輕量 tag，指向一個用 `GIT_COMMITTER_DATE` 固定日期建立的提交，讓它落在日期順序中間；後面本來就會 sync，多出的提交不影響之後的 trunk 斷言。

### NICE TO HAVE
無。

## 已查核維度

### 驗收與證據

逐項確認上一份報告使用者選了修正的建議：

| 建議 | 修正位置 | 結論 |
|---|---|---|
| S1：英文退回條件寫成「not checked out locally」 | `docs/CLI.md:68`、`CHANGELOG.md:13` 改為「when there is no local branch by that name」。符合程式的 `refs/heads/<分支>` 精確比對（`src/core/git/scan-lag.ts:31-34`、`:48-50`）。`grep -rn 'checked out locally'` 在常青文件與程式中已沒有結果，只剩歷史報告與 TBD-2 的引述 | 已修好 |
| S2 做法 B：doctor 只看提交數 | `docs/OPERATIONS.md:467` 新增「`doctor`'s `repo scan` counts commits only, so a repository whose only unscanned change is a tag reads as up to date there; the brief is where unscanned tags are named」。對照 `src/cli/commands/doctor.ts:139-149`（只用 `unscanned_commits` 判斷落後），敘述成立；doctor 程式沒有改動。OPERATIONS 沒有 zh-TW 版本，不需要雙語同步 | 已修好 |
| N2：寫明排序依據並補斷言 | 文件：`docs/CLI.md:68`、`docs/CLI.zh-TW.md:68`、`docs/API.md:92-93`、`docs/API.zh-TW.md:86` 都寫「依 tag 日期，輕量 tag 用提交日期」，雙語一致；`CHANGELOG.md:10` 寫「newest first by tag date」；`src/core/git/scan-lag.ts:23-24`、`src/core/types.ts:529` 只改註解。斷言：`scripts/test-brief-scope.sh:332-337` 的 4 個 tag 日期順序 r-c、r-a、r-d、r-b 與名稱順序錯開，markdown 與 `--json` 都用字面值比對完整順序 | 已修好，輕量 tag 的部分見 SHOULD FIX 1 |
| N5：檔頭段落清單 | `scripts/test-brief-scope.sh:15` 補上 `(K/issue-38)` | 已修好 |

**排序斷言的真偽**：reviewer 暫時改工作樹的 `src/core/git/scan-lag.ts:53` 再 `pnpm run build`，每種寫法都執行 `test-brief-scope.sh`：

| 注入的排序 | 實得順序 | 結果 |
|---|---|---|
| `--sort=refname` | r-a, r-b, r-c, r-d | exit 1，(K/issue-38) 2 項失敗 |
| `--sort=-refname` | r-d, r-c, r-b, r-a | exit 1，2 項失敗 |
| `--sort=creatordate`（舊到新） | r-b, r-d, r-a, r-c | exit 1，2 項失敗 |
| 拿掉 `--sort` | r-a, r-b, r-c, r-d | exit 1，2 項失敗 |
| `--sort=-committerdate` | r-a, r-b, r-c, r-d | exit 1，2 項失敗 |
| `--sort=-taggerdate` | 與正確順序相同 | exit 0（只有 annotated tag，見 SHOULD FIX 1） |

實作者說的「改成 `refname` 或 `-refname` 都會失敗」成立，是真斷言。驗完以先前備份的檔案還原（與 `git show HEAD:src/core/git/scan-lag.ts` 逐位元組相同），重新 build，`git status --short` 在寫入本報告前沒有任何輸出。

reviewer 在 9439f0a 重跑（前綴 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`，先 `pnpm run build`）：
- `pnpm run check`：exit 0
- `bash scripts/test-brief-scope.sh`：exit 0（`[brief-scope] ✓ all checks passed`）
- `pnpm run release:docs-check`：exit 0（`Release doc sync check passed for v1.39.0`）
- `bash -n scripts/test-brief-scope.sh`：exit 0

其他測試沒有重跑：增量裡的 `src/` 只改兩段註解，行為沒變；測試只動了 `test-brief-scope.sh`。上一份報告跑過的 core、http-mcp、repo 三組結論沿用。

### 相關失敗面

| 輸入／狀態 | 預期 | 實測 | 判定 |
|---|---|---|---|
| annotated 與輕量 tag 混合（ann-apr 2026-04、輕量 light-mar 指向 2026-03 的提交、ann-feb 2026-02、輕量 light-old 指向 2026-01 的提交），在 9439f0a 的建置與暫存資料根執行 | 依 tag 日期排序，輕量 tag 用提交日期 | `brief --json` 為 `["ann-apr","light-mar","ann-feb","light-old"]`；sync 後 `[0,[]]`，輕量 tag 照常清除 | 正確，與文件一致；目前沒有自動化覆蓋（SHOULD FIX 1） |
| 只有未掃描 tag 時的 doctor | 依做法 B，doctor 寫 up to date，文件說明由 brief 點名 | doctor 程式沒有改動，`repoScanCheck` 只看提交數，與 OPERATIONS 的新敘述一致 | 正確 |

### 需求、架構、安全、品質
- 增量範圍內每個變動檔案的結論：`CHANGELOG.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`docs/OPERATIONS.md`：措辭修正，與程式一致，雙語一致。`src/core/git/scan-lag.ts`、`src/core/types.ts`：只改註解，`pnpm run check` 通過。`scripts/test-brief-scope.sh`：斷言更嚴格，`gc38` 的提交者身分與 `GIT_COMMITTER_DATE` 只作用在 tag 指令上，不影響後面的斷言（後面照常 sync，trunk 的計數斷言仍是 1）。`docs/issues/issue-38/README.md`：只動記帳區段（TBD-2～4、Timeline）。`docs/issues/issue-38/review-2cca66c.md`：新增的歷史報告，在 3b5fcec 之後沒有再修改。
- 需求與架構：沒有新增行為；S2 依使用者選擇只改文件，不需要新的 Scenario 或核准。
- 公開 repo 規則：`git diff 2cca66c 9439f0a` 與兩個提交訊息裡沒有個人絕對路徑或外部專案真名；README 仍只寫「下游」與「維護者資料根」。
- README 待確認事項 TBD-2～4：狀態值分別以 `已解決`、`不影響本次交付`、`已解決` 開頭，括號裡有日期與使用者原話，結論與理由寫在狀態欄。TBD-3 寫「追蹤：無」，接著寫具體、與交付範圍相關的理由（發版流程不移動已發布的 tag，移動後的新提交仍算進未掃描 commit）。內容與使用者的選擇一致：S1、S2（做法 B）、N2、N5 修正，N1 記入待確認，N3、N4 不修。`## 現況` 與 `## 待確認事項` 兩節裡，TBD-2～4 與 Timeline 新增的列都沒有 `<`，也沒有以粗體或 `[` 開頭的行（`**現行 review**` 除外）。
- 其餘沿用 review-2cca66c.md

### 豁免、待確認與限制
- 沒有 Gate 豁免。
- TBD-1 的事項欄有 `` `repo add <path> --default-branch dev` ``，含 `<`。這一列在 fec4368 就已存在，不在本次增量內，所以不另提建議。依 frozen-content.md，這只會凍結 TBD-1 這一列和表頭、分隔列，其他列仍可直接補列。reviewer 在 scratchpad 的 clone 中模擬下一個記帳提交（新增本報告、`**現行 review**` 改成 review-9439f0a.md、狀態改值、補一列 TBD 與一列 Timeline），`verify-artifact.py --reviewed 9439f0a` 判 OK、exit 0，模擬完已刪除 clone。實際的 verify-artifact 仍要在報告提交後由協調者執行。
- 限制：本報告沒有提交，也沒有對真正的報告提交跑 verify-artifact。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
