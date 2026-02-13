# 🧠 AI Agent 持久化記憶系統

> **讓你的 AI Agent 擁有真正的記憶和成長能力**

一個完全開源、免費、可自托管的 AI 記憶系統，適用於 Gemini CLI、OpenCode、Codex 等任何 CLI-based AI agent。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-green.svg)]()

---

## ✨ 特點

- ✅ **跨會話記憶**：記住所有對話、決策、學習
- ✅ **持續成長**：從經驗中學習，自動生成可重用技能
- ✅ **知識整合**：統一管理代碼、文檔、筆記
- ✅ **完全開源**：所有組件 100% 免費、可自托管
- ✅ **隱私優先**：所有數據本地存儲，完全掌控
- ✅ **工具無關**：支援任何 AI agent（Gemini、OpenCode、Codex...）

---

## 🎯 這能解決什麼問題？

### ❌ 傳統 AI Agent 的限制

```
Session 1:
You: "我們用 PostgreSQL，port 5432，使用 JWT 認證"
AI: "好的，記住了"

Session 47 (三個月後):
You: "修復資料庫連接問題"
AI: "可以告訴我你用什麼資料庫嗎？" ❌
```

### ✅ 使用記憶系統後

```
Session 1:
You: "我們用 PostgreSQL，port 5432，使用 JWT 認證"
AI: "好的，記住了" [自動保存到持久記憶]

Session 47 (三個月後):
You: "修復資料庫連接問題"
AI: "我看到你使用 PostgreSQL on port 5432 with JWT auth。
     三個月前我們處理過類似問題，使用了連接池優化。
     讓我檢查是否是相同的情況..." ✅
```

---

## 🚀 快速開始

> **注意**: 本系統預設安裝在專案目錄本身。執行 `install.sh` 後,所有記憶資料將存放在此專案的 `.memory/` 和 `knowledge/` 目錄中。

### 方法一：自動安裝（推薦）

```bash
# 1. Clone 或下載此專案
git clone https://github.com/raybird/Memoria Memoria
cd Memoria
# 2. 執行安裝
./install.sh

# 3. 完成！系統已就緒
```

### 方法二：手動安裝

```bash
# 1. Clone 專案
git clone https://github.com/raybird/Memoria Memoria
cd Memoria

# 2. 創建目錄
mkdir -p .memory/{sessions,checkpoints,exports}
mkdir -p knowledge/{Projects/{Active,Archive,Templates},Daily,Skills,Decisions,Resources}
mkdir -p scripts configs/{gemini,opencode,global}

# 3. 安裝 CLI 依賴（TS 模式）
pnpm install

# 4. 初始化（TypeScript CLI）
MEMORIA_HOME=$(pwd) ./cli init

# 5. 配置你的 AI tool
# 詳見下方「工具配置」章節

# 6. 快速測試同步（可選）
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json

# 7. 先預覽同步結果（不寫入檔案）
MEMORIA_HOME=$(pwd) ./cli sync --dry-run examples/session.sample.json

# 8. （可選）啟用 MCP/libSQL 自動增強同步
LIBSQL_URL="file:/path/to/memory-tool.db" \
  bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh \
  examples/session.sample.json
```

---

## 🔧 工具配置

> **重要**: 請先設定環境變數 `MEMORIA_HOME` 指向此專案目錄,以便後續配置使用。
> 
> ```bash
> # 在 ~/.zshrc 或 ~/.bashrc 中添加
> export MEMORIA_HOME="/path/to/Memoria"  # 替換為實際路徑
> source ~/.zshrc  # 或 source ~/.bashrc
> ```

### Gemini CLI

> 註：Gemini CLI 版本之間配置方式可能不同。建議使用本專案模板，避免手寫舊設定。

1. 複製 MCP 模板：`skills/memoria-memory-sync/resources/mcp/gemini-cli.mcp.json`
2. 將 `LIBSQL_URL` 改為你的實際資料庫路徑
3. 貼到你的 Gemini CLI MCP 設定位置
4. 會話結束後可執行：`$MEMORIA_HOME/scripts/post-session-hook.sh`

若你只想先啟用本地記憶（不接 MCP），仍可使用：

