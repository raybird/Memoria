#!/bin/bash
# AI Agent 持久化記憶系統 - 快速安裝腳本

set -euo pipefail

NO_GIT=0
MINIMAL_MODE=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --no-git)
            NO_GIT=1
            ;;
        --minimal)
            MINIMAL_MODE=1
            NO_GIT=1
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./install.sh [--no-git] [--minimal]"
            exit 1
            ;;
    esac
    shift
done

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

tool_version() {
    if has_cmd "$1"; then
        "$1" --version 2>/dev/null | head -n1 || echo "available"
    else
        echo "missing"
    fi
}

echo "=================================="
echo "AI Agent 持久化記憶系統"
echo "快速安裝腳本 v1.0"
echo "=================================="
echo ""

# 配置路徑 - 使用腳本所在目錄作為安裝目錄
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
INSTALL_DIR="$SCRIPT_DIR"
MEMORY_DIR="$INSTALL_DIR/.memory"
KNOWLEDGE_DIR="$INSTALL_DIR/knowledge"
SCRIPTS_DIR="$INSTALL_DIR/scripts"
CONFIGS_DIR="$INSTALL_DIR/configs"

# 檢測系統
OS="$(uname -s)"
case "${OS}" in
    Linux*)     OS_TYPE=Linux;;
    Darwin*)    OS_TYPE=Mac;;
    MINGW*|CYGWIN*)     OS_TYPE=Windows;;
    *)          OS_TYPE="UNKNOWN:${OS}"
esac

echo "檢測到系統: $OS_TYPE"
echo ""

echo "[preflight] 依賴檢查"
echo "- node:   $(tool_version node)"
echo "- pnpm:   $(tool_version pnpm)"
echo "- npm:    $(tool_version npm)"
echo "- git:    $(tool_version git)"
echo "- unzip:  $(tool_version unzip)"
echo "- python3:$(tool_version python3)"
echo ""

if ! has_cmd node; then
    echo "✗ 缺少 Node.js，無法安裝 Memoria CLI"
    echo "  下一步：安裝 Node.js >= 18 後，重新執行 ./install.sh"
    exit 1
fi

# 步驟 1: 創建目錄結構
echo "[1/7] 創建目錄結構..."
mkdir -p "$MEMORY_DIR"/{sessions,checkpoints,exports}
mkdir -p "$KNOWLEDGE_DIR"/{Projects/{Active,Archive,Templates},Daily,Skills,Decisions,Resources}
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$CONFIGS_DIR"/{gemini,opencode,global}

echo "✓ 目錄結構已創建"
echo ""

# 步驟 2: 初始化 Git
echo "[2/7] 初始化 Git 倉庫..."
cd "$INSTALL_DIR"
if [ "$NO_GIT" -eq 1 ] || ! has_cmd git; then
    echo "⚠ 跳過 Git 初始化（--no-git 或系統無 git）"
    echo "  你可稍後手動執行: git init"
elif [ ! -d ".git" ]; then
    git init
    
    # 創建 .gitignore
    cat > .gitignore << 'EOF'
# 忽略大型二進制文件
.memory/sessions.db
.memory/sessions.db-journal

# 忽略臨時文件
*.tmp
*.log
*.swp
.DS_Store

# 忽略敏感配置
configs/secrets.yaml
**/secrets/

# 忽略導出文件
.memory/exports/**/*.json

# Node 依賴
node_modules/
EOF
    
    git add .gitignore
    git commit -m "Initial commit: AI Memory System setup" || \
      echo "⚠ Git commit 失敗（可能尚未設定 user.name/user.email），可稍後手動提交"
    echo "✓ Git 倉庫已初始化"
else
    echo "✓ Git 倉庫已存在"
fi
echo ""

# 步驟 3: 創建全局配置
echo "[3/7] 創建全局配置文件..."

cat > "$CONFIGS_DIR/global/preferences.yaml" << 'EOF'
# 全局用戶偏好設置

user_profile:
  name: "Your Name"  # 修改為你的名字
  role: "Developer"   # 修改為你的角色
  timezone: "Asia/Taipei"
  
