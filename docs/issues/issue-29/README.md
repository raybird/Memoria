# Issue 29 - Host agent skill 部署統一改以 symlink 連結至 canonical skill 目錄

## 概述

目前 `memoria setup` 在部署 skill 時，先寫入一份完整目錄至 `<dataRoot>/.agents/skills/memoria`，當指定 `--agent claude-code`、`--agent codex` 或 `--agent both` 時，再以 `fs.cp` 複製獨立的實體目錄至 `~/.claude/skills/memoria` 與 `~/.codex/skills/memoria`（或 `$CODEX_HOME/skills/memoria`）。

多份實體副本會帶來兩個問題：
1. **版本與設定漂移**：當使用者執行不帶 `--agent` 的 `memoria setup` 更新 `<dataRoot>/.agents/skills/memoria` 時，各宿主目錄下的副本不會同步更新，且無法直接從檔案系統連結看出該宿主目前綁定哪一個 `<dataRoot>`。
2. **重複備份與冗餘**：每次重跑 `setup --agent` 都會因目標為非空實體目錄而再次複製一份備份到 `<dataRoot>/.agents/skill-backups/`。

本 issue 將 `<dataRoot>/.agents/skills/memoria` 定為唯一的 **canonical 實體 skill 目錄**，並讓 `setup` 對所選宿主（`claude-code`、`codex`）統一建立指向該 canonical 目錄的 **symlink**（Windows 使用 `'junction'`）。同時定義清楚「符合受管理辨識規則的 symlink」、「舊版 setup 複製之實體目錄」與「使用者手寫／外部未知 symlink」的安全覆蓋與升級規則。

決策來源：使用者 2026-10-23 提出「評估一個新 issue 是否 setup 的 claudecode 與 codex 也都統一使用連結的方式」，並對 Q1～Q3 逐題確認回覆「照建議」核准。

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 快速導覽

### 當前流程
`memoria setup --agent both` → 複製模板到 `<dataRoot>/.agents/skills/memoria` → 再複製兩份實體目錄到 `~/.claude/skills/memoria` 與 `~/.codex/skills/memoria`（每次重跑皆產生新的 `skill-backups` 副本；若目標是 symlink 則一律拒絕）

### 重構後流程
`memoria setup --agent both` → 寫入實體 canonical 目錄 `<dataRoot>/.agents/skills/memoria` → 將 `~/.claude/skills/memoria` 與 `~/.codex/skills/memoria` 以 symlink 指向 `<dataRoot>/.agents/skills/memoria`（舊版實體部署目錄首次升級時先備份再轉為 symlink；後續重跑或切換 `<dataRoot>` 時直接更新 symlink，不再重複產生備份）

## 關鍵差異
| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| Host skill 部署形態 | `fs.cp` 複製獨立實體目錄 | `fs.symlink` 連結至 `<dataRoot>/.agents/skills/memoria`（Windows 為 `junction`） |
| 單一真相來源 | 各 host 持有獨立的 `SKILL.md`、`DATA_ROOT`、`bin/memoria` | 統一由 canonical `<dataRoot>/.agents/skills/memoria` 提供 |
| 舊版已部署實體目錄 | 每次重跑皆備份並重新複製實體目錄 | 首次升級時備份至 `<dataRoot>/.agents/skill-backups/` 並轉為 symlink；已是 Memoria symlink 時重跑直接重連、不重複備份 |
| Symlink 覆蓋保護 | 目標為任何 symlink 一律拒絕 | 連結目標須以 `.agents/skills/memoria` 為路徑尾端；存在時須為帶兩項部署標記的實體目錄，不存在時允許修復斷鏈；其餘拒絕 |

