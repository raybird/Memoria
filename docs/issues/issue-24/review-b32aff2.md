# Review — issue-24（第二輪）：N-3 決策紀錄提交後的完整範圍重審

- **Reviewed BASE SHA**: `f7312d81bda30cdeb268b75d86ad90dfa50ac313`（`git merge-base main issue-24-release-npm-poll`，等於 `main` 目前位置）
- **Reviewed HEAD SHA**: `b32aff2f9d40117949dab29f4904f17d3f526139`（分支 `issue-24-release-npm-poll` 的 tip，審查結束時仍指向此 SHA）
- **Reviewed patch-id**: `40c47833d128442877ba2b2f7354f697deb07696`（`git diff f7312d8 b32aff2 | git patch-id --stable`）
- **TARGET**: `main`
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作，也未撰寫 b32aff2 的決策紀錄）
- **審查日期**: 2026-10-21
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-24/review-b32aff2.md`（尚未提交）

## 為什麼要重審

第一輪報告 `review-e522fd9.md`（PASS，綁定 `e522fd9`）由 `6599e6f` 單獨新增，符合 review-evidence.md「本機 artifact 提交後的有效性」的報告提交例外。之後的 `b32aff2` 修改了 issue README（記錄 N-3 的決策），不是只新增報告的提交，所以例外不再適用，需要以完整範圍 `BASE..b32aff2` 重新審查。

## 審查範圍與風險

`BASE..HEAD` 共四個提交，5 檔，+273／-4：

| 提交 | 內容 |
| --- | --- |
| `52f078d` | 建立 issue 文件（AC 核准） |
| `e522fd9` | 實作：`scripts/release.sh`、`RELEASE.md`、`docs/HANDOVER.md`，README 回寫證據（第一輪審查對象） |
| `6599e6f` | 只新增第一輪報告 `review-e522fd9.md` |
| `b32aff2` | README 新增 TBD-2 與一列 Timeline（本輪新增內容） |

本輪的實質新增只有 `b32aff2` 的兩行文件。風險面：(1) `e522fd9` 之後是否有任何程式、設定或常青文件被改動，使第一輪證據失效；(2) 決策紀錄是否忠於第一輪 N-3 的選項與建議；(3) 決策理由（`release.yml` 的 `npm publish` 沒有 `--tag`）是否屬實；(4) 公開 repo gate 與狀態欄的誠實性。

## 證據（實際命令與結果）

本輪只讀，沒有建立 worktree、沒有重跑 harness、沒有 push／tag／publish。主工作區只有原本就有的 `.serena/project.yml` 修改，未觸碰。

| # | 命令 | 結果 |
| --- | --- | --- |
| R-1 | `git rev-parse issue-24-release-npm-poll HEAD`；`git merge-base main issue-24-release-npm-poll` | 兩者都是 `b32aff2f9d40117949dab29f4904f17d3f526139`；merge-base `f7312d81bda30cdeb268b75d86ad90dfa50ac313` |
| R-2 | `git diff f7312d8 b32aff2 \| git patch-id --stable` | `40c47833d128442877ba2b2f7354f697deb07696` |
| R-3 | `git log --oneline f7312d8..b32aff2`；`git show -s --format=%P b32aff2` | 四個提交如上表，皆非 merge；`b32aff2` 的父提交是 `6599e6f`，`6599e6f` 的父提交是 `e522fd9` |
| R-4 | `git diff e522fd9 b32aff2 --name-status` | 只有 `M docs/issues/issue-24/README.md`、`A docs/issues/issue-24/review-e522fd9.md` |
| R-5 | `git diff e522fd9 b32aff2 -- . ':!docs/issues/issue-24' \| wc -c` | `0`：`scripts/release.sh`、`RELEASE.md`、`docs/HANDOVER.md`、`.github/`、`package.json` 等在 HEAD 與第一輪審查的 `e522fd9` byte-identical |
| R-6 | `git ls-tree b32aff2 docs/issues/issue-24/` | 兩個檔案皆為 `100644` 一般檔案 |
| R-7 | `git show b32aff2` | README 只增加兩行（TBD-2 一列、Timeline 一列），沒有刪改既有內容 |
| R-8 | `sed -n 195,225p .github/workflows/release.yml`；`grep -n 'npm publish\|tag\|dist-tag'` | `Publish to npm` 是 `npm publish --provenance --access public`，沒有 `--tag`；檔內其他 `tag` 字樣只在觸發條件與 tag／版本一致性檢查 |
| R-9 | `git show b32aff2:package.json \| grep -A5 publishConfig`；搜尋版控內的 `.npmrc`；`grep NPM_CONFIG\|npm_config release.yml` | `publishConfig` 只有 `access`、`provenance`，沒有 `tag`；沒有 `.npmrc`；workflow 沒有設定 `npm_config_tag`。publish 的 dist-tag 沒有被任何地方覆寫，會用 npm 預設的 `latest` |
| R-10 | `git diff e522fd9 b32aff2 -- docs/issues/issue-24/README.md \| grep '^+' \| grep -nE '/home\|/Users\|<本機使用者名>\|\.memoria\|<外部專案名>'` | 沒有結果（exit 1） |
| R-11 | `git log --format='%H%n%B' e522fd9..b32aff2 \| grep -inE 'co-authored\|claude\|anthropic'` | 沒有結果（exit 1） |

**沿用第一輪證據**：R-5 證明程式與常青文件自 `e522fd9` 起沒有任何位元組變動，第一輪的 V-1～V-23（`pnpm run check`、build、`bash -n`、`release:docs-check`、harness 的 AC-1／AC-2／立即可用三情境、修正前紅燈、順序與查詢變異、真實 registry 唯讀查詢、GitNexus 等）對 HEAD 仍然成立，本輪不重跑。harness 原文仍在 README（`b32aff2` 未改動該段）。

## 驗收對照（HEAD `b32aff2`）

| AC | 證據 | 結論 |
| --- | --- | --- |
| AC-1 | 第一輪 V-5、V-7、V-9、V-10、V-11、V-12（`e522fd9`）；R-5 證明被測檔案在 HEAD 未變 | 通過 |
| AC-2 | 第一輪 V-6、V-8、V-9（`e522fd9`）；R-5 同上 | 通過 |

## 決策紀錄核對（b32aff2）

| 項目 | 第一輪報告 N-3 | README TBD-2／Timeline | 結論 |
| --- | --- | --- | --- |
| 待決問題 | 改成帶版本查詢後不再驗證 `latest` 已指向新版，是否接受此殘餘風險 | 「改用帶版本的查詢後，不再驗證 npm 的 `latest` 是否指向新版」 | 一致 |
| 選項 (a)／(A) | 照現狀接受 | 「(A) 照現狀接受」 | 一致 |
| 選項 (b)／(B) | 輪詢成功後再查一次 `npm view @raybird.chen/memoria version`，不一致時只印警告、不 die | 「(B) 輪詢成功後再查一次 `latest`，不一致只印警告」 | 一致；不帶版本的 `npm view` 查的就是 `latest`，省略「不 die」不改變意思 |
| reviewer 建議 | 建議 (a)，有需要時再做 (b) | 採 (A)；「之後若改用 `--tag` 發 prerelease，再補這項檢查」 | 一致，後半句對應「有需要時再做 (b)」，並具體化觸發條件 |
| 決策來源 | — | 「2026-10-21 使用者回覆『照建議』」 | 與協調者轉述的使用者答覆相符；格式與 TBD-1 一致 |
| 理由 | 報告 V-18：release.yml 沒有 `--tag`，`latest` 會照預設移動 | 「`release.yml` 的 `npm publish` 沒有帶 `--tag`，`latest` 依預設必定移到新版」 | 屬實（R-8、R-9）；沒有 `publishConfig.tag`、`.npmrc` 或環境變數覆寫，publish 成功即代表 `latest` 指向該版 |
| 狀態 | — | 「已解決」 | 正確：決策已取得，選 (A) 不需要任何程式變更 |
| Timeline | — | 「獨立審查 PASS（`e522fd9`，[報告](./review-e522fd9.md)）；N-3 依 TBD-2 採 (A)，其餘 NIT 不修」 | PASS 綁定的 SHA 正確（沒有把 PASS 寫到報告提交或決策提交上），連結以相對路徑指向已提交的報告。「其餘 NIT 不修」：N-1、N-2、N-4 在第一輪都是非 `需決策` 的 NIT，依 review-evidence.md「純可讀性建議…不阻塞」，由實作方決定不修可以接受，不需要使用者決策 |

**狀態欄**：README 尾端仍是 `**狀態**: 待審查`，步驟 1 ✅、步驟 2（v1.30.1 實際發版觀察）⏳ 且證據欄為「（發版時回寫）」。步驟 2 相依合併後的真實發版，本來就不可能在合併前完成，描述誠實；本輪 PASS 之後由協調者更新狀態即可，不構成缺失。

## 範圍與 project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴、不改 CLI | 符合（R-5：程式與 package 檔案零差異） |
| 版控文件只用代稱、沒有本機絕對路徑 | `b32aff2` 新增的兩行符合（R-10）。第一輪報告在 V-22 列裡出現 `/home`、`/Users` 字樣，那是 grep 樣式本身而不是路徑，且屬於已接受的報告提交 |
| 提交格式、沒有 AI 署名 | 符合（R-11）；`docs(issue-24): …` |
| 檔案模式 | 一般檔案（R-6） |

## 失敗面覆蓋

| 失敗面 | 檢查 | 結論 |
| --- | --- | --- |
| 決策提交夾帶程式或常青文件變更，使第一輪證據失效 | R-4、R-5 | 不存在，第一輪證據沿用 |
| 決策紀錄扭曲選項或把建議寫反 | 上方逐項對照 | 不存在 |
| 決策理由不實（dist-tag 其實被覆寫） | R-8、R-9 | 不存在 |
| PASS 被標到錯的 SHA | Timeline 寫 `e522fd9` | 正確 |
| 狀態誇大（宣稱已完成或已發版驗證） | 狀態欄與步驟 2 | 沒有誇大 |

程式行為面的失敗面（輪詢、逾時、順序、`set -e`、source guard、覆寫值等）見第一輪報告「失敗面覆蓋」，對 HEAD 仍有效（R-5）。

## 發現

### MUST FIX

無。

### SHOULD FIX

無。

### NIT

- **N-1（承第一輪 N-3 的決策，僅記錄）理由中的「必定」成立的前提是 publish 成功。** 不帶 `--tag` 時 npm 使用預設 dist-tag `latest`，publish 成功就會把 `latest` 指向該版；workflow 用的是 `npm@12`，reviewer 沒有逐一驗證較新 npm 對「版本低於現有 `latest`」等情況的處理（可能直接拒絕 publish），但那種情況 workflow 會紅、根本走不到 Verify 段，不影響 TBD-2 的結論。不需修改。

第一輪的 N-1、N-2、N-4 仍存在於 HEAD（程式未變），已依 Timeline 決定不修，這裡不重複列出。

## 判定

**PASS**：本輪對完整範圍 `f7312d8..b32aff2`（patch-id `40c47833…`）重新審查。`e522fd9` 之後的變動只有第一輪報告的新增與 README 的兩行決策紀錄，程式與常青文件 byte-identical（R-5），因此沿用第一輪的測試證據，沒有重跑 harness。TBD-2 忠實記錄了第一輪 N-3 的待決問題、兩個選項、reviewer 建議與使用者「照建議」的答覆；理由「`npm publish` 沒有 `--tag`」經 workflow、`publishConfig` 與 `.npmrc` 核實屬實；Timeline 把 PASS 綁在正確的 `e522fd9`；狀態欄與步驟 2 的待辦標示誠實。沒有 MUST FIX 或 SHOULD FIX。本報告提交後，若只新增本報告一個檔案，依報告提交例外，本 PASS 對 `b32aff2` 持續有效。