```bash
cp $MEMORIA_HOME/configs/gemini/GEMINI.md ~/.gemini/
gemini
```

### OpenCode

> 註：OpenCode 版本之間配置格式可能不同。建議優先使用本專案提供的 MCP 模板，而不是手寫舊版 `toml` 節點。

1. 複製模板：`skills/memoria-memory-sync/resources/mcp/opencode.mcp.json`
2. 將 `LIBSQL_URL` 改為你的實際資料庫路徑
3. 貼到你的 OpenCode MCP 設定位置

模板內容如下：

```json
{
  "mcpServers": {
    "mcp-memory-libsql": {
      "command": "npx",
      "args": ["-y", "mcp-memory-libsql"],
      "env": {
        "LIBSQL_URL": "file:/path/to/your/database.db"
      }
    }
  }
}
```

### `mcp-memory-libsql` 在本專案的用途

在這個架構中，`mcp-memory-libsql` 是「**語意增強層**」，不是取代 Memoria 的主儲存。

- **Memoria（主流程）**：負責 `init/sync/stats`、SQLite 持久化、以及 `knowledge/` markdown 輸出。
- **mcp-memory-libsql（增強流程）**：負責 entities/relations、語意檢索、圖關聯查詢。
- **整合原則**：先用 Memoria 落地本地記憶，再自動 ingest 到 MCP/libSQL 做進階檢索。
- **可選啟用**：只有設定 `LIBSQL_URL` 時才會啟用增強；沒設定時 Memoria 仍可獨立運作。

### Agent Skill（agentskills.io）

本專案已提供可直接使用的 skill：

- `skills/memoria-memory-sync/SKILL.md`
- 參考資料：`skills/memoria-memory-sync/references/REFERENCE.md`
- MCP 模板：`skills/memoria-memory-sync/resources/mcp/`

若你已安裝 `mcp-memory-libsql`，可用自動模式把本地記憶同步後再送入 MCP：

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

這個流程會自動：

1. 先執行 Memoria `init/sync/stats`
2. 產生橋接資料到 `.memory/exports/mcp-bridge/`
3. 啟動 `mcp-memory-libsql` 並呼叫 `create_entities` / `create_relations`

可直接使用的模板與操作文件：

- Gemini/OpenCode MCP 配置模板：`skills/memoria-memory-sync/resources/mcp/`
- 自動 ingest 說明：`skills/memoria-memory-sync/resources/mcp/INGEST_PLAYBOOK.md`


### 其他工具

對於任何支援系統提示（system prompt）的 AI tool：

1. 將 `PERSISTENT_MEMORY_SYSTEM_SPEC.md` 中的「系統提示」部分複製到工具的配置
2. 設置會話導出路徑為 `$MEMORIA_HOME/.memory/sessions/`
3. 配置 post-session hook 運行 `post-session-hook.sh`

---

## 📚 使用範例

### 範例 1：跨會話記憶

```bash
# Day 1
You: "幫我設計一個 RESTful API，用於用戶認證"
AI: "好的，我建議使用 JWT... [詳細設計]"
    [自動記錄決策：使用 JWT 而非 Session]

# Day 30
You: "為什麼我們當初選 JWT？"
AI: "在第 1 天的會話中，我們決定使用 JWT 而非 Session-based 認證，
     主要考慮因素是：1) 無狀態設計 2) 水平擴展性 3) 跨域支援"
```

### 範例 2：技能學習與重用

```bash
# 第一次遇到問題
You: "API 返回 CORS 錯誤"
AI: "讓我幫你解決..." [成功解決]
    [自動提取技能：CORS 問題排查方法]

# 兩個月後，新專案
You: "新專案也遇到 CORS 問題"
AI: "我記得之前處理過類似問題。根據之前學習的技能：
     1. 檢查 Access-Control-Allow-Origin
     2. 驗證預檢請求
     3. 確認 credentials 設置
     讓我幫你逐步檢查..."
```

### 範例 3：專案上下文管理

```bash
# 專案 A
cd ~/project-a
gemini
You: "這個專案用 React + Django"
AI: "了解，已記錄專案架構"

# 切換到專案 B
cd ~/project-b
gemini
AI: "檢測到專案切換。
     Project B 上下文已載入：
     - 技術棧：Vue + FastAPI
     - 最後活動：2025-02-10
     - 待辦：完成用戶註冊功能"
```

---

## 📁 文件系統結構

```
$MEMORIA_HOME/
├── .memory/                      # 記憶核心
│   ├── sessions.db              # SQLite 資料庫
│   ├── events.jsonl             # 事件日誌
│   ├── sessions/                # 會話導出
│   └── checkpoints/             # 上下文檢查點
│
├── knowledge/                    # Obsidian Vault
│   ├── Projects/                # 專案筆記
│   ├── Daily/                   # 每日筆記
│   │   └── 2025-02-13.md
│   ├── Skills/                  # 技能庫
│   │   ├── debugging-patterns.md
│   │   └── api-design-principles.md
│   ├── Decisions/               # 決策日誌
│   └── Resources/               # 參考資料
│
├── configs/                      # 配置文件
│   ├── gemini/GEMINI.md
│   ├── opencode/config.toml
│   └── global/preferences.yaml
│
├── scripts/                      # 自動化腳本
│   ├── post-session-hook.sh
│   └── test-smoke.sh
├── skills/                       # Agent Skills
│   └── memoria-memory-sync/
│       ├── SKILL.md
│       ├── references/REFERENCE.md
│       ├── resources/mcp/
│       └── scripts/
│           ├── run-sync-with-enhancement.sh
│           ├── build-mcp-bridge-payload.mjs
│           ├── build-mcp-tool-requests.mjs
│           └── ingest-mcp-libsql.mjs
├── src/                          # TypeScript CLI 原始碼
│   └── cli.ts
├── cli                           # TS CLI 入口（執行 memoria 指令）
├── package.json                  # TS 依賴與腳本
│
└── README.md                     # 本文件
```

---

## 🎨 進階功能

### 1. 上下文壓縮

當上下文接近限制時，系統自動：
- 保留最近 20 條消息（完整）
- 壓縮中期對話為摘要
- 保留所有關鍵決策和技能（完整）
- 創建檢查點以便恢復

```bash
# 手動創建檢查點
You: "/checkpoint"
AI: "檢查點已創建：checkpoint_20250213_143026"

# 恢復到檢查點
You: "/restore checkpoint_20250213_143026"
AI: "已恢復到指定狀態"
```

### 2. 技能管理

```bash
# 列出所有技能
ls $MEMORIA_HOME/knowledge/Skills/

# 查看技能使用統計
sqlite3 $MEMORIA_HOME/.memory/sessions.db \
  "SELECT name, use_count, success_rate FROM skills ORDER BY use_count DESC"

# 手動創建技能
vim $MEMORIA_HOME/knowledge/Skills/my-new-skill.md
```

### 3. 與 Obsidian 整合

```bash
# 1. 下載 Obsidian
# https://obsidian.md/download

# 2. 打開 Vault
# File -> Open Vault -> $MEMORIA_HOME/knowledge

# 3. 推薦插件
# - Dataview（數據查詢）
# - Calendar（日曆視圖）
# - Git（自動同步）
# - Excalidraw（圖表）
```

### 4. 備份與恢復

```bash
# 創建備份
tar -czf ai-memory-backup-$(date +%Y%m%d).tar.gz $MEMORIA_HOME

# 恢復備份
tar -xzf ai-memory-backup-20250213.tar.gz -C ~/
```

---

## 📊 系統監控

### 查看記憶統計

```bash
# TS CLI（推薦）
MEMORIA_HOME=$MEMORIA_HOME ./cli stats
```

### 健康檢查

```bash
# 檢查資料庫完整性
sqlite3 $MEMORIA_HOME/.memory/sessions.db "PRAGMA integrity_check"

# 檢查磁碟使用
du -sh $MEMORIA_HOME

# 檢查最近活動
ls -lt $MEMORIA_HOME/knowledge/Daily/ | head -5
```

---

## 🔒 隱私與安全

### 數據保護

- ✅ 所有數據本地存儲，不上傳雲端
- ✅ 使用 Git 版本控制，可隨時回溯
- ✅ 敏感文件可使用 GPG 加密
- ✅ 通過文件系統權限控制訪問

