# Deployed Skill Packaging And Validation Plan

> **For agentic workers:** Use this plan when implementing the next stage of deployed skill support. Steps use checkbox syntax so execution can be tracked incrementally.

**Goal:** 讓 no-clone / installed mode 在完成 `memoria setup` 後，不只把 `skills/memoria-memory-sync` 複製到 `<memoria-home>/.agents/memoria-memory-sync`，還能提供一份明確面向 deployed runtime 的 skill 文件，並在 release 打包時檢查 deploy skill 是否與最新版本及 artifact 內容一致。

**Architecture:** 保留 `skills/memoria-memory-sync/` 作為 repo 內 source-of-truth；release package 與 `setup` 負責部署一份 runtime-safe 的 skill 到 `<memoria-home>/.agents/memoria-memory-sync`。deploy skill 不應再假設 repo root、`./cli`、或 `skills/...` source path 一定存在。版本檢查與 artifact completeness 檢查應在 package script / CI 階段失敗得早、訊息清楚。

**Tech Stack:** TypeScript CLI, bash packaging scripts, release tarball flow, deployed `.agents/` runtime layout, existing bootstrap / no-clone integration tests.

---

## Problem Statement

- 目前 deploy 後已能把 skill 資產複製到 `<memoria-home>/.agents/memoria-memory-sync`。
- 但 `SKILL.md` / `REFERENCE.md` / `INGEST_PLAYBOOK.md` 仍大幅偏向 repo mode，用法中存在大量 `./cli`、`skills/...`、repo root 假設。
- 這使得「agent 安裝後直接發現並使用 deployed skill」這個目標只完成了一半：檔案存在，但文件與部分使用指引仍不夠 runtime-safe。
- 另外，目前沒有 release-time guard 確保 deploy skill 跟最新 source 版本、必需檔案、deploy contract 保持一致。

## Deliverables

- 一份 deploy-specific skill 文檔組，部署到 `<memoria-home>/.agents/memoria-memory-sync` 後可直接給 agent 使用。
- 一套打包驗證，檢查 deploy skill metadata、artifact completeness、與 deployed runner contract。
- 一個或多個測試，驗證 deployed skill 在 repo mode 與 no-clone mode 都可被安裝與使用。

## File Structure

**Create:**
- `docs/superpowers/plans/2026-04-11-deployed-skill-packaging.md` - 本計畫文件。
- `scripts/check-deployed-skill-sync.mjs` - 驗證 deploy skill 版本與必要內容的檢查腳本。
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - deploy mode 主入口文件。
- `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - deploy mode 精簡參考文件。

**Modify:**
- `scripts/package-release-artifacts.sh` - 將 deploy-specific skill 文檔打進 artifact，並執行檢查。
- `src/cli.ts` - `setup` 部署 skill 時，優先將 deploy-specific 文檔映射到 `.agents`。
- `scripts/test-bootstrap.sh` - 驗證 deployed skill 主入口存在且內容可用。
- `scripts/test-no-clone-install.sh` - 驗證 no-clone 安裝後 deploy skill 可被 agent 使用。
- `README.md` - 說明安裝後 `.agents` skill 的用途與位置。
- `docs/INSTALL.md` - 說明 deploy skill 的預期 layout 與使用方式。

**Do not change implicitly:**
- 不要移除 `skills/memoria-memory-sync/` 作為 source-of-truth。
- 不要讓 deploy skill 反過來成為 repo mode 的唯一入口。
- 不要在第一版同時維護多套手工版本號來源。

---

## Design Rules

- `skills/memoria-memory-sync/` 仍是 canonical source。
- deploy 版文件應明確區分為 runtime-safe 文檔，不混入長篇 repo 維護細節。
- deploy 版應優先指向本地 wrapper：`<skill-root>/bin/memoria`。
- deploy 版應假設只有以下東西一定存在：
  - `<memoria-home>`
  - `<memoria-home>/.agents/memoria-memory-sync`
  - `bin/memoria` wrapper
  - `scripts/` 與 `resources/` 內已部署的 skill 輔助資產
- version source 應以 `package.json.version` 為準；如 skill metadata 有版本欄位，必須可被程式化比對。

## Task 1: Split Source Skill And Deployed Skill Responsibilities

**Files:**
- Modify: `skills/memoria-memory-sync/SKILL.md`
- Create: `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`
- Create: `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`

- [ ] **Step 1: 定義 source skill 與 deploy skill 的內容邊界**

Source skill 應保留：
- 架構背景
- repo mode 維護/開發說明
- 測試、CI、文件擴寫規則
- 完整 MCP / reference 補充

Deploy skill 應聚焦：
- 這個 skill 解決什麼問題
- 安裝後在哪裡
- 最短使用流程
- local wrapper 使用方式
- no-clone / installed mode 下的路徑規則
- 常見失敗排查

- [ ] **Step 2: 為 deploy skill 定義固定入口檔名**

建議第一版固定為：

```text
<memoria-home>/.agents/memoria-memory-sync/
  SKILL.md
  REFERENCE.md
  bin/memoria
  scripts/...
  resources/...
```

其中 deployed `SKILL.md` / `REFERENCE.md` 可由 source repo 內的 `deployed/` 模板複製或轉換而來。

- [ ] **Step 3: 明確定義 deploy skill 不能再出現的 repo-only 假設**

deploy 版文件與腳本不應再主動依賴：
- `./cli`
- `bash skills/...`
- `node skills/...`
- `git clone`
- source repo 一定存在

允許的入口應優先為：
- `bin/memoria`
- `MEMORIA_BIN` override
- 已部署 skill 目錄內的相對 `scripts/...`

## Task 2: Define Deployed Skill Content Contract

**Files:**
- Create: `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`
- Create: `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`
- Modify: `skills/memoria-memory-sync/resources/mcp/INGEST_PLAYBOOK.md` or add deploy-specific variant if needed

- [ ] **Step 1: 設計 deployed `SKILL.md` 的最小章節**

建議最小章節：
- frontmatter (`name`, `description`, `version`, `deployment_mode: installed`)
- Activation Signals
- Installed Mode Quickstart
- Path Rules
- Safe Operating Rules
- Common Commands
- Troubleshooting
- See also: `REFERENCE.md`

- [ ] **Step 2: 設計 deployed `REFERENCE.md` 的最小章節**

建議收斂為：
- runtime assumptions
- path/layout contract
- command mapping (`init`, `sync`, `stats`, `doctor`, `verify`, `wiki build`, `wiki lint`)
- MCP enhancement flow in deployed mode
- debugging notes

- [ ] **Step 3: 決定 MCP 文件是否也要 deploy-specific 版本**

兩種可接受方案擇一，不要混用：

1. 保留一份 `INGEST_PLAYBOOK.md`，但改寫成同時適用 deployed mode。
2. 新增 deploy-specific MCP playbook，並在 deployed `SKILL.md` 只引用 deploy-safe 文件。

第一版較推薦方案 1，只要文件足夠簡短且不再假設 repo root。

## Task 3: Add Packaging-Time Version And Completeness Checks

**Files:**
- Create: `scripts/check-deployed-skill-sync.mjs`
- Modify: `scripts/package-release-artifacts.sh`
- Optionally Modify: `package.json`

- [ ] **Step 1: 定義版本來源與比對規則**

建議規則：
- `package.json.version` 是 release version source of truth。
- source `SKILL.md` frontmatter version 不必等於 package version，但需明確定義它代表什麼。
- deployed `SKILL.md` frontmatter version 應直接等於 `package.json.version`，因為它是 release-facing artifact。

如果保留 source `SKILL.md` 的 `version: "1.0"` 這種語意，則需要新增另一個欄位，例如：
- `skill_schema_version`
- `release_version`

避免同一欄位混用兩種意義。

- [ ] **Step 2: 在檢查腳本中驗證 deploy artifact completeness**

至少檢查：
- deployed `SKILL.md` 存在
- deployed `REFERENCE.md` 存在
- `bin/memoria` 存在且可執行
- `scripts/run-sync.sh` 存在
- `scripts/run-sync-with-enhancement.sh` 存在
- MCP 需要的 `resources/` 檔案存在

- [ ] **Step 3: 在檢查腳本中驗證 deploy 文檔是否殘留 repo-only 指令**

可先做簡單字串掃描，若 deploy 文檔出現以下內容則 fail：
- `./cli`
- `bash skills/`
- `node skills/`
- `git clone`

必要時允許白名單註解，但第一版建議直接 fail-fast。

- [ ] **Step 4: 在 package 流程執行檢查**

`scripts/package-release-artifacts.sh` 應在產生 tarball 前執行：

```bash
node scripts/check-deployed-skill-sync.mjs
```

若檢查失敗：
- package script 直接非零退出
- 訊息清楚指出缺檔、版本不一致、或 deploy 文檔殘留 repo-only 指令

## Task 4: Update Setup Deployment Mapping

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: 明確 `setup` 要部署哪些 deploy-facing 檔案**

部署目標建議固定為：
- `<memoria-home>/.agents/memoria-memory-sync/SKILL.md`
- `<memoria-home>/.agents/memoria-memory-sync/REFERENCE.md`
- `<memoria-home>/.agents/memoria-memory-sync/bin/memoria`
- `<memoria-home>/.agents/memoria-memory-sync/scripts/...`
- `<memoria-home>/.agents/memoria-memory-sync/resources/...`

- [ ] **Step 2: 確保 setup 部署的是 deploy 文檔，而不是原始 source 文檔**

如果 source repo 結構為：

```text
skills/memoria-memory-sync/
  SKILL.md
  references/REFERENCE.md
  deployed/DEPLOYED_SKILL.md
  deployed/DEPLOYED_REFERENCE.md
