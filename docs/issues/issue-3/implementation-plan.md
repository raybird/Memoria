# Issue 3 — 實作計畫

- 建立：2026-07-28
- 對應：[README.md](README.md)
- 分級：Medium（分析概要併入本文件前置章節）

---

## 0. 分析概要

### 退化鏈

```
repo summarize --tag backend-2026.0723.1131
  └─ summarizeTag (summary-pipeline.ts:275)
       └─ previousReleaseTag(tags, tagName)      ← 只認 /^(?:v|release-)?\d+\.\d+\.\d+$/
            └─ parse(current) === null → return null
       └─ baseSha = null
  └─ buildRangeContext(root, null, headSha, …)
       └─ base = EMPTY_TREE_SHA                  ← 「從空樹到 tag」= 整個 repo
       └─ commits[] 542 筆、changed_files[] 1065 筆（皆無上限）
       └─ diff 超過輸出上限 → 取不到
```

### 修法

1. **前一個 tag 的解析加 fallback**：semver 比較（既有，優先）→ 不可解析時改用 `git for-each-ref --sort=creatordate refs/tags` 取「creatordate 嚴格早於當前 tag 的最近一個」。`for-each-ref` 在規格 §5 白名單內，annotated tag 需取 `%(*objectname)`（peeled commit）。真的沒有前一個 tag（首個 release）→ 維持 root..tag，語意本來就正確。
2. **context 上限**：`git.summarization` 新增 `maxContextCommits`（預設 200）與 `maxContextFiles`（預設 500）。`commits[]` 保留最新 N 筆（`git log` 本來就是新到舊）、`changed_files[]` 保留前 N 筆；**`diffstat` 以截斷前的完整清單計算**，截斷寫入 `warnings`。

### 不做的事（範圍外）

- 不放寬 sync 的 `RELEASE_TAG_PATTERN`——非 semver repo 在 sync 時仍不自動產 release 摘要。要開放需另行拍板（會讓每個日期 tag 都生成 pending 摘要，量的影響需先評估）。
- 不清理已存在的退化摘要（`sum_0d4242f928b446fa` 在使用者自己的 `~/.memoria`，非 repo 內資料；且 R1 已擋住它進語料）。

---

## 1. 實作步驟

### Phase 1 — 前一個 tag 解析 fallback

| Task | 產出 | 完成判準 |
|---|---|---|
| 1.1 | `summary-pipeline.ts` 新增 `previousTagByCreatordate(repositoryRoot, currentTag)`：`for-each-ref --sort=creatordate --format='%(refname:short)%x1f%(objectname)%x1f%(*objectname)'`，取當前 tag 之前最近一個（peeled 優先） | 只用白名單子命令；找不到當前 tag 或它是最早的 → null |
| 1.2 | 兩個呼叫點（`:208` sync、`:278` 明示）改為 `previousReleaseTag(...) ?? await previousTagByCreatordate(...)`；`plannerNotes` 註明來源（semver / creatordate / first release） | semver repo 的既有行為 byte-identical（semver 路徑優先短路） |
| 1.3 | 測試：fixture 加兩個非 semver tag（`build-*`，以 `GIT_COMMITTER_DATE` 固定 creatordate 順序），明示 `--tag` 第二個 → `git_summary_ranges.base_sha` = 第一個 tag 的 commit | `test-repo-summary.sh` 通過 |

### Phase 2 — context 上限

| Task | 產出 | 完成判準 |
|---|---|---|
| 2.1 | `config.ts` `gitSummarizationSchema` 新增 `maxContextCommits`（int ≥1，default 200）、`maxContextFiles`（int ≥1，default 500） | 舊 config.json 照常可讀（Zod default） |
| 2.2 | `buildRangeContext`：commits 超限保留最新 N、changed_files 超限保留前 N，各自 push warning（含總數與保留數）；`diffstat` 用完整清單計算 | 未超限時輸出 byte-identical |
| 2.3 | 測試：fixture 的 `MEMORIA_HOME/configs/config.json` 寫入極小上限（如 commits 2 / files 3），`--pending` 斷言截斷 warning 與筆數；測後移除 config 不影響其他段落 | `test-repo-summary.sh` 通過 |
| 2.4 | 文件：`docs/OPERATIONS.md` tunables 清單補兩欄位；`CHANGELOG.md` `[Unreleased]` Fixed（tag fallback）+ Added（上限） | docs-check 通過 |

> 排序：Phase 1 先——它修正語意錯誤（範圍失真）；Phase 2 是防禦深度（即使 base 正確也可能超大）。兩者獨立 commit、可獨立回滾。

---

## 2. 驗收

1. `pnpm run check` / `pnpm run build` / `node dist/cli.mjs --help`
2. `bash scripts/test-repo-summary.sh`（含新斷言）+ `test-repo-promotion.sh` + `test-repo-noninvasive.sh` 無回歸
3. 真實驗證：對 line-oa-plus 重跑 `repo summarize --tag backend-2026.0723.1131`（新 range fingerprint 會建新摘要），`base_sha` = `angular+backend-2026.0721.1649` 的 commit，context 落在數 KB 級
4. `bash -n` 過；CHANGELOG 有對應條目