coding_preferences:
  language: "TypeScript"
  style: "Project conventions"
  editor: "VSCode"
  
communication:
  tone: "professional yet friendly"
  verbosity: "concise"
  language: "繁體中文"
  
memory_settings:
  auto_compress: true
  compression_threshold: 0.8  # 80% 上下文使用率
  checkpoint_interval: 50     # 每 50 個事件
  max_context_tokens: 8000
  
skill_learning:
  auto_extract: true
  min_success_rate: 0.7
  review_frequency: "weekly"
EOF

echo "✓ 全局配置已創建: $CONFIGS_DIR/global/preferences.yaml"
echo ""

# 步驟 4: 設置 Gemini CLI（如果已安裝）
echo "[4/7] 配置 Gemini CLI..."
if command -v gemini &> /dev/null; then
    GEMINI_DIR="$HOME/.gemini"
    mkdir -p "$GEMINI_DIR"
    
    cat > "$GEMINI_DIR/GEMINI.md" << 'EOF'
# Gemini CLI 全局記憶

## 系統提示
你是一個持續學習的 AI 助手，擁有跨會話的持久記憶能力。

### 核心能力
1. **記憶系統**：你能記住所有對話、決策和學習
2. **技能成長**：你從經驗中學習，生成可重用的技能
3. **上下文整合**：你能檢索和整合跨會話的知識
4. **決策追蹤**：你記錄所有重要決策及其理由

### 工作原則
- 每次會話開始時，檢索相關的歷史上下文
- 識別並記錄重要決策
- 會話結束時，總結關鍵學習點
- 從失敗中學習，更新相關技能

### 記憶檢索指南
當用戶提到 "上次"、"之前"、"記得嗎" 時，主動檢索相關記憶。
將記憶自然融入對話，標注來源和時間。

### 技能應用
1. 檢索相關技能
2. 評估適用性
3. 應用或調整方法
4. 驗證結果
5. 更新技能（如有改進）

## 記憶系統路徑
記憶存儲: $MEMORIA_HOME/.memory
知識庫: $MEMORIA_HOME/knowledge

## 用戶偏好
[自動從 $MEMORIA_HOME/configs/global/preferences.yaml 載入]

---
最後更新: $(date +%Y-%m-%d)
EOF
    
    echo "✓ Gemini CLI 配置已創建"
else
    echo "⚠ Gemini CLI 未安裝，跳過配置"
fi
echo ""

# 步驟 5: 設置 CLI 运行時（TypeScript）
echo "[5/7] 設置 CLI 运行時..."

if has_cmd pnpm; then
    echo "- 檢測到 Node.js + pnpm，安裝 TypeScript CLI 依賴..."
    pnpm install
    INSTALLER_PM="pnpm"
elif has_cmd npm; then
    echo "- 未檢測到 pnpm，改用 npm 安裝依賴（fallback）..."
    npm install
    INSTALLER_PM="npm"
    echo "⚠ 建議之後安裝 pnpm：corepack enable && corepack prepare pnpm@10 --activate"
else
    echo "✗ 找不到 pnpm 或 npm，無法安裝 TypeScript CLI 依賴"
    echo "  下一步：安裝 npm（通常跟隨 Node.js）或安裝 pnpm"
    exit 1
fi

CLI_RUNTIME_MODE="source"
if [ "$INSTALLER_PM" = "pnpm" ]; then
    if pnpm run build; then
        CLI_RUNTIME_MODE="dist"
        echo "✓ 已產出 dist/cli.mjs（可脫離 pnpm/tsx 執行）"
    else
        echo "⚠ 建置 dist 失敗，將使用 source 模式執行"
    fi
else
    if npm run build; then
        CLI_RUNTIME_MODE="dist"
        echo "✓ 已產出 dist/cli.mjs（可脫離 pnpm/tsx 執行）"
    else
        echo "⚠ 建置 dist 失敗，將使用 source 模式執行"
    fi
fi

