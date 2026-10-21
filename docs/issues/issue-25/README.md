# Issue 25 - 語意召回 helper 的依賴與模型搬出全域套件目錄，升級不再清空

## 概述

[issue-23](../issue-23/README.md) 讓「全域 `npm i -g` 升級會清空語意召回」在 doctor 與文件裡看得到，但沒有消除它：helper 的依賴（`@libsql/client`、`@huggingface/transformers`，完整約 723MB）與 e5 模型快取（121MB，transformers.js 預設放在它自己的套件目錄 `.cache/`）都在全域套件的 `skills/memoria-vector/node_modules` 裡，每次升級都整個消失，要重裝並重新下載模型。

本 issue 把兩者搬到升級不會碰的使用者快取目錄，並新增安裝入口：
- **依賴**放到 `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<hash>/`，`<hash>` 取自 helper `package-lock.json` 的內容。依賴沒變的升級直接沿用；依賴有變時換一個新目錄，舊 helper 不會載到新版依賴、新 helper 也不會載到舊版依賴。
- **模型快取**放到 `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/models/`，與依賴版本無關，跨升級共用。
- **安裝**由 `memoria setup --vector` 負責：把依賴裝進上述目錄並暖機一次。doctor 的修法改為指向它。

決策來源：使用者 2026-10-21 對三題回覆「照建議」——Q1 依賴放使用者快取目錄並以依賴清單雜湊分目錄、Q2 新增安裝命令、Q3 模型快取一起搬。

**不可動的既有契約**（`docs/HANDOVER.md` §8）：已知下游把 `vector-recall.mjs` 的完整路徑寫死在設定裡，並把 `skills/memoria-vector`（連同自己的 `node_modules` 與模型）打進唯讀 image。所以 helper 腳本**不搬位置**；helper 旁邊有 `node_modules` 時，行為與模型快取位置都維持現狀，新目錄只在旁邊沒有依賴時才使用。

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 快速導覽

### 當前流程
`npm i -g` 升級 → 套件目錄被換掉，helper 的 `node_modules` 與模型一起消失 → recall 靜默退回字面比對 → 使用者照 doctor 修法在套件目錄裡 `npm install`、暖機（重新下載 121MB 模型）

### 重構後流程
`memoria setup --vector` 一次 → 依賴與模型在使用者快取目錄 → 升級後 helper 照樣找得到，recall 維持 `hybrid_vector`；只有新版本換了依賴時，doctor 才要求再跑一次 `setup --vector`

## 關鍵差異
| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 依賴位置 | 全域套件內 `skills/memoria-vector/node_modules` | helper 旁邊有就用旁邊；否則 `~/.cache/memoria/vector/<hash>/node_modules` |
| 模型快取 | `node_modules/@huggingface/transformers/.cache/` | 依賴來自旁邊時不變；來自快取目錄時改用 `~/.cache/memoria/vector/models/` |
| 安裝方式 | 在套件目錄裡手動 `npm install` | `memoria setup --vector` |
| 升級影響 | 每次都清空 | 依賴清單不變就不受影響 |

## 涉及檔案
### 語意召回 helper
- `skills/memoria-vector/deps.mjs`（新）- 依賴與模型快取位置的解析：旁邊的 `node_modules` 優先，否則快取目錄
- `skills/memoria-vector/embed.mjs`、`vector-recall.mjs`、`vector-ingest.mjs` - 改經由 `deps.mjs` 載入依賴
### 核心與 CLI
- `src/core/recall-vector.ts` - `inspectVectorLayer` 的 embedder 探測涵蓋快取目錄；`probeDepsLocation`（執行 `node deps.mjs`）供 doctor 與 setup 共用
- `src/core/index.ts` - 匯出 `probeDepsLocation`
- `src/cli/runtime.ts` - `installVectorDeps`
- `src/cli/commands/setup.ts` - `--vector` 旗標
- `src/cli/commands/doctor.ts` - embedder 修法改指向 `setup --vector`
### 測試
- `scripts/test-vector-recall.sh` - 快取目錄解析、旁邊優先、doctor 探測
- `scripts/test-bootstrap.sh` - `setup --vector`
- `scripts/test-npm-install.sh`、`scripts/test-no-clone-install.sh` - `deps.mjs` 與 `package-lock.json` 隨套件發佈
### 文件
- `skills/memoria-vector/README.md`、`docs/INSTALL.md`、`docs/OPERATIONS.md`、`docs/MCP_INTEGRATION.md`、`README.md`、`README.zh-TW.md`、`CLAUDE.md`、`AGENTS.md`（helper 依賴位置說明）

## Gherkin 驗收劇本

