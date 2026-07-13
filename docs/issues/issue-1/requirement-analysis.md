# Requirement Analysis — Git-Aware Memory v1

- Issue: [issue-1](README.md)
- 日期: 2026-07-13
- 需求來源: 使用者提供之《Memoria Git-Aware Memory v1 規格書》v1.0（下稱「規格」，章節以 §N 引用）

## 1. 產品定位

Memoria 以**唯讀**方式觀察既有 Git Repository，將 commit graph、branch 演進、merge 與 release 轉換為可搜尋、可追溯、可供 AI Agent 使用的工程語義記憶（§2、§33）。

核心分工：

```text
Git                = 開發事實來源（唯讀）
Memoria SQLite     = 記憶系統 Source of Truth
Summary            = 開發事實的語義投射
Memory Checkpoint  = 有意義的開發里程碑
Memory Node        = 提供 Agent recall 的長期知識
```

## 2. 使用者流程

```text
1. memoria repo add /workspace/project     # 建立 Repository identity + 初始掃描（不摘要完整歷史）
2. 開發者照常使用 git（commit / merge / tag），Memoria 完全不介入
3. memoria repo sync project               # 手動或 session 開始/結束時觸發
   → 增量掃描新 commits / merge / tag
   → 建立 git events
   → commit 分組成 range
   → 生成必要摘要（range / branch / merge / release）
   → 建立 memory checkpoint
   → 高價值摘要 promotion 為長期記憶
4. Agent 透過既有 recall 查詢，結果附帶 Git 來源（repository / branch / base_sha / head_sha / summary_id）
```

## 3. 新舊行為差異

| 面向 | 現況 | 規格要求 |
|---|---|---|
| Git 整合 | `src/` 無任何 git 相關程式碼 | 全新唯讀掃描層（`git rev-parse/rev-list/log/...`，§5 白名單） |
| 記憶來源 | session JSON 匯入（`sync`）、raw source（`source add`） | 新增 Git repository 為第三種記憶來源 |
| 摘要 | 全部 deterministic（截斷、串接） | 結構化語義摘要（decisions / risks / importance，§7.5） |
| Recall 來源附帶 | envelope 層 `meta.evidence[]`，hit 無 source 欄位 | 每筆 hit 需附 Git 來源物件（§21） |
| CLI | 14 個既有 top-level 命令 | 新增 `repo` 命令 + 7 個子命令（§19） |
| 設定 | 純環境變數，無 config 檔 | JSON config `git.*` 區塊（§27） |

## 4. 功能需求（v1 必達，§3）

1. 將本機 Git Repository 加入 Memoria 管理；非 Git 路徑正確拒絕。
2. 不修改 Repository 的任何 Git 設定與檔案（§5 非侵入白名單/黑名單）。
3. 掃描 commit / branch / merge / tag；保存 parent 關係。
4. 增量偵測：只處理上次掃描後的變化（§26 效能要求）。
5. Commit range 分組（§15）與 trivial change filter（§16）。
6. 生成 commit range / branch / merge / release 摘要（§13、§14），輸出為結構化資料（§7.5）。
7. 高價值摘要 promotion 為 memory node（§7.6 升級/不升級條件）。
8. 摘要與 commit SHA 的來源關係保存（memory_sources，§9.11）。
9. Idempotency：重複 sync 不產生重複資料（§18 唯一鍵定義）。
10. 多 Repository 支援；路徑搬移後可 relocate 重新綁定（§19.6）。
11. 無 Git hook 亦可完整運作。
12. 敏感內容過濾：sensitivePaths 排除 + diff secret 偵測遮罩（§23）。
13. 錯誤處理與部分失敗隔離（§24）：掃描失敗不破壞既有資料、各階段可獨立重試。
14. Shallow clone / detached HEAD / worktree 的降級處理（§24、§25、§8.3）。

CLI 介面（§19）：`repo add / list / status / sync / summarize / relocate / remove`，含 `--dry-run`（只報告、不寫入）等選項。

MCP tool 介面（§20）：`repo_add / repo_list / repo_status / repo_sync / repo_summarize / repo_relocate / repo_remove`（落點見待確認 D2）。

## 5. 非目標（§4，明確排除）

不建 Git hook、不改 `.git/config` / hooksPath / refs / worktree、不替記憶建 commit、不 push、不做 memory branch / rollback、不重建 reflog、不強制還原 fast-forward 來源 branch、不對每個 commit 呼叫 LLM、不保存完整對話與完整 diff、不將 SQLite 放入受管理專案。

## 6. 驗收標準（§29 摘錄）

- Repository 管理：新增/拒絕/去重/relocate 正確。
- Git 掃描：新 commit、merge、tag、branch head movement 可辨識；重複同步無重複資料。
- 摘要：range/merge/release 摘要可生成，含 key changes / decisions / limitations / risks，可追溯 base/head SHA。
- 記憶整合：promotion 後可被 recall，recall 顯示 Git 來源，同一 summary 不重複 promotion。
- 非侵入性：完整流程後 `git status` 無任何額外變化；config / hooks / refs / branch / working tree / remote 均不變。

