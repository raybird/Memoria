# Review（第二輪）— issue-20 `repo summarize --merge` 與 sync 共用 sourceRef 解析

- **Reviewed BASE SHA**: `ac7610985fc07c068e284f4dc02b05c53e680576`
- **Reviewed HEAD SHA**: `7a1137b7d2496cbe786ad635045b8bb7560f1bc6`（分支 `issue-20-merge-source-ref`，審查結束時分支仍指向此 SHA）
- **Reviewed patch-id**: `de5037c0597efc3de3df77a611e2387763ac2752`（`git diff ac76109 7a1137b | git patch-id --stable`）
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-20
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-20/review-7a1137b.md`（審查時暫存於本機，以只新增報告的提交持久化）
- **前一輪**: `docs/issues/issue-20/review-bebc5b4.md`（對 `bebc5b4` 判定 PASS）

## 1. 前輪 PASS 對新 HEAD 是否仍有效

依 `7a1137b:docs/agents/review-evidence.md`「本機 artifact 提交後的有效性」：

| 提交 | 與前一提交的差異 | 是否符合「只新增報告」例外 |
| --- | --- | --- |
| `8901450` | `bebc5b4` 的直接後繼、非 merge；`--name-status` 只有 `A docs/issues/issue-20/review-bebc5b4.md`，模式 `100644` | 符合 |
| `7a1137b` | `M docs/issues/issue-20/README.md`、`M src/core/git/summary-pipeline.ts` | **不符合**：修改了其他文件與原始碼 |

因此前輪 PASS 只綁 `bebc5b4`（`8901450` 可沿用），**不涵蓋 `7a1137b`**，本輪重新審查。範圍為完整 `ac76109..7a1137b`。

## 2. 審查範圍與風險

`git diff --stat ac76109 7a1137b`：5 檔，+185／-9。

| 檔案 | 變更 |
| --- | --- |
| `src/core/git/summary-pipeline.ts` | `parseMergeSourceRef` 抽出共用；`summarizeMergeCommit` 以 `git log -1 --format=%B` 讀 message 帶入 sourceRef；`7a1137b` 補兩行註解 |
| `scripts/test-repo-summary.sh` | AC-1／AC-2 兩種執行順序共 6 條斷言（`bebc5b4` 起未變） |
| `scripts/pure-fn-driver.mts` | AC-3 四條字面值斷言（`bebc5b4` 起未變） |
| `docs/issues/issue-20/README.md` | 證據回寫、狀態改「待審查」；`7a1137b` 修 S-1、補 S-2 升級情境、補 N-3 GitNexus 紀錄、Timeline 一列 |
| `docs/issues/issue-20/review-bebc5b4.md` | 前輪報告（`8901450` 新增） |

本輪新增風險面只有兩個：(1) `7a1137b` 對 src 的變更是否真的只有註解；(2) 新增文件內容是否正確、無外部真名或本機絕對路徑。其餘行為面（fingerprint 四個輸入一致、既有 sync fingerprint 不變、白名單、紅燈可重現）在前輪已對 `bebc5b4` 實測，而本輪證明 `bebc5b4` 與 `7a1137b` 的產出 bundle 每個 byte 都相同（E-2），所以沿用。

## 3. `bebc5b4..7a1137b` 差異核對

`git diff bebc5b4 7a1137b -- src scripts` 只有一個 hunk：`summary-pipeline.ts` 的 `parseMergeSourceRef` 上方註解，`-1` 行、`+3` 行，全是 `//` 開頭；函式本體、regex 與其他檔案都沒動。`scripts/` 無差異。