## 涉及檔案
### 部署與預檢
- `src/cli/runtime.ts` - `checkHostSkillTarget`／`assertHostSkillTarget` 支援辨識 符合受管理辨識規則的 symlink 與拒絕外部未知 symlink；`deployHostAgentSkill` 改為對舊版實體目錄備份後建立指向 `<memoriaHome>/.agents/skills/memoria` 的 symlink
- `src/cli/setup-plan.ts` - 預覽與預檢維持與新的 host skill symlink 規則一致；在任何寫入前拒絕 host 與 canonical 路徑重合
### 測試
- `scripts/setup-onboarding-driver.mts` - 內圈預檢斷言（Memoria symlink 放行、外部未知 symlink 拒絕、深層 symlink 祖先維持拒絕）
- `scripts/test-setup-onboarding.sh` - 外圈端到端驗證（`claude-code` 與 `codex` 建立 symlink、切換 dataRoot 重連、舊版實體目錄升級備份轉 symlink、未知外部 symlink 拒絕）
- `scripts/test-bootstrap.sh` - 更新 `SCN-004`～`SCN-006` 的 host skill 部署斷言（驗證 symlink 指向、舊版帶標記實體副本備份並轉為 symlink、未知 symlink 維持拒絕）
### 文件
- `README.md`、`README.zh-TW.md`、`docs/INSTALL.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 同步更新 host skill 連結與覆蓋規則說明

## Gherkin 驗收劇本

```gherkin
Feature: Host agent skill 統一以 symlink 連結至 canonical skill 目錄

  @SCN-001
  Scenario: 全新部署時將所選 host skill 目錄以 symlink 連結至 canonical 目錄
    Given 隔離的 HOME，且 ~/.claude/skills/memoria 與 ~/.codex/skills/memoria 皆不存在
    When 執行 memoria setup --agent both
    Then <dataRoot>/.agents/skills/memoria 為實體目錄，內含部署版 SKILL.md、DATA_ROOT 與可執行的 bin/memoria
    And ~/.claude/skills/memoria 與 ~/.codex/skills/memoria 皆為指向 <dataRoot>/.agents/skills/memoria 的 symlink
    And 透過各 host skill 路徑可正常讀取 SKILL.md 與執行 bin/memoria

  @SCN-002
  Scenario: 重跑或切換 data root 時直接更新既有 Memoria symlink 且不產生多餘備份
    Given ~/.claude/skills/memoria 與 ~/.codex/skills/memoria 已是指向舊 <dataRootA>/.agents/skills/memoria 的 symlink
    When 對 <dataRootA> 重跑 memoria setup --agent both，或切換至 <dataRootB> 執行 memoria setup --agent both
    Then 兩個 host 的 symlink 更新為指向最新所選 <dataRoot>/.agents/skills/memoria
    And 不會在 skill-backups 目錄下新增備份資料夾
    And 舊 canonical 內容在切換至另一個 data root 時保持不變

  @SCN-003
  Scenario: 拒絕覆寫使用者手寫實體目錄或指向未知目標的外部 symlink
    Given 目標符合以下任一不安全狀態
      | 狀態 |
      | 無部署標記的手寫實體目錄、一般檔案，或祖先路徑含未知使用者 symlink |
      | host symlink 的解析目標路徑尾端不是 .agents/skills/memoria，即使目標含部署標記 |
      | host symlink 的解析目標路徑尾端相符，但存在的目標不是帶兩項部署標記的實體目錄 |
      | canonical skill 目錄本身為 symlink |
    When 執行 memoria setup --agent claude-code 或 --agent codex
    Then 命令在寫入任何檔案或建立資料庫前以非 0 結束，並印出衝突路徑與原因
    And 原有目標與其指向的外部內容逐位元組不變

  @SCN-004
  Scenario: 舊版 setup 部署的帶標記實體目錄先備份再無痛轉為 symlink
    Given ~/.claude/skills/memoria 為舊版 setup 部署的實體目錄（SKILL.md frontmatter 含 deployment_mode: installed 與 repository: Memoria）且含使用者附加修改
    When 執行 memoria setup --agent claude-code
    Then 原實體目錄先完整備份至 <dataRoot>/.agents/skill-backups/claude-code-<timestamp>
    And ~/.claude/skills/memoria 被替換為指向 <dataRoot>/.agents/skills/memoria 的 symlink

  @SCN-005
  Scenario: host 與 canonical 路徑重合時在寫入前拒絕
    Given CODEX_HOME 為 <dataRoot>/.agents，使 Codex host skill 路徑等於 canonical 路徑
    When 執行 memoria setup --agent codex
    Then 命令在任何檔案或資料庫寫入前以非 0 結束並列出重合路徑與原因
    And 既有 canonical 內容與目錄型態保持不變，不建立自循環連結

  @SCN-006
  Scenario: 既有空 host 目錄轉為連結且不備份
    Given 所選 host skill 路徑為既有空實體目錄
    When 執行 memoria setup --agent claude-code 或 --agent codex
    Then 命令成功並將空目錄替換為指向 canonical 的 symlink
    And 不新增 skill-backups 備份

  @SCN-007
  Scenario: 不帶 agent 更新 canonical 時已連結宿主同步更新
    Given 兩個 host 已部署為指向同一 canonical 的 symlink
    And canonical 的 SKILL.md、DATA_ROOT 與 bin/memoria 含可辨識的舊內容
    When 對同一 data root 執行不帶 --agent 的 memoria setup
    Then 透過兩個原 host 路徑讀到更新後的部署模板、正確 DATA_ROOT 與可執行 launcher
    And 兩個 host symlink 指向不變且不新增 skill-backups 備份

  @SCN-008
  Scenario: 修復符合 canonical 路徑結構的斷鏈
    Given host symlink 的解析目標以 .agents/skills/memoria 為路徑尾端，但該目標已不存在
    When 對新的 data root 執行 memoria setup --agent claude-code 或 --agent codex
    Then 命令成功且 host symlink 指向新的 canonical 實體目錄
    And 不新增 skill-backups 備份
