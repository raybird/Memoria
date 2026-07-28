# Issue 3: 非 semver tag 的 release 摘要退化成全 repo 範圍 + summary context 無上限

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 3（本地文件編號） |
| 複雜度級別 | Medium（局部修正 + 兩個 config 欄位，無 schema 變更） |
| 狀態 | **待實作**（分析完成） |
| 需求來源 | 2026-07-28 以 v1.21.0 對 `line-oa-plus`（20 個非 semver tag）實測 Git-Aware Memory 時發現 |
| 建立日期 | 2026-07-28 |
| 前置 | [issue-1](../issue-1/README.md)（Git-Aware Memory v1）、[issue-2](../issue-2/README.md)（可用性改進） |

## 文件清單

- [implementation-plan.md](implementation-plan.md) — 分析概要與實作計畫（2 Phase）

## 摘要

`repo summarize --tag <tag>` 在 tag 名不符 semver 時，找不到「前一個 release」會**退回空樹**當 base，把 release 範圍變成「從創世到該 tag」。在 line-oa-plus 上實測：542 commits / 1065 files、context 157 KB（issue-2 的 diff opt-in 救不到——膨脹的是 `commits[]` 58 KB 與 `changed_files[]` 98 KB）、diff 因超過輸出上限而取不到、摘要語意完全失真。

連帶暴露第二個問題：`buildRangeContext` 的 `commits[]` / `changed_files[]` **沒有上限**，即使 base 正確，超大 range 的 context 仍會無界膨脹。

## 實測證據（2026-07-28，line-oa-plus）

```
$ memoria repo summarize line-oa-plus --tag backend-2026.0723.1131
- sum_0d4242f928b446fa [release] importance=0.85 status=pending

git_summary_ranges.base_sha = ''（空）→ 範圍 = 整個 repo
context: commits 542 筆（58,445 bytes）、changed_files 1,065 筆（98,457 bytes）
warnings: "diff unavailable (objects missing or too large); context reduced to messages + stats"
```

line-oa-plus 的 20 個 tag（`202606251200`、`backend-2026.0723.1131`、`angular+backend-2026.0721.1649`、`v0721.1600`…）**沒有一個**符合 `previousReleaseTag` 的正則 `/^(?:v|release-)?(\d+)\.(\d+)\.(\d+)$/`（`src/core/git/summary-pipeline.ts:107`）。Memoria 自身用 `v1.20.0` 是 semver，所以 issue-2 之前的試用沒踩到。

## 影響面的精確界定（比第一眼窄）

| 路徑 | 是否受影響 | 原因 |
|---|---|---|
| `repo sync` 自動 release 摘要 | **否** | `summary-pipeline.ts:203` 有 `RELEASE_TAG_PATTERN` 閘門，非 semver tag 事件被標 `ignored`，不會產生摘要 |
| `repo summarize --tag`（明示） | **是** | `summarizeTag`（`summary-pipeline.ts:275`）無閘門，任何 tag 名都接受，但前一個 tag 只用 semver 比較 → 非 semver 一律退回空樹 |
| 語料污染 | **已被 issue-2 R1 擋住** | 退化摘要停在 `status='pending'`，不會自動 promote；但明示 `--promote` 仍會推進去 |

> 初步分析時曾寫「20 個 tag 就是 20 筆退化摘要」——**過度推論，已修正**：sync 路徑有閘門，唯一的退化入口是明示 `--tag`。

## 變更邊界

### 可修改

- `src/core/git/summary-pipeline.ts` — 前一個 tag 的解析策略（兩個呼叫點：`:208` sync、`:278` 明示）
- `src/core/git/summary-context.ts` — `commits[]` / `changed_files[]` 上限
- `src/core/config.ts` — `git.summarization` 既有區塊內新增欄位（向後相容，Zod default）
- `scripts/test-repo-summary.sh`、`docs/OPERATIONS.md`、`CHANGELOG.md`

### 禁止修改

- **不動 git 唯讀白名單**——fallback 只能用既有允許的子命令（`for-each-ref` 在清單內）
- **不放寬 sync 的 `RELEASE_TAG_PATTERN`**：讓非 semver tag 在 sync 時自動產生 release 摘要是行為擴張，需另行拍板（見「範圍外」）
- 不新增資料表、不改 CLI 命令名、不引入依賴

### 風險

| 風險 | 緩解 |
|---|---|
| creatordate 排序在 lightweight/annotated 混用時語意不同（前者=commit 時間、後者=打 tag 時間） | 屬 git 本身語意，文件註明；semver 可解析時仍優先用版本比較，行為不變 |
| 真正的首個 release 仍是 root..tag（合法情境） | 不改範圍語意，靠 Phase 2 的 context 上限讓它可負擔 |
| 上限截斷讓 agent 看不到部分 commit/檔案 | `diffstat` 維持全範圍統計；截斷寫進 `warnings` 明示（無靜默截斷） |

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-28 | v1.21.0 對 line-oa-plus 實測發現；查證程式碼並修正影響面認定（sync 有閘門）；建立 issue 文件 |

## Changelog

- 2026-07-28: 初版建立（README + implementation-plan）。

---
**建立日期**: 2026-07-28
**最後更新**: 2026-07-28
**文件版本**: 1.0
**狀態**: 分析完成，可進實作
**分級**: Medium