```

則 setup 部署時應映射成：
- `deployed/DEPLOYED_SKILL.md` -> `.agents/.../SKILL.md`
- `deployed/DEPLOYED_REFERENCE.md` -> `.agents/.../REFERENCE.md`

其餘 `scripts/`、`resources/` 仍照常部署。

## Task 5: Strengthen Validation And Docs

**Files:**
- Modify: `scripts/test-bootstrap.sh`
- Modify: `scripts/test-no-clone-install.sh`
- Modify: `README.md`
- Modify: `docs/INSTALL.md`
- Optionally Modify: `CHANGELOG.md`

- [ ] **Step 1: 新增 bootstrap 驗證**

應驗證：
- deployed `SKILL.md` 存在
- deployed `REFERENCE.md` 存在
- deployed `SKILL.md` 不含 repo-only 指令
- deployed runner 可實際執行 `init` / `sync` / `stats`

- [ ] **Step 2: 新增 no-clone 驗證**

應驗證：
- release artifact 內含 deploy-specific skill 文檔
- 安裝後 `.agents/memoria-memory-sync` layout 完整
- deployed skill runner 在 no-clone 環境可用

- [ ] **Step 3: 更新使用文件**

README / INSTALL 至少補充：
- `.agents/memoria-memory-sync` 的存在目的
- 這是安裝後給 agent 發現與執行的 skill 入口
- deploy 版 skill 以 runtime-safe 指令為準

## Acceptance Criteria

- `setup` 後，agent 在 `<memoria-home>/.agents/memoria-memory-sync` 可看到 deploy-specific `SKILL.md` 與 `REFERENCE.md`。
- deploy 文檔不再依賴 `./cli`、`skills/...`、repo root。
- `scripts/package-release-artifacts.sh` 在 deploy skill 缺檔、版本不一致、或 deploy 文檔殘留 repo-only 指令時會 fail。
- `bash scripts/test-bootstrap.sh` 通過。
- `bash scripts/test-no-clone-install.sh` 通過。
- no-clone 安裝後，agent 可直接使用 deployed skill 提供的入口與說明完成最小工作流。

## Suggested Execution Order

1. 先定義 deploy skill 內容 contract。
2. 再建立 deploy-specific 文檔模板。
3. 然後寫 `check-deployed-skill-sync.mjs`。
4. 再把 package script 與 `setup` deployment mapping 接上。
5. 最後補測試與文件。

## Out Of Scope For First Iteration

- 多 skill 類型的通用 deploy framework。
- 自動從單一 markdown 模板完整產生多種 skill 文檔格式。
- 遠端自我更新 deployed skill 而不重新跑 release install。
- 非 Linux x64 的 release artifact 差異處理。