| 前輪項目 | 處理 | 結論 |
| --- | --- | --- |
| S-1 第 3 步重複一行 | 刪掉舊的那條 `3. 📝 **新版發布後移除本機繞道** — …`，保留帶「（相依：…）」的那條；縮排與「完成證據」子項正確 | 已正確處理 |
| S-2 升級情境 | 「風險與首要驗證」段新增「升級情境（審查 S-2）」一段，說明舊 `--merge` 列、升級後再跑 `--merge` 多一筆、不是回歸、最後列數相同 | 已處理，清除方式的措辭有一個前提沒寫清楚，見 S-1（本輪） |
| N-1 regex 刻意不錨定 | 註解寫明「Deliberately unanchored … anchoring it would change sourceRef, and so the fingerprint, of ranges already stored」 | 已正確處理；內容與前輪 E-3 實測一致 |
| N-3 GitNexus 紀錄 | 步驟 2 完成證據新增「GitNexus」一條：impact CRITICAL、已揭露、detect_changes 結果 | 已處理（屬實作者自述的流程留痕，reviewer 無法回溯驗證「已向使用者揭露」，不影響判定）；Timeline 只寫了 S-1、S-2、N-1，見 N-1（本輪） |

升級情境的「列數相同」推論核對：舊版下 `--merge` 建 null 列，下一次 sync 建帶 sourceRef 的列 → 2 列；新版下舊 null 列 + 新 `--merge` 建帶 sourceRef 的列，之後 sync 以相同 fingerprint 命中不新增 → 2 列。與前輪 E-4 實測一致，推論正確。

## 4. 完整範圍核對（`ac76109..7a1137b`）

### 驗收條件（`7a1137b:docs/issues/issue-20/README.md`）

| AC | 可觀察結果 | 證據 | 結果 |
| --- | --- | --- | --- |
| AC-1 | 先 sync 再 `--merge`：`created: 0`、id 等於 sync 那筆、列數不變 | V-3：`✓ --merge after sync creates nothing`、`✓ --merge returns the sync summary`、`✓ no duplicate merge row`；紅燈由前輪 R-1 重現 | 通過 |
| AC-2 | 先 `--merge` 再 sync：sync 不新增 | V-3：`✓ --merge first creates the summary`、`✓ sync after --merge adds no second summary for that merge`；紅燈由前輪 R-2 重現 | 通過 |
| AC-3 | 三種訊息格式解析一致 | V-4：`[pure] parseMergeSourceRef` 4 條 ✓；V-3：`✓ --merge parses source_ref from a GitLab-style message`（前輪 R-3 重現紅燈） | 通過 |

集合與 README 驗收條件完全相等，無豁免項目。待確認事項 TBD-1 已解決。

### project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴 | 符合（`package.json`／lockfile 無差異） |
| 不改 CLI 命令名 | 符合（`src/cli/` 無差異） |
| 非侵入性 | 符合（只多一次白名單內的 `log`；前輪 V-5 noninvasive PASS；本輪 V-3 結尾 `✓ git status clean`） |
| schema 向後相容 | 不適用（未動 schema，fingerprint 公式不變） |
| 版控文件只用代稱 | 符合：README 用 `external-repo`、`<base>`、`<merge sha>`、`<feature-branch>`；前輪報告用 `example.com:org/repo`、`.../scratchpad/...` 等佔位。對 diff 新增行 grep 已知外部專案名與使用者名稱，無命中 |
| 無本機絕對路徑 | 符合：對完整 diff grep `/home/`、`/tmp/`、`/Users/`、Windows 磁碟路徑，無命中（`~/.claude/skills/...` 是 BASE 起就有的家目錄相對寫法） |
| 提交格式／無 AI 署名 | 符合：三個提交皆 `type(scope): 描述`，無任何尾行 |
| GitNexus impact／detect_changes | README 已補紀錄（N-3） |
| 常青文件 | 不適用（無新命令、旗標或測試腳本） |

## 5. 證據（實際命令與結果）

Worktree：`git worktree add --detach <scratchpad>/rv20b bebc5b4` 與 `<scratchpad>/rv20h 7a1137b`，各自 `node_modules` symlink。審查後兩者皆 `worktree remove --force`；主 repo 工作區與分支皆未動，分支仍指向 `7a1137b`。

