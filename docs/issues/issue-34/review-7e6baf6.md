# 審查報告
- 範圍：完整交付範圍（`eb654e2..7e6baf6`，本 repo 不開 PR，審查後 fast-forward 進 main）
- Reviewed BASE SHA：eb654e292eb097507f3782e903be715c038545e4（= main，審查者以 `git merge-base main 7e6baf6` 確認沒有變）
- Reviewed HEAD SHA：7e6baf622d63bfb9a462f63536fb6aebcc5da57b
- Reviewed patch-id：4d0dec1f619dbd0b4c6a40e462079127ed410850（審查者以 `git diff eb654e2 7e6baf6 | git patch-id --stable` 重算，結果相同）
- 獨立 reviewer：Claude subagent（general-purpose），與實作者不同 context
- 增量覆審：上一份報告 review-269a2aa.md，增量範圍 269a2aa..7e6baf6（處理 TBD-3 去向建議）

審查日期：2026-11-25

增量覆審的條件：

- review-269a2aa.md 綁定 269a2aa，涵蓋完整範圍，判定 PASS。
- 269a2aa 是 7e6baf6 的祖先，中間只有 eb649ef、7e6baf6 兩個非 merge 提交，歷史沒有改寫。
- main 沒有前進。

使用者 2026-11-25 選擇處理上一份報告的 NICE TO HAVE，做法是「現在寫進 CHANGELOG」。

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

無。

### NICE TO HAVE

- **N1. CHANGELOG 的「The hybrid label counts only the rows a caller receives」少了 superseded 的例外**（`CHANGELOG.md:11`）
  - 實際行為：被 superseded 濾掉的列仍然計入標籤，這是改動前就有的慣例。見 `docs/agents/architecture.md` 的「plus superseded ones as before」與 TBD-5。
  - 為什麼不阻擋：這一條要說的是「合併掉的那半不再計入」，這部分寫得正確，所以讀者不會因此誤判 routeUtility 的不連續。
  - 建議：可以補一句「(rows the superseded filter removed still count, as before)」，也可以維持原樣。

## 已查核維度

### 建議的處理

上一份報告的 NICE TO HAVE 已處理。

- TBD-3 原本寫「追蹤：無」，但同一格還有一個待做的發版動作。現在這個動作已經完成：`CHANGELOG.md` 的 `[Unreleased]` 新增了「Compatibility and upgrade」條目。
- TBD-3 的「追蹤：」改成指向這個已寫好的條目，並附日期與依據。這一格不再有未完成的動作，`不影響本次交付` 的去向寫法成立。

### CHANGELOG 與程式行為逐句對照

| CHANGELOG 敘述 | 對照依據 | 結論 |
|---|---|---|
| `remember` 存成 `note-…` 與 `noteev-…` 兩筆，recall 兩筆都算，top-5 可能只有三則不同的內容 | `src/core/memoria.ts:475-476` 的寫入方式；README 概述記錄的下游回報 | 一致 |
| 只留排名較前的那一筆 | `collapseNoteHits` 保留第一個出現的列；test-cli-memory 的 utility 翻轉斷言（review-269a2aa 已驗證） | 一致 |
| 合併後不足 `top_k`、而且路由填滿了視窗時，以 `2 × top_k` 再跑一次 | `src/core/memoria.ts:808-814` 的條件是 `distinct < ranked && distinct < topK && route.rows.length >= topK` | 一致 |
| vector 第二輪沿用 helper 超量取回的候選，每次 recall 只跑一次 embedder | `recallVector` 回傳 `candidates`；test-vector-recall 的計數 wrapper 斷言 helper 只跑一次 | 一致 |
| 沒有成對筆記可合併的查詢，結果與之前完全相同 | review-a6db261 的對照與 AC-3 腳本 | 對合法輸入一致。負數 `top_k` 的例外，使用者已在 TBD-4 決定不處理，不重提 |
| hybrid 命中筆記時可能從 `hybrid_fallback` 變成 `hybrid_tree`，升級前後的 routeUtility 不能直接比較 | TBD-3；`src/core/memoria.ts:836-841`；review-a6db261 的實測 | 一致（附 N1） |
| 補滿時，結果是加深視窗的路由結果減去合併掉的那半，所以其他命中可能和上一版不同 | TBD-1 的結論（「可能換位置，也可能換成員」） | 一致。superseded 造成名額不足（S2）不是相對上一版的變化，沒寫進 CHANGELOG 合理 |

其他確認：

- `routeUtility` 是程式中實際使用的欄位名（`src/core/types.ts:418`、`:547`）。
- 新條目沿用既有的段落名稱 `### Fixed`、`### Compatibility and upgrade`。

### 本地 gate 與文件寫法

- **版控文件只用代稱**：用本機其他專案的名稱搜尋增量中的 CHANGELOG 變更，沒有符合項。CHANGELOG 沒有提到任何外部專案、外部分支或外部 commit SHA。
- **增量不含程式碼**：`git diff --quiet 269a2aa 7e6baf6 -- src scripts` 成立，所以 review-269a2aa 的程式結論與測試結果不受影響，不需要重跑測試。
- **eb649ef 的檔案**：
  - `review-269a2aa.md` 與審查者寫出的版本一字不差（以 `diff` 比對）。
  - `**現行 review**` 改成 `review-269a2aa.md`，格式正確。
  - `**狀態**` 改成「審查通過（review-269a2aa），建議待確認」，7e6baf6 再改回「建議修正完成，待增量覆審」。兩者都是一般的階段描述，沒有誤用特殊狀態值，dev-cycle 不會誤判。保存本報告時，記得同步更新 `**現行 review**` 與 `**狀態**`。
- **TBD-3 列的寫法**：含 `[Unreleased]`，但 `[` 不在行首；沒有 `<`。符合記帳區段的寫法。
- **`pnpm run release:docs-check`**：exit 0，輸出「Release doc sync check passed for v1.39.0」。

### 本輪執行的命令

- `git merge-base main HEAD`、`git diff eb654e2 7e6baf6 | git patch-id --stable`：結果如上。
- `git diff --quiet 269a2aa 7e6baf6 -- src scripts`：exit 0（沒有程式變更）。
- 用 `diff` 比對 eb649ef 中的 `review-269a2aa.md` 與工作樹版本：exit 0。
- 用外部專案名稱 grep CHANGELOG 變更：exit 1（沒有符合項）。
- `pnpm run release:docs-check`：exit 0。

其餘沿用 review-269a2aa.md。

### 豁免、待確認與限制

- 沒有 Gate 豁免，也沒有待確認事項。
- 本輪新增的限制：增量只有文件，所以沒有重跑程式測試。

## 流程判定

PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
