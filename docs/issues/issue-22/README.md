# Issue 22 - 部署的 skill 讀不到也沒寫觸發時機：agent 從不主動讀寫記憶

## 概述

兩個獨立的缺口疊在一起：

1. **讀不到**：`deployAgentSkill`（`src/cli/runtime.ts`）只寫到 `<MEMORIA_HOME>/.agents/skills/memoria`；Claude Code 只掃 `~/.claude/skills/` 與專案的 `.claude/skills/`，所以 skill 清單裡沒有 memoria。
2. **讀到也不會觸發**：模板 `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` 的 description 與 Activation Signals 只涵蓋 setup、`sync session.json` 與 stats；[issue-4](../issue-4/README.md) 之後的 recall／feedback／remember，以及 git-aware 的 repo sync，完全沒出現。

使用端證據（2026-10-20 量測，維護者機器）：2026-08-26 之後約 194 個 Claude Code session，recall 7 次（全為預設 keyword 模式，語意召回零使用）、remember 0 次、feedback 0 次、repo sync 0 次；同期兩個 repo 累積 3500 個未同步 commit。維護者改以手寫的 `~/.claude/skills/memoria/` 補上觸發時機後，數分鐘內就有其他並行 session 主動 remember 並回寫 merge 摘要。

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 快速導覽

### 當前流程
`memoria setup` → 複製模板到 `<MEMORIA_HOME>/.agents/skills/memoria` → Claude Code 看不到；就算看得到，觸發詞也只對應 setup／sync

### 重構後流程
`memoria setup`（未加旗標時不變）；`memoria setup --agent claude-code` → 另寫一份到 `~/.claude/skills/memoria`；模板的 description 列出四個觸發時機，正文逐一給命令與完成判準

## 關鍵差異
| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 模板觸發詞 | setup、sync session、stats | 開始處理 issue 前、決策或踩坑後、合併或發版後、被問到過去的決定時 |
| recall 範例 | 無 | 帶 `--mode vector` |
| data root | 只由 skill 位置推導 | `MEMORIA_HOME` 已設定時沿用，否則讀部署時寫入的 `DATA_ROOT` |
| Claude Code 可見性 | 需手動複製 | `setup --agent claude-code` 一步寫入 |

## 涉及檔案
### 模板
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md` - 觸發時機、data root 判斷
### 部署
- `src/cli/runtime.ts` - `deployAgentSkill` 支援第二個目標與覆蓋保護
- `src/cli/commands/setup.ts` - `--agent` 旗標
### 測試與文件
- `scripts/test-bootstrap.sh` - 以隔離 `HOME` 驗證
- `README.md`、`docs/INSTALL.md` - 旗標與觸發時機

## Gherkin 驗收劇本

```gherkin
Feature: agent 能看見並在對的時機使用 Memoria skill

  @SCN-001
  Scenario: 部署出的 skill 寫明觸發時機
    When 執行 memoria setup
    Then 部署出的 SKILL.md 的 description 開頭列出：開始處理 issue 或功能前、做出決策或踩坑後、合併或發版後
    And 正文對 recall、feedback、remember、repo sync 各有命令與完成判準
    And recall 的範例帶 --mode vector

  @SCN-002
  Scenario: 已設定 MEMORIA_HOME 時沿用全域 home
    Given 環境已設定 MEMORIA_HOME
    When agent 依部署出的 SKILL.md 找出 data root
    Then 使用 MEMORIA_HOME，不再由 skill 位置推導

  @SCN-003
  Scenario: 未加旗標時不碰宿主 agent 的目錄
    Given 一個隔離的 HOME
    When 執行 memoria setup 而未給 --agent
    Then $HOME/.claude 不存在

  @SCN-004
  Scenario: 加旗標時寫入 Claude Code 的 skill 目錄
    Given 一個隔離的 HOME，且 ~/.claude/skills/memoria 不存在
    When 執行 memoria setup --agent claude-code
    Then ~/.claude/skills/memoria/SKILL.md 存在，內容與部署模板相同

  @SCN-005
  Scenario: 覆蓋 setup 自己部署過的版本
    Given ~/.claude/skills/memoria/SKILL.md 帶有 setup 的部署標記
    When 再次執行 memoria setup --agent claude-code
    Then 檔案更新為目前模板

  @SCN-006
  Scenario: 拒絕覆蓋使用者自己寫的 skill
    Given ~/.claude/skills/memoria/SKILL.md 存在但沒有部署標記
    When 執行 memoria setup --agent claude-code
    Then 命令以非 0 結束並印出目標路徑與原因
    And 原檔逐位元組不變