| # | 命令（於 `7a1137b` worktree，除非另註） | 結果 |
| --- | --- | --- |
| E-1 | `git diff bebc5b4 7a1137b -- src scripts` | 只有註解 hunk（-1／+3，全為 `//` 行） |
| E-2 | 兩個 worktree 各跑 `pnpm run build`，比對 `sha256sum dist/cli.mjs` | 兩者皆 `c7b16af598d3533d…`，bundle byte-identical，證明 `7a1137b` 與 `bebc5b4` 執行期行為相同 |
| V-1 | `pnpm run check` | exit 0 |
| V-2 | `pnpm run build`；`node dist/cli.mjs --help` | build 成功；help exit 0 |
| V-3 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-repo-summary.sh` | exit 0，`[repo-summary] PASS`，41 條 ✓，含 issue-20 的 6 條 |
| V-4 | `bash scripts/test-pure-functions.sh` | exit 0，`[pure] parseMergeSourceRef` 4 條 ✓，`[pure] ok` |
| P-1 | `git diff ac76109 7a1137b \| git patch-id --stable` | `de5037c0597efc3de3df77a611e2387763ac2752` |

沿用前輪對 `bebc5b4` 的證據（因 E-2 bundle 相同，仍有效）：紅燈 R-1～R-3、noninvasive V-5、邊界探測 E-1～E-7（兩種執行順序、內文含 `Merge branch` 的自訂 subject、升級情境、fingerprint 穩定性、remote-tracking 與 CRLF、白名單）。README 記載的 CI 全套 34 支回歸，被測內容為 `ac76109` 加 `bebc5b4` 的提交內容，同樣因 E-2 而適用於 `7a1137b`。

## 6. 發現

### MUST FIX

無。

### SHOULD FIX

- **S-1 升級情境的清除方式少了前提**：README 寫「多出的空 `sourceRef` 那筆以 issue-21 的 `--dismiss` 清除」。但 issue-21 的 `--dismiss` 只改 pending（`7a1137b:docs/issues/issue-21/README.md` SCN-002：對 enriched 摘要 dismiss 要以非 0 結束）。升級情境最常見的形態是「舊版 `--merge` 建列後 agent 已 `--submit`」，那筆 null 列已是 enriched、已促升，dismiss 不了；這時仍 pending、應 dismiss 的是升級後新建、帶 `sourceRef` 的那筆。建議改成「以 issue-21 的 `--dismiss` 清除兩筆中仍為 pending 的那筆（舊列若已 enriched，就 dismiss 新建的那筆）」。只影響文件，不影響程式行為與 AC。

### NICE TO HAVE

- **N-1** Timeline 新列寫「依 S-1、S-2、N-1 修訂」，但 `7a1137b` 也補了 N-3 的 GitNexus 紀錄，可以一併列出，讓 Timeline 與實際修訂一致。
- **N-2**（前輪 N-2，未處理，非本輪要求）`test-repo-noninvasive.sh` 仍未跑 `repo summarize --merge`；新加的 git 呼叫靠 runtime 白名單與 test-repo-summary 的 `git status clean` 守著。屬證據持久力改善。

## 7. 判定

**PASS**：`7a1137b` 不符合「只新增報告」例外，已重新審查完整 `ac76109..7a1137b`。src 變更只有註解，且建出的 bundle 與 `bebc5b4` 每個 byte 都相同，前輪行為面證據沿用有效；本輪在 `7a1137b` 重跑 check、build、test-repo-summary、test-pure-functions 都通過。前輪 S-1、S-2、N-1、N-3 都已處理。AC-1～AC-3 都有可失敗、已確認會紅的斷言，project.md gate 全數符合，版控文件無外部真名與本機絕對路徑。沒有 MUST FIX；S-1（本輪）只是文件措辭，不擋判定。