## 7. 模糊與衝突點

以下為規格內部或規格與現況的矛盾，**不自行補腦**，逐項列出：

### 7.1 規格未定義（未知事項）

| # | 項目 | 說明 |
|---|---|---|
| U1 | LLM 呼叫者 | §7.5 要求語義摘要，但未定義模型呼叫發生在哪一層、由誰觸發、失敗時的行為。現有程式碼零 LLM 呼叫。→ **阻塞決策 D1** |
| U2 | `host_id` 產生方式 | §9.2 有欄位但未定義來源（hostname 會變動，不穩定）。 |
| U3 | §15/§16 的「domain 相似」「message 主題相似」 | 未定義判斷規則；若需模型判斷則與 Summary Planner「避免不必要模型呼叫」（§26）矛盾。需 deterministic 化（路徑前綴、conventional commit type、時間窗）。 |
| U4 | 併發行為 | 兩個 worktree/instance 同時 sync 同一 repository 時「讀上次狀態→比較→寫入」的原子性未定義。 |
| U5 | `git_refs` 觀察紀錄的保留策略 | 每次掃描 append，規格未提 retention/prune。 |
| U6 | config 檔位置與載入機制 | §27 給了 JSON 形狀但未說檔案路徑與解析時機；現況無 config 檔機制。→ **阻塞決策 D3** |

### 7.2 規格內部矛盾

| # | 項目 | 說明 |
|---|---|---|
| C1 | Fingerprint 穩定性 | §8.1 `fingerprint = normalized_remote_url + root_commit_sha` 且 `UNIQUE(fingerprint)`，但 remote URL 會變（改名/換 host/從無到有），變更即身份斷裂；§25 又要求 shallow clone 補齊歷史後「重新確認 identity 但不得建立重複 Repository」。fingerprint 必須可演進。→ **阻塞決策 D4** |
| C2 | `patch_id` 全量計算 vs 效能要求 | §9.4 每筆 commit 都有 patch_id 欄位，但 `git patch-id` 需逐 commit 產 diff，大 repo 初次掃描違反 §26「不得逐一重新分析所有歷史 commit」。僅 §11.2 history rewrite 比對需要 → 應允許 NULL、lazy 計算。 |

### 7.3 規格與本 repo 慣例衝突

| # | 項目 | 說明 |
|---|---|---|
| X1 | 「Unit Tests」（§30） | 本 repo 明確無 unit test framework（CLAUDE.md），全部為 `scripts/test-*.sh` bash e2e。應改交付 `scripts/test-repo-*.sh`。 |
| X2 | MCP tools（§20） | 本 repo 無 MCP server（現有 MCP 是對外部 libSQL server 的 client bridge）。需新增 `@modelcontextprotocol/sdk` 依賴（違反 lean deps 慣例）或改走既有 HTTP surface。→ **阻塞決策 D2** |
| X3 | 「memory node」語義 | 規格假設可直接建立 memory node；實際上 `memory_nodes` 是由 `sessions`/`events` **衍生**的樹（`buildMemoryIndex` 重建），recall FTS 索引來源也是 `sessions`/`events`。promotion 必須寫入 recall 的資料路徑，而非平行體系（詳見 technical-analysis §3.3）。 |
| X4 | 命名撞名 | 既有 top-level `memoria sync`（session 匯入）與新的 `memoria repo sync` 語義不同，文件需明確區分。非阻塞。 |

### 7.4 明確標注為 best-effort / optional 的範圍

- Fast-forward merge 推斷（§12.2）：規格自述 best-effort、不要求百分百。建議延至 v1.1（待確認）。
- Agent session 整合（§22）：規格標明「允許但不強制」，v1 可不做。
- Secret 偵測（§23）：pattern-based 必有漏網，驗收標準應寫為 best-effort，不承諾「必偵測」。

## 8. 阻塞點總覽（已解除）

D1–D4 已於 2026-07-13 由使用者核可，全數採建議方案（決議內容見 [README](README.md)「已確認決策」）。對應本文件之未知/衝突項的解法：

- U1（LLM 呼叫者）→ D1：host agent 驅動回寫 + deterministic fallback。
- U2（host_id）→ `MEMORIA_HOME` 內一次性 UUID。
- U3（相似度規則）→ 全 deterministic 化（路徑前綴、conventional commit type、24h 時間窗）。
- U6（config 檔）→ D3：`config.json` + Zod，Phase 0 獨立工作項。
- C1（fingerprint）→ D4：`root_commit_sha` 為主要身份成分。
- C2（patch_id）→ 允許 NULL，僅 history rewrite 偵測時 lazy 計算。
- X1（Unit Tests）→ 改為 `scripts/test-repo-*.sh` bash e2e。
- X2（MCP tools）→ D2：v1 走 HTTP `/v1/repos/*`，MCP 延 v1.1。
- §7.4 範圍 → fast-forward 推斷與 Agent session 整合均延至 v1.1；secret 偵測驗收明定為 best-effort。

U4（併發）與 U5（git_refs retention）非阻塞，於 implementation plan Phase 6 處理。
