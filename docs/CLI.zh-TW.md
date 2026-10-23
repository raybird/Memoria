# CLI 使用指南

[English](CLI.md) ｜ **繁體中文** · [README](../README.zh-TW.md)

最後驗證：2026-10-23，對照 v1.31.1 原始碼、CLI help 與文件檢查。

以下命令使用 npm 安裝後的 `memoria`。在 repository checkout 中可改用 `./cli`；完整旗標以 `memoria <command> --help` 為準。方括號表示可選參數，`<…>` 表示需替換的值。

## 常用命令

```bash
memoria init                           # 初始化 DB + 目錄
memoria sync <session.json>            # 匯入 session
memoria sync --dry-run <session.json>  # 預覽不寫入
memoria recall "為什麼用 pnpm" [--json] # 召回記憶（--project/--scope/--top-k/--time-window/--mode）
memoria remember "改用 pnpm" --project Memoria --rationale "lockfile 是權威"
memoria remember "..." --type skill --category cli   # 改寫成 SkillLearned 筆記
memoria feedback <recall_id> --score 0.9 --hits <id,id>  # UFL 效用回報
memoria brief [--project X] [--days 30]  # 編譯 markdown brief，供 AGENTS.md 指引讀取
memoria remember "..." --durable         # 恆真事實：不衰減、不被 stale 裁剪
memoria mark <ref_id> --durable         # 固定既有記憶，包含 git 促升的決策
memoria brief --global                 # 所有專案合寫 knowledge/BRIEF.md
memoria remember "..." --supersedes <ref_id>       # 舊記憶退出召回（資料保留）
memoria remember "..." --sensitivity private       # 標記供 export --redact 使用
memoria recall "..." --include-superseded          # 一併顯示被取代的版本
memoria export --redact                  # 對 private 記憶中的已知實體代稱化
memoria stats [--json]                 # 統計
memoria doctor [--json]                # 本地健康檢查
memoria verify [--json]                # 完整驗證
memoria index build [--json]           # 增量重建 tree index
memoria index build --scope agent:main # 只重建指定 scope
memoria source add notes/research.md   # 匯入 markdown/text source
memoria source list --json             # 列出 raw sources
memoria repo add /path/to/project      # 唯讀觀察 git repo
memoria repo sync project              # 增量掃描 → 事件 → 摘要 → promotion
memoria repo summarize project --pending --json  # 待 agent 增強的摘要請求
memoria repo summarize project --dismiss-pending --type merge,release  # 略過他人的骨架，不寫進記憶
memoria wiki build --json              # 重建 compiled wiki
memoria wiki file-query --query "TS CLI migration" --title "TS CLI Migration Brief" --kind synthesis --scope project:Memoria
memoria wiki lint --json               # 產生 durable wiki governance findings
memoria govern review --json           # 檢查可提升成 rule/skill 的候選項
memoria prune --all --dry-run          # 清理預覽（含 consolidate 90d + stale 180d + git-observations 90d）
memoria prune --consolidate-days 90    # 合併同 topic 下的舊 session nodes
memoria prune --stale-days 180         # 移除從未被 recall 命中的過期記憶
memoria export --type all --format json # 匯出
memoria serve [--port 3917]            # HTTP API Server
memoria preflight [--json]             # 前置條件檢查
memoria setup [--serve] [--json]       # 一鍵安裝
memoria setup --vector                # 安裝語意召回依賴並暖機模型
```

`remember`、`recall`、`mark`、`feedback`、`brief` 直接存取本地資料，skill 型部署不需要 server。多個 repository 共用記憶庫時，recall 請帶 `--project` 限定範圍。

在已註冊 repository 內執行 `brief`，會自動辨識專案並寫入 `knowledge/BRIEF-<project>.md`；明確指定 `--project` 仍寫 `BRIEF.md`，`--global` 則選取所有專案。Durable 記憶會列在不受 `--days`、`--top-k` 限制的固定區塊，被取代的記憶會排除。project 不屬於任何已註冊 repository 的記憶會隨各專案的 brief 載入。依 `brief` 輸出，在 `AGENTS.md` 設定讀取指令；Claude 的 `CLAUDE.md` 以 `@AGENTS.md` 與 brief 路徑載入。記憶更新後重新產生 brief。詳見 [Operations](OPERATIONS.md#context-injection-via-briefmd)。
