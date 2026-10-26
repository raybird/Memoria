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
memoria setup                          # 互動式引導安裝（記憶範圍、agent skills、語意召回、brief／規範接線）
memoria setup --scope global --agent both --vector --yes  # 非互動一次到位設定
memoria setup [--serve] [--json]       # 自動化一鍵安裝
```

`remember`、`recall`、`mark`、`feedback`、`brief` 直接存取本地資料，skill 型部署不需要 server。多個 repository 共用記憶庫時，recall 請帶 `--project` 限定範圍。

在已註冊 repository 內執行 `brief`，會自動辨識專案並寫入 `knowledge/BRIEF-<project>.md`；明確指定 `--project` 仍寫 `BRIEF.md`，`--global` 則選取所有專案。Durable 記憶會列在不受 `--days`、`--top-k` 限制的固定區塊，被取代的記憶會排除。project 不屬於任何已註冊 repository 的記憶會隨各專案的 brief 載入。依 `brief` 輸出，在 `AGENTS.md` 設定讀取指令；Claude 的 `CLAUDE.md` 以 `@AGENTS.md` 與 brief 路徑載入。記憶更新後重新產生 brief。詳見 [Operations](OPERATIONS.md#context-injection-via-briefmd)。

## 本機記憶工作台

先初始化預定的資料根，再執行：

```bash
MEMORIA_HOME=/path/to/data-root memoria serve --ui --port 3917
```

開啟印出的 `http://127.0.0.1:3917/ui/`。UI 模式只監聽 IPv4 loopback，接受印出的確切 Host 與同源請求；請使用 `127.0.0.1`，其他 hostname 別名會被拒絕。不帶 `--ui` 的 `memoria serve` 維持既有 API 行為。

工作台提供決策、技能事件與 session 分類，精確專案／環境共用篩選、常駐與已取代標記、完整內容與來源、明確提交的關鍵字／語意搜尋，以及既有 brief。預設決策列表不重複列出 note 的包裝 session。常駐清單獨立瀏覽；記憶庫搜尋在選定範圍中跨記憶類型檢索。專案 brief 沿用既有的環境共用資訊政策。

介面為唯讀；UI 模式拒絕業務寫入與任意檔案讀取，明確搜尋保留本地 recall 遙測。不安裝 service、hook 或 UI 分析服務。HTML／CSS／JS 隨 CLI 內嵌，不需 CDN 或外部字型；記憶中的 Markdown／HTML 原文以安全文字閱讀。資料根未初始化時回報錯誤，不自動建立或遷移；請先對正確資料根執行 `doctor`，必要時明確執行 `init`。

可切換淺色／深色／系統外觀並保留在瀏覽器本機。網址保存範圍、類型、頁碼、搜尋字串與記憶 ID，因此瀏覽紀錄會含這些資訊；這些本機網址不是公開分享連結。`/` 可聚焦記憶庫搜尋，窄螢幕提供閱讀與返回流程。語意降級會明確標示，不把排名分數包裝成正確率。

以 Tab 在控制項間移動、Enter 開啟已聚焦記憶、Escape 返回列表並恢復焦點。`--json` 會輸出啟動埠與 UI 網址供自動化使用。若埠被占用，請停止既有程序或選擇其他 `--port`；工作台不會悄悄改用另一個資料根或埠。
