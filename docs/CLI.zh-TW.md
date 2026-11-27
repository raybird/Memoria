# CLI 使用指南

[English](CLI.md) ｜ **繁體中文** · [README](../README.zh-TW.md)

最後驗證：2026-11-26，對照 issue-39 原始碼（`feedback --used`）、issue-38 原始碼（未掃描的計算範圍與未掃描 tag）、CLI help 與文件檢查。

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
memoria remember "release 分支已併入 main" --verify "git log main --oneline -1"  # 狀態類記憶：recall／brief 顯示截至日期與查證命令，Memoria 不執行
memoria recall "..." --include-superseded          # 一併顯示被取代的版本
memoria export --redact                  # 對 private 記憶中的已知實體代稱化
memoria stats [--json]                 # 統計
memoria stats --zero-utility [--window P30D] [--limit 20] [--json]  # 列出回報無用或零命中的召回
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
# 寫回 merge 或 release 摘要時，會一併略過範圍內的 commit range 骨架；結果回報 dismissed_covered
# 寫回結果的 promotion 說明是否進入 recall：promoted、updated、not_eligible、already_promoted，或 failed（附 promotion_error）
# 重新寫回已在 recall 的摘要會更新它（updated）：decision 依文字比對，不再列出的標記為已取代，不會刪除
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

啟用語意召回時，`remember` 寫入後會檢查向量庫。它本身不寫向量，所以新筆記在向量庫補上之前，`--mode vector` 查不到它。向量庫有缺口時，輸出多一行 `- vector coverage: 缺 <n> 筆，語意召回查不到它們；…`，筆數與 `doctor` 的 `vector coverage` 那行相同，`--json` 則多 `data.vector_missing`。照 `doctor` 印出的修法補上即可，現在補或留到收尾都可以。語意召回沒啟用、覆蓋率無法量測（遠端 libSQL、helper 被覆寫）、沒有缺口，或向量庫讀不到時都不會多這一行；寫入本身與結束碼都不受影響。

以 `--verify` 寫入的是狀態類記憶，也就是可能過時的快照。recall 會在該 hit 下方印出 `⟳ 截至 <日期>；據以行動前先跑：<命令>`，`--json` 與 `/v1/recall` 以 `verify` 欄位帶出；brief 在列出它的每個區塊、該項下方加一行 `截至 <日期>；據以行動前先跑 <命令>`，並在統計行之後加一行固定說明：Memoria 不執行命令，只有唯讀檢查才該跑。命令完整顯示、從不執行，由讀到的 agent 決定要不要跑。截至日期是該記憶的 UTC 日期。`--verify` 必須是單行、非空、不含控制字元的命令（Tab 可以，Unicode 換行字元會被拒絕），且不能與 `--durable` 並用，寫入時與之後用 `mark` 都一樣（把長期約束與快照拆成兩則）。

recall 的人讀輸出會說明查得少的原因。筆數那行下方出現 `- 語意查詢有執行，沒有命中；列出的是字面查詢的結果`，表示 `--mode vector` 確實跑了、語意索引沒有提供任何記憶（請看這一行或 `vector_hits`，不要看 `route_mode`：它的標籤是在去掉被取代的記憶之前決定的）；出現 `- 這個 project 沒有任何記憶：<名稱>；已登記的名稱見 \`memoria repo list\``，表示 `--project` 指的名稱底下完全沒有記憶，查不到不是因為沒有相關的。relevance 低於 0.3 的命中只和查詢共用一兩個字，標成 `[0.250 弱命中]`，仍照常回傳；只靠語意索引找到的命中印 `n/a`，不標示：它沒有字面分數可顯示，不代表分數低。`--json` 以 `meta.vector_hits` 與 `meta.project_known` 帶出前兩項。

`recall --json` 輸出 `MemoriaResult` 信封 `{ok, data, meta}`。`data` 是命中陣列，每筆有 `id`（`feedback --hits` 要填的值）、`session_id`、`type`、`project`、`timestamp`、`snippet` 與 `score`；`score` 決定排序，不是 0–1 的比對品質。`relevance`（0–1 的字面比對分數）除了只靠語意索引找到的命中以外，每筆都有；`source`、`verify` 等其他欄位在適用時出現。`meta` 帶 `recall_id`、`route_mode`、`confidence` 與 `confidence_basis`；首位命中只來自語意索引時，`confidence` 為 `null`、basis 為 `unavailable`。人讀輸出把 `recall_id` 印在最後一行。

`feedback` 把 `--score` 記在這次 recall 上，`--hits` 決定效用歸到哪些記憶；不帶 `--hits` 時任何記憶的效用都不變，只是測試的 recall 就這樣回報。`--used` 為相容而保留，不影響寫入。

在已註冊 repository 內執行 `brief`，會自動辨識專案並寫入 `knowledge/BRIEF-<project>.md`；明確指定 `--project` 仍寫 `BRIEF.md`，`--global` 則選取所有專案。正文的範圍行會顯示產生時間，因為以 `@` 引入 brief 的 host 看不到開頭的註解。Durable 記憶會列在不受 `--days`、`--top-k` 限制的固定區塊，被取代的記憶會排除。近期決策的 `--top-k` 格數由各專案輪流分配，最近活躍的專案優先。project 不屬於任何已註冊 repository 的記憶會隨各專案的 brief 載入。依 `brief` 輸出，在 `AGENTS.md` 設定讀取指令；Claude 的 `CLAUDE.md` 以 `@AGENTS.md` 與 brief 路徑載入。記憶更新後重新產生 brief。詳見 [Operations](OPERATIONS.md#context-injection-via-briefmd)。

Repository 狀態區塊會說明哪個 repository 該跑 `repo sync`。`未掃描 commit: N` 只算上次 sync 之後、登記的預設分支與 tag 上的提交，還沒合併的分支不算；沒有登記預設分支，或本機沒有這個分支時，和 `repo sync` 一樣算所有分支。`未掃描 tag: <名稱>` 列出還沒被 sync 看過的 tag，依 tag 的日期由新到舊（輕量 tag 用它指向的提交的日期），最多列 3 個，超過時加「等 N 個」寫總數。`--json` 以 `repositories[].unscanned_commits` 與 `unscanned_tags` 帶出。`repo sync` 本身照樣掃描所有分支。登記的預設分支不是實際合併的分支時，用 `memoria repo add <path> --default-branch <分支>` 重新登記；目前登記的分支可用 `repo list` 查看。

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