```gherkin
Feature: 語意召回的依賴與模型撐過全域升級

  Background:
    Given 全域安裝的 memoria，LIBSQL_URL 已設，provider 為 local
    And helper 目錄旁邊沒有 node_modules

  @SCN-001
  Scenario: setup --vector 安裝依賴並暖機
    When 執行 memoria setup --vector
    Then 依賴裝在 ~/.cache/memoria/vector/<helper package-lock.json 的雜湊>/ 底下
    And 模型下載到 ~/.cache/memoria/vector/models/ 底下
    And doctor 的 vector embedder 為通過，並指出依賴所在目錄
    And 下一次 recall --mode vector 的 route_mode 為 hybrid_vector

  @SCN-002
  Scenario: 依賴清單不變的升級不影響語意召回
    Given 已執行過 setup --vector
    When 全域套件目錄被換成依賴清單相同的新版本（helper 旁邊仍沒有 node_modules）
    Then 不需重裝，doctor 的 vector embedder 仍為通過
    And recall --mode vector 的 route_mode 為 hybrid_vector，且沒有重新下載模型

  @SCN-003
  Scenario: 新版本換了依賴時要求重裝
    Given 快取目錄只有舊依賴清單對應的安裝
    When helper 的 package-lock.json 內容改變
    Then doctor 的 vector embedder 為失敗，修法指出 memoria setup --vector
    And helper 不會載入舊依賴清單對應的目錄

  @SCN-004
  Scenario: helper 旁邊自帶依賴時行為不變
    Given helper 目錄旁邊有 node_modules（開發者 checkout 或下游自帶的 image）
    When 執行 recall --mode vector 與 doctor
    Then 依賴從旁邊的 node_modules 載入
    And 模型快取位置維持 transformers.js 的預設，不寫入 ~/.cache/memoria
    And doctor 的 vector embedder 判定與變更前相同

  @SCN-005
  Scenario: vector-ingest 使用同一套解析
    Given 已執行過 setup --vector，helper 旁邊沒有 node_modules
    When 執行 vector-ingest.mjs 匯入 payload
    Then 依賴從快取目錄載入，向量寫入成功

  @SCN-006
  Scenario: 安裝失敗時不留下可用的假象
    When setup --vector 的依賴安裝失敗（例如 npm 不可用或下載中斷）
    Then 命令以非 0 結束並印出失敗原因
    And doctor 的 vector embedder 仍為失敗，不會把未完成的目錄當成已安裝
```

## Gherkin 核准紀錄
- **核准 commit**: 0f2a550
- **核准來源**: 範圍與方向——使用者 2026-10-21 對 Q1～Q3 回覆「照建議」（Q1：依賴放使用者快取目錄、以依賴清單雜湊分目錄；Q2：新增安裝命令，例如 `memoria setup --vector`；Q3：模型快取一起搬）。各 Scenario 的具體行為由規劃推導（含安裝入口定為 `setup --vector` 旗標），使用者 2026-10-21 回覆「照建議」全部核准

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-10-21 | 已核准 |
| SCN-002 | 2026-10-21 | 已核准 |
| SCN-003 | 2026-10-21 | 已核准 |
| SCN-004 | 2026-10-21 | 已核准 |
| SCN-005 | 2026-10-21 | 已核准 |
| SCN-006 | 2026-10-21 | 已核准 |

## 重構步驟概要
1. ✅ **S0 可行性驗證（Node 18）** - Node 18／22 spike 通過，採 CJS 進入點
2. ✅ **S1 helper 依賴解析** - `deps.mjs`，SCN-003／004／005
3. ✅ **S2 doctor 探測與修法** - SCN-001／003／004
4. ✅ **S3 `setup --vector`** - SCN-001／002／006（local provider 實機驗證）
5. ✅ **S4 常青文件** - 已完成

## 風險與首要驗證

- **最大風險**：ESM 的 bare import 只沿著匯入檔案所在目錄往上找 `node_modules`，Node 18 也不支援以 `NODE_PATH` 影響 ESM。要從 helper 以外的目錄載入依賴，必須自行解析進入點。`@huggingface/transformers` 還會帶出 onnxruntime-node 的原生 addon 與 sharp 等相依，從非標準位置載入時能否正常運作，目前沒有證據。另一個風險是動到下游依賴的「旁邊 `node_modules`」路徑。
- **風險等級與理由**：Medium。核心外部行為（Node 18 下的載入方式）尚未確認，但失敗會被 fail-open 擋住（recall 退回字面比對），不會遺失資料；下游路徑以「旁邊優先、行為不變」的 SCN-004 防護。
- **首要驗證**：S0 先在 Node 18 與 Node 22 各做一次 spike：依賴裝在另一個目錄、helper 旁邊沒有 `node_modules`，以 `deps.mjs` 的解析方式載入兩個依賴，實際完成一次 local provider 的 embed 與 libSQL 查詢。
- **選擇理由**：整個設計成立與否取決於這一點，失敗時要改走別的方案（例如在快取目錄放 helper 的複本），應該在寫任何正式程式前知道。
- **完成證據**：兩個 Node 版本的 spike 都輸出 384 維向量與 `vector_top_k` 結果，記錄命令與輸出；任一失敗則停下來回報，並提出替代方案。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | SCN-001～SCN-006 需使用者核准 | 已解決 | 2026-10-21 使用者回覆「照建議」，全部核准 |
| TBD-2 | 快取目錄裡舊雜湊的目錄會累積（每份約 720MB），本次不自動清理，只在文件說明可以刪除 | 已解決 | 不影響已列 Scenario；之後要清理再另開 |
| TBD-3 | 快取目錄是否另外提供 env 覆寫；本次只依 `XDG_CACHE_HOME`，不新增 Memoria 自己的 env | 已解決 | 不影響已列 Scenario |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-21 | 建立；Q1～Q3 方向決策（「照建議」） | - |
| 2026-10-21 | SCN-001～SCN-006 核准，TBD-2、TBD-3 維持本次不做（「照建議」） | - |
| 2026-10-21 | S0～S4 完成；local provider 以隔離 prefix 實機驗證升級前後 | - |

---
**建立日期**: 2026-10-21  
**分級**: Medium  
**風險**: Medium\
**狀態**: 進行中
