# Issue 29 - 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)，本檔不重複。

## 設計方案

### 1. Canonical Skill 目錄與 Host Symlink 分工

- **Canonical 實體目錄（`<memoriaHome>/.agents/skills/memoria`）**：
  - 由 `deployAgentSkill(runtimeLayout, memoriaHome)` 寫入完整的部署版檔案（`SKILL.md`、`REFERENCE.md`、`DATA_ROOT`、`bin/memoria` 等）。
  - 此目錄本身**必須是實體目錄**（不可為 symlink），預檢維持拒絕 `<memoriaHome>/.agents/skills/memoria` 為 symlink。
- **Host Agent Skill 目錄（`~/.claude/skills/memoria`、`$CODEX_HOME/skills/memoria` 或 `~/.codex/skills/memoria`）**：
  - 由 `deployHostAgentSkill(runtimeLayout, memoriaHome, agent, targetDir)` 建立指向 `<memoriaHome>/.agents/skills/memoria` 的 symlink：
    ```ts
    await fs.symlink(
        canonicalSkillDir,
        targetDir,
        process.platform === 'win32' ? 'junction' : 'dir'
    )
    ```

### 2. 預檢與安全覆蓋規則（`checkHostSkillTarget`）

區分 `allowSymlinkToMemoria`（對 canonical data-root skill 為 `false`，對 host skill 為 `true`）：

1. **祖先目錄鏈檢查**：
   - 無論目標是否存在，皆執行 `checkWritableAncestorDir(targetDir)`，確保從目標父目錄一路往上的所有使用者控制祖先皆為真實可寫目錄（不含未知的祖先 symlink，維持 Issue 28 `F-2` 的保護）。
2. **目標不存在**：
   - 放行（`{ ok: true }`）。
3. **目標為 Symlink（`stat.isSymbolicLink()`）**：
   - 若不允許 symlink（即 canonical `<memoriaHome>/.agents/skills/memoria` 本身）：拒絕。
   - 若為 host skill 目標：讀取連結目標 `rawLink = await fs.readlink(targetDir)` 並解析為絕對路徑 `resolvedTarget = path.resolve(path.dirname(targetDir), rawLink)`：
     - 情況 A：`resolvedTarget` 的路徑尾端結構為 `path.join('.agents', 'skills', 'memoria')`（例如切換或重建 `<dataRoot>` 時，即使舊 `<dataRoot>` 已被移除或尚未初始化，仍可辨識為 Memoria 先前建立的 canonical 連結）。
     - 情況 B：`resolvedTarget` 指向存在的目錄，且該目錄內的 `SKILL.md` frontmatter 同時具備 `deployment_mode: installed` 與 `repository: Memoria` 兩項部署標記，且該目錄不是此次同一個 `<memoriaHome>` 外被手寫竄改的未知目錄（或我們限定必須同時具備部署標記且位於 `.agents/skills/memoria`，避免測試中故意放一份複製了模板的外部目錄 `link-target/SKILL.md` 被誤放行！）。
     - ⚠️ **關鍵細節（對照 `test-bootstrap.sh:168-171`）**：
       在 `test-bootstrap.sh` 第 168–171 行有這個既有負向測試：
       ```bash
       mkdir -p "$TMP/home-refuse-link/.claude/skills" "$TMP/link-target"
       cp "$TEMPLATE" "$TMP/link-target/SKILL.md"
       ln -s "$TMP/link-target" "$TMP/home-refuse-link/.claude/skills/memoria"
       refuse_case "a symlink at the target" link
       ```
       注意！該測試故意把 `$TEMPLATE`（帶有 `deployment_mode: installed` 與 `repository: Memoria`！）複製到 `$TMP/link-target/SKILL.md`，並將 `~/.claude/skills/memoria` 設為指向 `$TMP/link-target` 的 symlink！
       因此，判斷「是否為 `memoria setup` 自建的 host symlink」時，要求：**連結目標的路徑結尾必須是 `/.agents/skills/memoria`（即 `path.basename(resolvedTarget) === 'memoria' && path.basename(path.dirname(resolvedTarget)) === 'skills' && path.basename(path.dirname(path.dirname(resolvedTarget))) === '.agents'`），且若該目標目錄已存在，其 `SKILL.md` 必須帶有 Memoria 部署標記**！
       如此一來：
       - `setup` 自己建立的 `<anyDataRoot>/.agents/skills/memoria` symlink 100% 符合。
       - 使用者或測試指向 `$TMP/link-target`（即使裡面放了 `SKILL.md`）的未知外部 symlink 100% 被拒絕！
4. **目標為實體目錄（`stat.isDirectory()`）**：
   - 空目錄：放行。
   - 非空目錄：檢查 `SKILL.md` frontmatter 是否同時含 `deployment_mode: installed` 與 `repository: Memoria`。符合則放行（部署時若為 host skill 會先備份至 `<memoriaHome>/.agents/skill-backups/` 再移除實體目錄改建 symlink）；不符合則拒絕。
5. **目標為一般檔案或其他類型**：
   - 拒絕。

### 3. 部署與備份行為（`deployHostAgentSkill`）

1. 確認 canonical skill `<memoriaHome>/.agents/skills/memoria` 已存在（若尚未部署則先呼叫 `deployAgentSkill`）。
2. 執行 `await assertHostSkillTarget(targetDir)`。
3. 檢查 `const stat = await fs.lstat(targetDir).catch(() => undefined)`：
   - 若 `stat?.isSymbolicLink()`：
     - 直接 `await fs.rm(targetDir, { force: true })` 移除舊 symlink，**不產生備份**（因為真實內容已在對應 dataRoot 的 `.agents/skills/memoria` 中）。
   - 若 `stat?.isDirectory()` 且非空（即舊版 `setup` 複製的帶標記實體目錄）：
     - 先將整個目錄複製備份至 `<memoriaHome>/.agents/skill-backups/<agent>-<timestamp>`。
     - 再以 `await fs.rm(targetDir, { recursive: true, force: true })` 移除舊實體目錄。
4. 確保父目錄存在（`await fs.mkdir(path.dirname(targetDir), { recursive: true })`），建立指向 `<memoriaHome>/.agents/skills/memoria` 的 symlink（`process.platform === 'win32' ? 'junction' : 'dir'`）。

## 實作步驟

1. 📝 **步驟 1 — 首要驗證：撰寫 Symlink 部署、重連、舊版實體目錄升級備份與未知外部 Symlink 拒絕的紅燈測試**
   - 產出：更新 `scripts/setup-onboarding-driver.mts`、`scripts/test-setup-onboarding.sh` 與 `scripts/test-bootstrap.sh`。
   - 相依：無
   - 驗收編號：SCN-001、SCN-002、SCN-003、SCN-004
   - 完成判準：
     - 斷言 `setup --agent` 後 `~/.claude/skills/memoria` 與 `~/.codex/skills/memoria` 為指向 `<dataRoot>/.agents/skills/memoria` 的 symlink（在修改 `runtime.ts` 前跑出預期紅燈）。
     - 斷言指向 `<dataRoot>/.agents/skills/memoria` 的既有 symlink 重跑時通過預檢且不新增備份；指向外部非 `.agents/skills/memoria` 的 symlink 一律拒絕。
     - 斷言舊版帶標記的實體目錄在執行 `setup --agent` 時先備份至 `skill-backups/`，接著被替換為 symlink。