if [ "$MINIMAL_MODE" -eq 1 ]; then
    echo "⚠ minimal 模式：僅保證最小可用流程（init/sync/stats/doctor）"
fi

if [ -f "$INSTALL_DIR/cli" ]; then
    chmod +x "$INSTALL_DIR/cli" || true
fi
echo "✓ TypeScript CLI 已就緒"
# 步驟 6: 創建自動化 hooks
echo "[6/7] 創建自動化 hooks..."

cat > "$SCRIPTS_DIR/post-session-hook.sh" << 'EOF'
#!/bin/bash
# AI Agent 會話結束後自動執行

set -e

MEMORIA_HOME="${MEMORIA_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LATEST_SESSION=$(ls -t "$MEMORIA_HOME"/.memory/sessions/*.json 2>/dev/null | head -n1 || true)

if [ -n "$LATEST_SESSION" ]; then
    echo "正在同步最新會話: $LATEST_SESSION"

    if [ -x "$MEMORIA_HOME/cli" ]; then
        (cd "$MEMORIA_HOME" && MEMORIA_HOME="$MEMORIA_HOME" ./cli sync "$LATEST_SESSION")
    else
        echo "✗ 找不到可執行的 TypeScript CLI，無法同步"
        exit 1
    fi
    
    # Git 提交
    if command -v git >/dev/null 2>&1 && [ -d "$MEMORIA_HOME/.git" ]; then
        cd "$MEMORIA_HOME"
        git add .
        git commit -m "Auto-sync: $(date '+%Y-%m-%d %H:%M:%S')" || true
    fi
    
    echo "✓ 同步完成"
else
    echo "⚠ 未找到新會話"
fi
EOF

chmod +x "$SCRIPTS_DIR/post-session-hook.sh"
echo "✓ Post-session hook 已創建"
echo ""

# 步驟 7: 初始化資料庫
echo "[7/7] 初始化資料庫..."
if [ -x "$INSTALL_DIR/cli" ]; then
    (cd "$INSTALL_DIR" && MEMORIA_HOME="$INSTALL_DIR" ./cli init)
    echo "✓ (TypeScript) 資料庫已初始化"
else
    echo "⚠ 資料庫初始化失敗，請手動運行:"
    echo "   cd $INSTALL_DIR && MEMORIA_HOME=$INSTALL_DIR ./cli init"
fi
echo ""

# 創建使用指南
echo "=================================="
echo "安裝完成！ 🎉"
echo "=================================="
echo ""
echo "📁 安裝目錄: $INSTALL_DIR"
echo "🌐 建議環境變數: export MEMORIA_HOME=\"$INSTALL_DIR\""
echo ""
echo "接下來的步驟:"
echo ""
echo "1. 編輯全局配置:"
echo "   vim $CONFIGS_DIR/global/preferences.yaml"
echo ""
echo "2. (可選) 安裝 Obsidian:"
echo "   https://obsidian.md/download"
echo "   然後打開 $KNOWLEDGE_DIR 作為 Vault"
echo ""
echo "3. 開始使用 AI Agent:"
echo "   - Gemini CLI: gemini"
echo "   - OpenCode: 配置 config.toml 指向 $MEMORY_DIR"
echo "   - 依賴安裝器: $INSTALLER_PM"
echo "   - CLI 執行模式: $CLI_RUNTIME_MODE"
echo ""
echo "4. 測試記憶系統:"
echo "   與 AI 對話並說 '記住：我偏好 TypeScript CLI'"
echo "   結束會話後，運行:"
echo "   $SCRIPTS_DIR/post-session-hook.sh"
echo ""
echo "5. 查看記憶:"
echo "   檢查 $KNOWLEDGE_DIR/Daily/$(date +%Y-%m-%d).md"
echo ""
echo "=================================="
echo "提示："
echo "- 將 post-session-hook.sh 添加到你的 AI tool 配置"
echo "- 定期備份 $INSTALL_DIR"
echo "- 閱讀完整文檔: $INSTALL_DIR/PERSISTENT_MEMORY_SYSTEM_SPEC.md"
echo "=================================="