```

## Gherkin 核准紀錄
- **核准 commit**: a79d3be
- **核准來源**: 使用者 2026-10-20 的兩項選擇——「資料根模型要怎麼處理？」選「保留每資料夾，補觸發時機」；「setup 是否要負責讓 Claude Code 讀得到 skill？」選「setup 直接寫入」。各 Scenario 的具體行為（含 SCN-005／006 的覆蓋保護）由規劃推導，使用者 2026-10-20 回覆「照建議」全部核准（建議內容：以 frontmatter 的 `deployment_mode: installed` 加 `repository: Memoria` 作為部署標記，有標記才覆蓋，無標記拒絕並非 0 結束）

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-10-20 | 已核准 |
| SCN-002 | 2026-10-20 | 已核准 |
| SCN-003 | 2026-10-20 | 已核准 |
| SCN-004 | 2026-10-20 | 已核准 |
| SCN-005 | 2026-10-20 | 已核准 |
| SCN-006 | 2026-10-20 | 已核准 |

## 重構步驟概要
1. ✅ **S1 模板改寫** - 已完成
2. ✅ **S2 `--agent` 旗標骨架** - 已完成
3. ✅ **S3 寫入與覆蓋保護** - 已完成
4. ✅ **S4 文件** - 已完成

## 風險與首要驗證

- **最大風險**：`setup` 首次寫入 `~/.memoria` 以外的使用者目錄，覆蓋到使用者手寫的 skill 會造成無聲且不可逆的資料遺失
- **風險等級與理由**：Medium——預設路徑不變、需明確加旗標才寫入，但一旦寫錯就是使用者資料
- **首要驗證**：先寫 SCN-006（拒絕覆蓋、原檔逐位元組不變）的測試（紅），再實作寫入
- **選擇理由**：覆蓋保護是唯一不可逆的失敗；先釘住它，後續寫入邏輯都在它的約束內
- **完成證據**：SCN-006 紅→綠，`cmp` 比對原檔不變
- **阻擋性相依**：模板的 merge 步驟用 `repo summarize --merge` 取既有摘要（issue-20），他人骨架用 `--dismiss-pending`（issue-21）。本分支單獨合進 main 時，前者會再建一筆重複的 pending 摘要（地雷 M-2），後者報 `unknown option`。**必須在 issue-20、issue-21 合進 main 之後才合併**（見 TBD-3）

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | SCN-001～SCN-006 需使用者核准；其中 SCN-005／006 是覆蓋保護提案（以 frontmatter 的 `deployment_mode: installed` 與 `repository: Memoria` 作為部署標記） | 已解決 | 2026-10-20 使用者回覆「照建議」，全部核准，部署標記照提案 |
| TBD-2 | 其他宿主（Codex、OpenCode）的 skill 目錄：本次只做 Claude Code，旗標值設計成可擴充 | 待確認 | 不影響已列 Scenario |
| TBD-3 | 合併順序：本分支相依 issue-20、issue-21 的行為（審查 81bb75d S-1，`需決策`） | 已解決 | 2026-10-20 使用者「一律都照建議」：採 reviewer 建議，列為阻擋性相依（見「風險與首要驗證」），合併前 issue-20、issue-21 須已在 main；若之後 rebase，HEAD 改變須重新審查 |
| TBD-4 | 部署標記分不出「setup 寫的」與「手動複製後改過的」（審查 81bb75d M-1，`需決策`） | 已解決 | 2026-10-20 使用者「一律都照建議」：採 reviewer 建議 (A)＋(C)——覆蓋前把整個目錄備份到 `<memoria-home>/.agents/skill-backups/` 並印出路徑，文件改為如實描述；SCN-005「檔案更新為目前模板」不變，不需重新核准 |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-20 | 建立；資料根模型與部署方式兩項決策 | - |
| 2026-10-20 | SCN-001～SCN-006 核准（「照建議」） | - |
| 2026-10-20 | 實作完成；設計修訂：data root 改由 `DATA_ROOT` 檔提供（見 implementation-plan），覆蓋保護收緊為「非空且無 SKILL.md 也拒絕」；相依 issue-20（`--merge` 回傳既有摘要）與 issue-21（`--dismiss-pending`），須在兩者之後合併 | - |
| 2026-10-20 | 獨立審查 RETURN TO execute-task（`81bb75d`，[報告](./review-81bb75d.md)）：M-1 帶標記的副本可能是使用者改過的；依 TBD-3、TBD-4 修正 | - |

---
**建立日期**: 2026-10-20  
**分級**: Medium  
**風險**: Medium\
**狀態**: 待審查