2. 📝 **步驟 2 — 實作 `checkHostSkillTarget` 與 `deployHostAgentSkill` 的 Symlink 連結與舊版遷移邏輯**
   - 產出：更新 `src/cli/runtime.ts`（與必要的 `src/cli/setup-plan.ts` 調整）。
   - 相依：步驟 1
   - 驗收編號：SCN-001、SCN-002、SCN-003、SCN-004
   - 完成判準：
     - `deployAgentSkill` 維持寫入實體目錄 `<memoriaHome>/.agents/skills/memoria`（且拒絕該路徑為 symlink）。
     - `deployHostAgentSkill` 對舊版實體目錄先備份再替換為 symlink，對既有 Memoria symlink 直接重連不備份。
     - 步驟 1 的內外圈測試全部由紅轉綠。

3. 📝 **步驟 3 — 常青文件更新與完整回歸測試（不改變其他模組行為）**
   - 產出：更新 `README.md`、`README.zh-TW.md`、`docs/INSTALL.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`。
   - 相依：步驟 2
   - 驗收編號：SCN-001～SCN-004（常青文件責任）
   - 完成判準：
     - 文件如實描述 host skill 為指向 `<dataRoot>/.agents/skills/memoria` 的 symlink，且舊版帶標記實體副本會在首次升級轉為 symlink 前備份至 `<dataRoot>/.agents/skill-backups/`。
     - `pnpm run check`、`pnpm run build`、`bash scripts/test-setup-onboarding.sh`、`bash scripts/test-bootstrap.sh`、`bash scripts/test-npm-install.sh`、`pnpm run release:docs-check` 全部 exit 0。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| 初次執行 `memoria setup --agent both` | 在 `~/.claude/skills/memoria` 與 `~/.codex/skills/memoria` 複製兩份實體目錄 | 在兩處建立指向 `<dataRoot>/.agents/skills/memoria` 的 symlink |
| 已有舊版 `setup` 複製的實體目錄 | 備份至 `skill-backups/` 後再複製一份新實體目錄 | 備份至 `skill-backups/` 後改建為指向 `<dataRoot>/.agents/skills/memoria` 的 symlink |
| 已是 Memoria symlink 時重跑或切換 `<dataRoot>` | 因目標是 symlink 而被拒絕 | 直接更新 symlink 指向新的 `<dataRoot>/.agents/skills/memoria`，不產生多餘備份 |
| 目標為手寫目錄或外部未知 symlink | 拒絕覆寫並以非 0 結束 | 維持拒絕覆寫並以非 0 結束 |

## 測試策略

| 驗收編號 | 測試層級 | 位置與策略 |
|----------|----------|------------|
| SCN-001 | CLI 端到端（外圈） | `scripts/test-setup-onboarding.sh`、`scripts/test-bootstrap.sh`：驗證 `-L`（為 symlink）、`readlink` 指向 `<dataRoot>/.agents/skills/memoria`、launcher 可執行 |
| SCN-002 | 內圈單元＋外圈 E2E | `scripts/setup-onboarding-driver.mts`、`scripts/test-setup-onboarding.sh`：驗證重跑與切換 `<dataRoot>` 後 symlink 更新且 `skill-backups` 數量不增加 |
| SCN-003 | 內圈單元＋外圈 E2E | `scripts/setup-onboarding-driver.mts`、`scripts/test-bootstrap.sh`、`scripts/test-setup-onboarding.sh`：驗證手寫目錄、外部 symlink（含帶模板的外部目錄）、深層祖先 symlink 與 canonical 目標 symlink 皆被拒絕 |
| SCN-004 | CLI 端到端（外圈） | `scripts/test-bootstrap.sh`、`scripts/test-setup-onboarding.sh`：放一份帶部署標記與自訂修改的實體目錄，執行 `setup --agent` 後驗證 `skill-backups` 備份完整且目標已轉為 symlink |

## 檢查清單

- [x] 所有 Scenario（SCN-001～SCN-004）已於 2026-10-23 核准
- [ ] 步驟 1 的測試先紅後綠
- [ ] 改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes
- [ ] 常青文件同步更新並通過 `pnpm run release:docs-check`
