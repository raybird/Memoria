# 審查報告
- 範圍：完整交付範圍（`main` 97273a8..issue-37-remember-vector-gap e8771f5；分級 Small、風險 Low）
- Reviewed BASE SHA：97273a8461a3a69c12599cda8595101fee3e2f41
- Reviewed HEAD SHA：e8771f57a3542325549c4a7e7e57334a9526be4c
- Reviewed patch-id：3424c07d168dd1b0e4bea1e34b709a0720c8e53a
- 獨立 reviewer：Claude Code 隔離 subagent（不是實作者），2026-11-26
- 增量覆審：上一份報告 review-8705ad3.md（PASS），增量範圍 `8705ad3..e8771f5`。這一輪只為處理該報告的建議：使用者選了修正 N2～N5，N1 記入待確認、程式不改。03a2c6f 是保存上一份報告的記帳提交

增量覆審的條件都成立：8705ad3 有一份記完整範圍的持久化報告，8705ad3 是 e8771f5 的祖先，中間沒有 merge 提交，也沒有改寫歷史；`git merge-base main e8771f5` 仍是 97273a8；03a2c6f 經 `verify-artifact.py` 判定 OK，只有記帳變更。

## 問題與風險

- MUST FIX：無
- SHOULD FIX：無
- NICE TO HAVE：
  1. **`## 待確認事項` 的位置與範本不同**（`docs/issues/issue-37/README.md:49`）。Small 範本把這一節放在 `## 風險與首要驗證` 之後、`## 實作與驗證步驟` 之前，這裡放在實作步驟之後、Timeline 之前。document-types.md 沒有規定順序，verify-artifact 也不檢查，所以不影響判定。審查後再搬動 `##` 標題順序會讓 PASS 失效，所以只在之後本來就要改程式時順手調整。

## 已查核維度

### 上一份建議的處理

| 建議 | 處理 | 結論 |
|---|---|---|
| N1：鎖住時多等 5 秒 | README TBD-1 記為 `不影響本次交付`，附日期、使用者決定與理由（追蹤：無）。理由說 ingest 自 issue-31 起逐列提交，經查屬實：`skills/memoria-vector/vector-ingest.mjs:84-95` 每列各自 `db.execute`，出自 4cfd0e2「fix(issue-31): vector-ingest 改回逐列提交」。「縮短等待要改 doctor 共用的讀取函式」也屬實（`countEmbeddedRows` 由 `measureVectorCoverage` 共用） | 照使用者決定處理，理由具體 |
| N2：人讀提示的筆數沒跟 doctor 比對 | `scripts/test-vector-recall.sh:923` 在人讀那則寫完後立刻跑 doctor（D37H），`:939` 斷言 `OUT37_N` 等於當下的 missing；解析抽成 `doc_missing37`（`:926-928`），JSON 的比對改用同一個函式 | 已修正。突變測試抓得到，見下方 |
| N3：遠端 libSQL 沒有自動化測試 | `:952-956` 以 `LIBSQL_URL=libsql://memoria-37.invalid` 執行 remember `--json`，斷言 exit 0、沒有 `vector_missing`。`.invalid` 保證不會解析到真實主機，而且 `countEmbeddedRows` 遇到非 `file:` 的 URL 不會連線 | 已修正。突變測試抓得到 |
| N4：常青文件沒提這次改動 | `docs/OPERATIONS.md:366` 補上「since issue-37 `remember` says so right after the write, printing the gap with the same count `doctor` reports」，`Last verified` 加註 issue-37。`docs/agents/architecture.md:28` 補上 `measureVectorCoverage()` 是 doctor、setup 與 remember 共用的覆蓋率來源，`Last verified` 加註。兩句都與程式一致：setup 經 `inspectVectorLayer` 取覆蓋率，`countEmbeddableEntities` 是分母，不是另一套覆蓋率計算 | 已修正 |
| N5：紅燈紀錄缺命令與單迴圈合併理由 | README 步驟 2 補上紅燈的實際命令與做法（只改測試、在 `97273a8` 的 build 上跑、到 issue-37 段 exit 1、4 項 ✗），與我在上一輪重現的結果一致；也補上單迴圈合併的理由（提示與 JSON 欄位只存在於 CLI 輸出，沒有更內層可以單獨測的行為），以及補斷言後重跑仍 exit 0 | 已修正 |

### 新斷言能不能在錯誤時失敗（突變測試）

我在臨時 worktree 檢出 e8771f5，對 `src/cli/commands/remember.ts` 注入兩個錯誤後 build，再跑整支 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/test-vector-recall.sh`：

- 人讀那行改印 `vectorMissing + 1`，JSON 不動：`✗ AC-1：人讀提示的筆數 (6) 應等於當下 doctor 的 missing (5)`。
- 覆蓋率原因為 `remote_libsql` 時誤當成缺 1 筆：`✗ AC-2：遠端 libSQL 時不應有 vector_missing`。
- 結果：`✗ issue-37：2 項失敗`，rc=1，前面各段照常通過。

兩個新斷言都能在對應的錯誤上紅燈，不是假綠燈。新斷言守的是已經正確的行為，所以在 HEAD 上本來就是綠燈，README 也沒有聲稱它們有紅燈。worktree 驗完已移除。

### 本輪重跑

- e8771f5 上整支 `test-vector-recall.sh`：exit 0，沒有 ✗，issue-37 段印出「…補完、未啟用、覆寫、遠端時不提示…」。
- `bash -n scripts/test-vector-recall.sh` 通過；`pnpm run release:docs-check` 回「Release doc sync check passed for v1.39.0」。
- 增量沒有改 `src/`（`git diff --stat 8705ad3..e8771f5 -- src` 為空），所以上一輪的 AC-2 逐位元組基準、`inspectVectorLayer` 24 組等價比對、效能量測與其他回歸結論都不受影響，不必重跑。工作樹的 `dist/` 本輪沒有改動，與 HEAD 的原始碼一致。

### README 與 TBD 寫法

- `## 現況` 位在 `## 概述` 之後，內容只有 `**現行 review**` 一行，符合 document-types.md。下一個記帳提交要改成指向本報告。
- `## 待確認事項` 的表頭照範本寫。狀態值 `不影響本次交付`、`已解決` 都在定義內，狀態欄都寫了日期、結論與理由；TBD-1 以「追蹤：無」帶出具體、與交付範圍相關的不追蹤理由。影響欄只寫影響與 AC 編號。整節沒有 `<`，行首沒有粗體或 `[`。
- Timeline 新增兩列：審查結果、使用者對建議的決定，都是語意事件。`**狀態**: 審查中` 是 docs/AGENTS.md 舉例的階段值。
- 公開 repo：增量新增的行裡沒有個人絕對路徑或外部專案真名。唯一命中 `/home/` 的是上一份報告裡描述檢查項目的文字，不是路徑。

### 需求、架構、安全、品質

這一輪沒有改程式，也沒有改驗收條件；測試輔助函式 `doc_missing37` 消除了原本的重複解析，沒有過度設計。其餘沿用 review-8705ad3.md。

### 豁免、待確認與限制

- TBD-1 是本輪新增的已知限制：向量庫被鎖住時 remember 最多多等 5 秒。使用者已決定記錄、不修，也不影響本次交付。
- TBD-2 已解決。
- 沒有豁免。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