```

## Gherkin 核准紀錄
- **核准 commit**: a60c52a（本次修訂）；前版基線 `88c77b2`，僅供追溯，不能代表本次修訂
- **核准來源**: 使用者於 2026-10-23 對話提出「評估一個新 issue 是否 setup 的 claudecode 與 codex 也都統一使用連結的方式」，並對 Q1（既有 Memoria symlink 與外部未知 symlink 的覆寫規則）、Q2（舊版帶標記實體目錄先備份再轉 symlink，已是 symlink 則不重複備份）、Q3（本次範圍聚焦於 `claude-code` 與 `codex`）回覆「照建議」全部核准。

- **修訂核准來源**: 使用者於 2026-10-23 在收到四項 MUST FIX 與兩項改善建議後回覆「好幫我補上修正」，接受審查建議。SCN-001／SCN-004 保持原核准；SCN-002／SCN-003 補明邊界，新增 SCN-005～SCN-008，依下表記錄。

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-10-23 | 已核准 |
| SCN-002 | 2026-10-23 | 已核准 |
| SCN-003 | 2026-10-23 | 已核准 |
| SCN-004 | 2026-10-23 | 已核准 |
| SCN-005 | 2026-10-23 | 已核准 |
| SCN-006 | 2026-10-23 | 已核准 |
| SCN-007 | 2026-10-23 | 已核准 |
| SCN-008 | 2026-10-23 | 已核准 |

## 重構步驟概要
1. ✅ **S1 首要驗證：未知外部 symlink 拒絕 vs Memoria symlink 放行與舊版實體目錄升級保護** - 已完成
2. ✅ **S2 Host skill symlink 建立與舊版實體目錄遷移實作** - 已完成
3. ✅ **S3 端到端回歸測試與常青文件更新** - 已完成

## 風險與首要驗證

- **最大風險**：放寬 host symlink 規則時誤覆寫未知目標，或 host 與 canonical 路徑重合而在遷移時刪掉 canonical、建立自循環連結。
- **風險等級與理由**：High — 涉及家目錄安全邊界、覆寫與刪除。規模仍為 Medium，測試保護不降低規劃時的風險分級。
- **首要驗證**：主要實作前先建立預檢與檔案系統回歸保護網：SCN-003 的正負向辨識矩陣、SCN-005 的重合拒絕、SCN-004 的備份完整性，以及 SCN-006 的空目錄遷移；再覆蓋新部署、重連、同步更新與斷鏈修復。
- **選擇理由**：最大風險在路徑判定與刪除邊界；隔離 HOME 的預檢契約與內容比對能直接觀察拒絕前零寫入、備份完整與 canonical 型態。
- **完成證據**：既有拒絕案例保持綠燈；缺少新行為的案例先取得對應原因的紅燈，實作後 SCN-001～SCN-008 全綠；保留未知目標逐位元組不變、重合路徑零寫入與備份內容完整的斷言。

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-23 | 建立並完成 Q1～Q3 規格確認，SCN-001～SCN-004 核准（「照建議」） | - |
| 2026-10-23 | 依需求規劃審查及「好幫我補上修正」統一辨識規則、補路徑重合／空目錄／同步更新／斷鏈驗收，風險改列 High；補部署主模板責任 | - |

---
**建立日期**: 2026-10-23  
**分級**: Medium  
**風險**: High
**狀態**: 待審查
