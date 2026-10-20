# Issue 22 - 實作計畫

README 的 Gherkin 為驗收來源。風險與首要驗證見 README「風險與首要驗證」。

## 設計方案

- **模板**：以維護者手寫的 `~/.claude/skills/memoria/SKILL.md` 為起點改寫 `DEPLOYED_SKILL.md`。去除機器特定路徑與下游專案名稱，保留四個觸發時機、每步的完成判準與收尾（向量 ingest、brief）。data root 判斷改為：`MEMORIA_HOME` 已設定就沿用，否則照現行由 skill 位置往上三層推導。
- **旗標**：`setup --agent <name>`，本次只接受 `claude-code`，其他值報錯並列出可用值。目標為 `$HOME/.claude/skills/memoria`。
- **覆蓋保護**：目標 SKILL.md 不存在 → 建立；存在且 frontmatter 同時含 `deployment_mode: installed` 與 `repository: Memoria` → 覆蓋；其他情況 → 拒絕、印出路徑與原因、非 0 結束，不寫入任何檔案。
- **`deployAgentSkill`**：抽出「複製模板到一個目標目錄」的內部函式，原目標與新目標共用；原目標維持現行的 `rm -rf` 後重建行為（那是 setup 自己擁有的目錄）。

## 實作步驟

1. 📝 **首要驗證：覆蓋保護測試** — SCN-006
   驗證：`test-bootstrap.sh` 以隔離 `HOME` 放一份無標記的 SKILL.md，執行 `setup --agent claude-code`，斷言非 0 結束、`cmp` 原檔不變。
   完成判準：測試先紅（旗標尚不存在），S3 後轉綠。
2. 📝 **S1 模板改寫** — SCN-001、002
   驗證：`test-bootstrap.sh` 斷言部署出的 SKILL.md 含四個觸發時機、`--mode vector` 與 `MEMORIA_HOME` 判斷段落。
   完成判準：斷言全綠；依 writing-rules 檢查每段答得出服務哪個分支、每步有完成判準、逐句通過 no-op 測試。
3. 📝 **S2 旗標骨架** — SCN-003
   驗證：隔離 `HOME` 執行不帶旗標的 `setup`，斷言 `$HOME/.claude` 不存在；未知旗標值報錯。
   完成判準：兩條斷言全綠，既有 `test-bootstrap.sh` 案例不變。
4. 📝 **S3 寫入與覆蓋保護** — SCN-004、005、006
   相依：步驟 1、S2。
   驗證：隔離 `HOME` 跑三個情境（不存在、有標記、無標記）。
   完成判準：三個情境斷言全綠，步驟 1 的測試由紅轉綠。
5. 📝 **S4 文件**
   依 [project.md](../../agents/project.md)：`README.md`、`README.zh-TW.md`、`docs/INSTALL.md` 記載 `--agent` 與觸發時機；`setup --help` 與文件一致。
   完成判準：三份文件與 `--help` 的旗標描述一致。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| 讓 Claude Code 使用 Memoria | 手動複製 skill 到 `~/.claude/skills/` 並自行補觸發時機 | `memoria setup --agent claude-code` |
| 已有手寫的 skill | — | setup 拒絕覆蓋並說明，使用者自行決定是否移走 |

## 測試策略

| Scenario | 層級 | 位置 |
|----------|------|------|
| SCN-001、002 | 部署產物內容斷言 | `scripts/test-bootstrap.sh` |
| SCN-003～006 | CLI 端到端（隔離 `HOME`） | `scripts/test-bootstrap.sh` |

SCN-001 的「agent 實際會在該時機觸發」屬行為觀測，無法在 CI 斷言；以模板內容斷言作為等價證據，並在發布後以 recall telemetry 的使用量變化另行觀察（不列為本 issue 的通過條件）。

## 檢查清單

- [x] 所有 Scenario 已核准（2026-10-20）
- [ ] 步驟 1 的測試先紅後綠
- [ ] 模板不含任何機器特定路徑或下游專案名稱
- [ ] 改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes
