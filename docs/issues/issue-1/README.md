# Issue 1: Memoria Git-Aware Memory v1 — 非侵入式 Git 專案工程記憶

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 1（本地文件編號；GitHub repo 目前無既有 issue） |
| 複雜度級別 | Large（跨多模組、新增資料庫表、大型功能） |
| 狀態 | 決策已確認（2026-07-13，D1–D4 依建議方案定案）— 待 decompose |
| 需求來源 | 使用者提供之《Memoria Git-Aware Memory v1 規格書》v1.0（2026-07-13） |
| 建立日期 | 2026-07-13 |

## 文件清單

- [requirement-analysis.md](requirement-analysis.md) — 需求分析：使用者流程、功能邊界、模糊與衝突點
- [technical-analysis.md](technical-analysis.md) — 技術分析：現況架構對應、變更邊界、風險
- [implementation-plan.md](implementation-plan.md) — 實作計畫：Phase 0–6（草稿，待決策確認後方可 decompose）

## 摘要

將既有 Git Repository 視為唯讀的外部開發事件來源：掃描 commit graph、branch refs、tags 與工作目錄狀態，產生 Git 事件與結構化語義摘要（commit range / branch / merge / release），高價值摘要升級為可被既有 recall 搜尋的長期記憶，並保留至 commit SHA 的來源追溯。全程不修改受管理 Repository 的任何 Git 狀態。

目前 `src/` 完全沒有 git 相關程式碼，本功能為 greenfield，約等於新增 11 張資料表、7 個 CLI 子命令與一個全新的 git 唯讀讀取層。

## 已確認決策（2026-07-13 使用者核可，全數採建議方案）

| # | 決策點 | 決議 |
|---|---|---|
| D1 | Semantic Summarizer 的 LLM 呼叫者（規格 §7.5 未定義） | Host agent 驅動回寫（同 UFL outcome 模式）+ deterministic fallback 保底 |
| D2 | MCP tools（§20）落點——repo 無 MCP server | v1 改為 HTTP `/v1/repos/*` endpoints，MCP tools 延至 v1.1 |
| D3 | 設定規格（§27）的 config 檔機制 | 引入 `config.json` + Zod schema，config loader 為獨立工作項（Phase 0） |
| D4 | Repository fingerprint 身份策略 | 以 `root_commit_sha` 為主要身份成分，remote URL 降為 metadata；shallow clone 才 fallback |

範圍決議：

- 測試採本 repo 慣例之 bash e2e 腳本（`scripts/test-repo-*.sh`），不引入 unit test framework。
- Fast-forward merge 推斷（§12.2）延至 v1.1。
- Agent session 整合（§22，規格標 optional）延至 v1.1。
- Issue 文件採通用四件套格式（`docs/AGENTS.md` 分級規範於本 repo 不存在）。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-13 | 收到 v1.0 規格書，完成現況架構探查與需求分析 |
| 2026-07-13 | 建立 issue 文件四件套（本目錄） |
| 2026-07-13 | 使用者核可 D1–D4 與範圍事項（全數採建議方案），implementation plan 轉為已確認 |

## Changelog

- 2026-07-13: 初版建立（README、requirement-analysis、technical-analysis、implementation-plan）。
- 2026-07-13: D1–D4 與範圍事項定案，四份文件同步更新為已確認狀態。
