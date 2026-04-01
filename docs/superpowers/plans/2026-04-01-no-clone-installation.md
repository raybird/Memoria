# No-Clone Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者或 AI 可以在不 `git clone` 此 repo 的情況下，下載發行產物、完成 `memoria setup --serve --json`，並成功使用 `remember` / `recall` API。

**Architecture:** 先不碰 npm publish，採用最小風險的 release artifact 路線：CI 產生可獨立執行的 CLI 發行物與安裝腳本，安裝腳本將產物部署到目標目錄；CLI 的 `setup`/runtime 路徑邏輯改為以安裝目錄為中心，而非 repo root。驗證以一條新的 no-clone E2E 腳本為核心，確保乾淨暫存目錄中只有 release artifact 也能完成 bootstrap。

**Tech Stack:** TypeScript CLI, esbuild, Node.js 18+, bash installer, GitHub Actions release artifacts, existing smoke/bootstrap test scripts.

---

## Phase 1 Platform Boundary

- 第一階段先只承諾 **Linux x64** release artifact，可與目前開發/CI 環境一致。
- 若要支援 macOS / arm64 / Windows，必須另開 matrix build 與對應 artifact 驗證，不納入本計畫的最小交付。
- 文件、artifact 命名、installer 提示都必須明確標出此平台邊界，避免「安裝成功但執行失敗」。

## File Structure

**Create:**
- `docs/superpowers/plans/2026-04-01-no-clone-installation.md` - 本計畫文件。
- `scripts/test-no-clone-install.sh` - 驗證「沒有 repo 原始碼樹」時的安裝與啟動流程。
- `scripts/package-release-artifacts.sh` - 產生 release 用 CLI 單檔與 installer payload。
- `scripts/render-no-clone-fixture.mjs` 或等價 helper - 在測試期間即時產生最小 session JSON，避免依賴 repo fixture。
- `dist/install/memoria` 或等價 launcher 輸出路徑 - 安裝後執行入口。

**Modify:**
- `src/cli.ts` - 將 `setup` 與 runtime 路徑解析從 repo 模式拆成安裝模式。
- `cli` - 重新定義為 repo 開發用 launcher，並與 release launcher 的責任切開。
- `install.sh` - 改成可下載/部署 release artifact，而不是假設 repo 已存在。
- `.github/workflows/ci.yml` - 新增 artifact packaging 與 no-clone E2E 驗證。
- `README.md` - 加入 no-clone 安裝路徑。
- `docs/INSTALL.md` - 說明 release artifact 安裝模式。
- `RELEASE.md` - 補 release artifact 建置與 no-clone 驗證步驟。
- `package.json` - 視需要補 packaging script，但暫不解除 `private`。

**Existing references to read while implementing:**
- `src/cli.ts:564-647` - 目前 `setup` 流程。
- `cli:1-25` - repo 內 launcher 行為。
- `README.md:5-46` - 現有 clone-first 安裝流程。
- `scripts/test-bootstrap.sh:1-115` - 目前 bootstrap 驗證基準。
- `RELEASE.md:7-116` - 發版 SOP。

## Delivery Rules

- 先做 release artifact 路線，不做 npm publish。
- 保留 repo 開發模式，不能破壞 `./cli` 在 repo root 的既有體驗。
- no-clone 模式只要求 Node.js 與下載能力，不要求原始碼樹存在。
- `setup --serve --json` 的輸出格式不可改壞，避免破壞既有 agent automation。
- 新增驗證必須在 CI 可重複執行，不依賴手動 release。

## Task 1: Define Installable Runtime Boundary

**Files:**
- Modify: `src/cli.ts`
- Modify: `cli`
- Test: `bash scripts/test-bootstrap.sh`

- [ ] **Step 1: 寫下失敗情境與目標邊界**

在工作筆記或 commit 說明先明確記錄：
- repo mode: `./cli ...` 在 repo root 可正常運作。
- install mode: 只有 release artifact + installer 時也可運作。
- `setup` 不得再依賴 `src/`, `package.json`, `.git`, `node_modules` 原始碼樹存在。

- [ ] **Step 2: 找出 `src/cli.ts` 內所有 repo 假設**

檢查以下類型的程式碼：
- `getProjectRoot()` / `process.cwd()` / `import.meta.url` 路徑假設。
- `setup` 階段對 `pnpm install`、`node_modules` 的依賴。
- 任何顯示給使用者的 repo-root 路徑提示。

Expected outcome:
- 列出哪些邏輯屬於 repo development only。
- 列出哪些邏輯應改成 install runtime only。

- [ ] **Step 3: 實作 runtime mode 判定的最小介面**

在 `src/cli.ts` 加入一個最小 helper，類似：

```ts
type RuntimeLayout = {
  mode: 'repo' | 'installed'
  runtimeRoot: string
  canSelfInstallDeps: boolean
}
```

判定原則：
- 若相鄰有 repo 特徵檔案（例如 `package.json`, `src/cli.ts`），視為 `repo`。
- 否則視為 `installed`。

- [ ] **Step 4: 讓 `setup` 在 installed mode 不跑 repo install 流程**

最小實作目標：
- `repo` mode: 仍可做 `pnpm install` 補依賴。
- `installed` mode: 直接略過這一步，因為 release artifact 應已自含可執行內容。

- [ ] **Step 5: 驗證既有 bootstrap 流程未壞**

Run: `bash scripts/test-bootstrap.sh`

Expected:
- PASS
- `setup --json` 在 repo mode 仍可正常完成

## Task 2: Package a No-Clone Release Artifact

**Files:**
- Create: `scripts/package-release-artifacts.sh`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Test: `pnpm run build`

- [ ] **Step 1: 定義 release artifact 內容**

最小發行包建議包含：
- `dist/cli.mjs`
- 一個 release launcher，例如 `memoria`
- `install.sh`
- `better-sqlite3` 的可用 runtime 載入方案
- 必要的說明檔或版本 metadata

第一階段 artifact 命名應直接反映平台，例如：
- `memoria-linux-x64-vX.Y.Z.tar.gz`

不要把整個 repo 打包進去。

- [ ] **Step 2: 明確處理 `better-sqlite3` external 依賴**

目前 `pnpm run build` 會保留 `better-sqlite3` 為 external，因此 release artifact 不能只放 `dist/cli.mjs`。

必須在 plan 實作時從下列方案擇一，並只選一種：
- 方案 A: release tarball 內帶入最小 production `node_modules`（至少含 `better-sqlite3`）。
- 方案 B: installer 在目標目錄執行 production-only 安裝。
- 方案 C: 調整 build/distribution 方式，讓 native runtime 依賴有明確可攜策略。

推薦先做 **方案 A**，因為最接近 no-clone 目標，且 CI 最容易穩定驗證。

- [ ] **Step 3: 新增 packaging script**

建立 `scripts/package-release-artifacts.sh`，負責：
- 清理暫存輸出目錄
- 執行 `pnpm run build`
- 組出 release 目錄
- 產生 tarball 或 zip

Script 應明確輸出最終 artifact 路徑與內容樹。

- [ ] **Step 4: 在 `package.json` 補 script 入口**

新增類似：

```json
{
  "scripts": {
    "release:package": "bash scripts/package-release-artifacts.sh"
  }
}
```

- [ ] **Step 5: 在 CI 建置 artifact，但先不自動發 npm**

在 `.github/workflows/ci.yml`：
- 跑完既有 check/build/tests 後
- 執行 `pnpm run release:package`
- upload artifact 供下載與 no-clone 測試使用
- artifact 名稱需帶平台資訊，且本階段只產生 Linux x64 版本

- [ ] **Step 6: 驗證 packaging 可重複執行**

Run:

```bash
pnpm run release:package
pnpm run release:package
```

Expected:
- 兩次都成功
- 產物內容結構一致
- artifact 內含可執行 launcher 與可用的 `better-sqlite3` runtime 依賴

## Task 3: Convert Installer from Repo Bootstrap to Runtime Bootstrap

**Files:**
- Modify: `install.sh`
- Modify: `README.md`
- Modify: `docs/INSTALL.md`
- Test: `bash -n install.sh`

- [ ] **Step 1: 明確切分 installer 責任**

installer 只負責：
- 下載或接收 release artifact
- 解開到目標目錄
- 建立可執行入口
- 提示 `memoria setup --serve --json`

installer 不再負責：
- 建 repo
- 假設 `.git`、`src/` 存在
- 在安裝目錄內把原始碼當 runtime 執行

- [ ] **Step 2: 實作最小可用的 artifact 安裝流程**

最低限度要支援：
- 指定安裝目錄
- 指定 artifact 來源
- 將 CLI artifact 放入該目錄
- 設定 executable bit

如果環境不支援下載，也要能接受「本地 artifact 路徑」作為輸入，方便 CI 測試。

- [ ] **Step 3: 先定義 installer 介面，再動文件**

`install.sh` 至少要先定義：
- `--artifact <path-or-url>`
- `--install-dir <path>`
- `--version <semver-or-tag>`

並明確規範：
- artifact 檔名
- 解壓後目錄結構
- 安裝後 launcher 位置
- CI 如何以本地 tarball 餵給 installer

- [ ] **Step 4: 保留 repo 開發者路徑，但不混在主要安裝說明**

README / INSTALL 文件需要分成兩條：
- Quick install without clone
- Developer setup from repo

- [ ] **Step 5: 驗證 shell syntax 與基本 UX**

Run:

```bash
bash -n install.sh
```

Manual expected checks:
- 幫助訊息不再只講 clone repo
- 安裝目的地與後續啟動命令清楚
- `--artifact` / `--install-dir` 等主要參數有明確說明

## Task 4: Add No-Clone End-to-End Verification

**Files:**
- Create: `scripts/test-no-clone-install.sh`
- Modify: `.github/workflows/ci.yml`
- Test: `bash scripts/test-no-clone-install.sh`

- [ ] **Step 1: 先寫 no-clone 測試腳本骨架**

測試環境應使用：
- 全新 `mktemp -d` 目錄
- 不從 repo root 直接執行 `./cli`
- 只使用上一個 task 產出的 release artifact

- [ ] **Step 2: 定義最小驗證流程**

腳本至少要驗證：

```bash
# install artifact into temp dir
# run memoria setup --serve --json
# poll /v1/health
# POST /v1/remember with a generated minimal session JSON
# POST /v1/recall with a known query
```

Expected:
- 全部 exit 0
- 不依賴 repo 內 `src/` 或 `node_modules`
- 不依賴 repo 內 `examples/session.sample.json`

- [ ] **Step 3: 在腳本內產生 fixture，不引用 repo sample**

測試腳本應在暫存目錄內動態寫出最小 JSON，例如：
- `id`
- `timestamp`
- `project`
- `summary`
- `events[0].type=DecisionMade` 或 `UserMessage`

這樣才能確認 no-clone 測試不會偷吃 repo fixture。

- [ ] **Step 4: 確認測試真正覆蓋 no-clone 條件**

避免假通過：
- 不可以直接呼叫 repo root `./cli`
- 不可以把 repo root 當安裝目錄
- 不可以偷用原始碼樹中的 runtime 路徑
- 不可以讀取 repo 內 `examples/` fixture

- [ ] **Step 5: 驗證安裝後 launcher 真的可直接執行**

腳本需要明確驗證安裝後入口，例如：

```bash
"$INSTALL_DIR/bin/memoria" --help
"$INSTALL_DIR/bin/memoria" setup --serve --json
```

不要只測 `node dist/cli.mjs`。

- [ ] **Step 6: 接進 CI**

在 `.github/workflows/ci.yml` 中：
- 先 build/package artifact
- 再跑 `bash scripts/test-no-clone-install.sh`

- [ ] **Step 7: 驗證舊測試仍成立**

Run:

```bash
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-mcp-e2e.sh
```

Expected:
- 全部 PASS
- 代表 repo mode 與 installed mode 兩條路都可用

## Task 5: Document Product Modes Clearly

**Files:**
- Modify: `README.md`
- Modify: `docs/INSTALL.md`
- Modify: `RELEASE.md`
- Test: `pnpm run release:docs-check`

- [ ] **Step 1: 在 README 明確區分兩種安裝模式**

文件要清楚寫出：
- Self-hosted without clone
- Developer setup from repo

並補一句說明：
- 連既有 server 的 API client 使用方式不屬於本次安裝文件主軸，只需保留現有簡述。

- [ ] **Step 2: 在 INSTALL 文件補完整 no-clone 流程**

至少要包含：
- 前置需求
- 下載 artifact 或安裝腳本
- 安裝目錄說明
- `setup --serve --json`
- 常見失敗排查

- [ ] **Step 3: 在 RELEASE 文件加入 artifact 與 no-clone 驗證**

release SOP 需新增：
- build artifact
- upload/release asset
- no-clone test

- [ ] **Step 4: 驗證文件同步檢查**

Run:

```bash
pnpm run release:docs-check
```

Expected:
- PASS

## Task 6: Release Readiness Gate

**Files:**
- Modify: `RELEASE.md`
- Test: full command checklist below

- [ ] **Step 1: 執行完整驗證清單**

Run:

```bash
pnpm install
pnpm run release:docs-check
pnpm run check
pnpm run build
pnpm run release:package
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
```

Expected:
- 全部 PASS

- [ ] **Step 2: 只在全部綠燈後發版**

release commit 應只包含：
- runtime mode 切分
- artifact packaging
- installer 更新
- no-clone test
- 文件與 changelog

- [ ] **Step 3: Decide release level consistently**

建議版號：
- 若對外新增正式支援的 no-clone 安裝方式，使用 **minor release**。
- 若只完成內部 groundwork、尚未對外承諾安裝入口，維持 **unreleased**。
- 本計畫完成後，不建議以 patch release 發佈，避免低估使用者可見能力變更。

## Risks and Decisions

- **不建議第一階段就做 npm publish**：會同時引入 package exports、發布資產、版本治理問題，超出最小需求。
- **`better-sqlite3` 是第一個必解風險**：只搬 `dist/cli.mjs` 不夠，必須有明確的 native 依賴分發策略。
- **最大風險在路徑假設**：目前 CLI 與 installer 都帶有 repo layout 假設，改動時要用 no-clone E2E 鎖住。
- **不要把 repo launcher 和 installed launcher 混成同一層責任**：兩者生命週期不同，混在一起容易再度耦合到原始碼樹。

## Definition of Done

- 使用者可在未 clone repo 的乾淨目錄安裝 Memoria。
- `memoria setup --serve --json` 在 no-clone 情境可成功。
- `/v1/health`、`remember`、`recall` 在 no-clone 情境可成功。
- repo mode 既有 smoke/bootstrap/adapter/MCP 測試全數維持綠燈。
- README / INSTALL / RELEASE 三份文件清楚區分 repo mode 與 no-clone mode。