### 安全最佳實踐

```bash
# 1. 設置文件權限
chmod 700 $MEMORIA_HOME/.memory
chmod 600 $MEMORIA_HOME/.memory/sessions.db

# 2. 添加到 .gitignore
echo "configs/secrets.yaml" >> $MEMORIA_HOME/.gitignore

# 3. 加密備份（可選）
tar -czf - $MEMORIA_HOME | gpg -c > backup.tar.gz.gpg

# 4. 定期審查記憶內容
grep -r "password\|secret\|api_key" $MEMORIA_HOME/knowledge/
```

### 開源分享前檢查清單

- [ ] `knowledge/Daily/` 未被提交（預設已 ignore）
- [ ] `knowledge/Decisions/` 與 `knowledge/Skills/` 內容未被提交（預設已 ignore）
- [ ] `.memory/sessions/*.json` 與 `.memory/events.jsonl` 未被提交
- [ ] `.memory/exports/mcp-bridge/*.json` 未被提交
- [ ] `.env*`、`configs/secrets.yaml` 不含任何真實憑證
- [ ] 對外示例已去識別化（移除個資、客戶名、內網 URL）

---

## 🛠️ 故障排除

### 問題：資料庫鎖定

```bash
# 解決方法：關閉所有使用資料庫的程序
lsof $MEMORIA_HOME/.memory/sessions.db
# 然後 kill 相關進程
```

### 問題：同步腳本失敗

```bash
# 檢查 CLI 可執行檔與依賴
ls -la $MEMORIA_HOME/cli
pnpm install

# 先做 dry-run 驗證輸入
MEMORIA_HOME=$MEMORIA_HOME ./cli sync --dry-run examples/session.sample.json
```

### 問題：MCP/libSQL 自動增強失敗

```bash
# 1. 檢查 libSQL 連線設定
echo "$LIBSQL_URL"

# 2. 驗證 mcp-memory-libsql 可啟動
npx -y mcp-memory-libsql

# 3. 重新跑自動增強流程
LIBSQL_URL="file:/path/to/memory-tool.db" \
  bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh \
  examples/session.sample.json
```

### 問題：Gemini 沒有載入記憶

```bash
# 檢查 GEMINI.md 是否存在
ls -la ~/.gemini/GEMINI.md

# 重新載入配置
source ~/.zshrc
```

---

## 📖 完整文檔

- **系統規格**: `PERSISTENT_MEMORY_SYSTEM_SPEC.md`
- **安全政策**: `SECURITY.md`
- **變更記錄**: `CHANGELOG.md`
- **授權條款**: `LICENSE`
- **API 文檔**: 見 `docs/API.md`（如有）
- **架構設計**: 見 `docs/ARCHITECTURE.md`（如有）

---

## 🤝 貢獻

歡迎貢獻！請：

1. Fork 這個倉庫
2. 創建你的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 開啟 Pull Request

---

## 📝 授權

MIT License - 詳見 LICENSE 文件

---

## 🌟 致謝

靈感來源：
- [Letta (MemGPT)](https://github.com/letta-ai/letta) - 持久記憶架構
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) - 事件流設計
- [Obsidian](https://obsidian.md) - 知識管理理念
- [Mem0](https://github.com/mem0ai/mem0) - 記憶系統設計

---

## 📞 聯繫

- 問題回報：[GitHub Issues](https://github.com/raybird/Memoria/issues)
- 討論區：[GitHub Discussions](https://github.com/raybird/Memoria/discussions)

---

**讓你的 AI Agent 真正記住你、理解你、陪伴你成長！** 🚀

---

## 🎯 快速檢查清單

安裝完成後，確認以下項目：

- [ ] 目錄結構已創建
- [ ] Git 倉庫已初始化
- [ ] 資料庫已初始化
- [ ] Gemini CLI 配置已設置（如適用）
- [ ] 測試過一次完整的會話 -> 同步流程
- [ ] 在 Obsidian 中看到每日筆記
- [ ] 設置了自動備份（可選）

全部完成？恭喜！你現在擁有一個會成長的 AI 助手了！ 🎉
