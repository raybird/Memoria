# Issue 17: BRIEF 用時間排序，所以「知道才不會出事」的記憶會被輪替掉

## 基本資訊

| 項目 | 內容 |
| --- | --- |
| Issue 編號 | 17（本地文件編號） |
| 複雜度級別 | Medium（三個交付面：新增 1 個 CLI 命令 + BRIEF 新增 pinned 區 + per-project 輸出佈局；**零 schema 變更**、零新依賴） |
| 風險等級 | Medium（輸出佈局變更會改變 `@` 注入看到的內容，屬破壞性預設值變更；新增頂層命令屬 agent 契約變更，且推翻 `CLAUDE.md` 既有的一條明文立場） |
| 狀態 | 驗收標準已核准，未實作 |
| 需求來源 | 2026-08-24，另一個 session 從「記憶消費端」做黑箱實測後交辦；本 session 對著程式碼與本機 `~/.memoria` 重跑證據後修正了其中的診斷 |
| 建立日期 | 2026-08-24 |
| 相關 | [issue-4](../issue-4/README.md)（`brief` 的來源，Phase 2 context injection）、[issue-5](../issue-5/README.md)（`memory_attributes`／`retention='durable'`／零標記 byte-identical 紀律）、[issue-7](../issue-7/README.md)（促升後自動建索引）、[docs/memory-mechanism-assessment.md](../../memory-mechanism-assessment.md)（缺點 #7「衍生視圖漂移」仍為開放項）、`src/core/db/brief.ts:52`（近期決策查詢）、`src/core/db/git-promote.ts:90`（硬寫 `impact_level`） |

## 摘要

`memoria brief` 編出的 `BRIEF.md` 會被 `CLAUDE.md` 用 `@` 每個 session 自動載入，是這套記憶唯一「不必主動查就會出現在 context 裡」的通道。但它的「近期決策」區是純時間排序，**危險程度完全不參與**——結果是「不知道就會出事」的記憶會隨時間被例行決策擠掉。

本 issue 讓 BRIEF 多一個永不輪替的 pinned 區（訊號沿用既有的 `retention='durable'`），補上讓既有記憶可被標記的入口，並讓 brief 依 cwd 產出 per-project 檔案，使各專案的 context 只帶自己的記憶加上跨專案的環境紀律。

## 根因（已於 2026-08-24 對本機 `~/.memoria` 與程式碼驗證）

### 1. `impact_level` 從來沒有被判定過，也沒有參與排序

交辦時的診斷是「`impact_level` 79% 同值，做為排序依據資訊量趨近於零」。實際更嚴重：

| 寫入路徑 | `impact_level` | 筆數 |
| --- | --- | --- |
| `src/core/db/git-promote.ts:90` | 硬寫 `'high'` | 31 |
| `src/core/memoria.ts:369`（`remember`） | 硬寫 `'medium'` | 8 |

分佈 100% 由「哪條程式碼路徑寫的」決定，沒有任何人或 agent 判斷過。而 `queryBrief` 的近期決策是：

```sql
WHERE e.event_type = 'DecisionMade' AND e.timestamp >= ? ...
ORDER BY e.timestamp DESC LIMIT ?          -- src/core/db/brief.ts:52-59
```

**連 `impact_level` 都沒有讀。** 所以它不是弱排序鍵，是排序完全不存在嚴重度維度。任何建立在 `impact_level` 現有值之上的設計都是建在沙上——這也是本 issue 不採用「把 `impact_level` 換成 `failure_mode`」的原因。

### 2. 唯一的嚴重度通道要靠人回報才存在

目前唯一能讓高危記憶留在 BRIEF 的是 UFL 高效用區，而它需要 `memoria feedback` 有回報過。本機實測：60 筆 recall telemetry 中僅 4 筆有 explicit outcome（其中 1 筆是交辦方調查時手動補的，自然產生的只有 3 筆）。

具體後果：`external-repo` 的一筆「取不到商家設定時不套用過濾」決策——不知道這件事就會在 staging 清空 764/774 個商品——時間是 2026-07-28，已被 recency 擠出近期決策區，目前**只靠那一次偶然的 explicit feedback（0.95）留在 context**，且已 27.3 天，約 2.7 天後連 30 天窗口都會出去。

### 3. `--durable` 對 `gitdec-*` 結構上無效

`upsertMemoryAttributes(dbPath, refId, patch)` 本身是泛用的，但 CLI 只透過 `remember --durable` 暴露它，而 `remember` 只會標記自己寫的那筆。`CLAUDE.md` 明載的既有機制是：

> Re-running `remember` with identical text applies markers without rewriting — that is also how an *existing* memory gets marked (there is no separate `mark` command).

該機制依賴 note id 是內容指紋，重跑同樣文字落在同一個 `note-*`。但 git 促升的決策 id 來自 `gitdec-${summary.id}-${index}`，**任何 `remember` 都構造不出它**。上述那筆正是 `gitdec-`，所以現行機制對它無效。

### 4. 單一全域 BRIEF.md 擐不住依 cwd 篩選的結果

`~/.claude/CLAUDE.md:5` 拉的是單一全域檔，沒有任何專案層 CLAUDE.md 拉自己的；而 `memoria brief` 是手動觸發（issue-4 Q3 定案，無寫入路徑觸發它）。所以「brief 吃 cwd」若仍只寫一個檔，結果是**誰最後在哪個目錄跑過就決定所有專案看到什麼**——比現在的全域快照更糟：現在是失焦，改完會變成不可預測。

## 已核准的設計決策

| # | 決策 | 取捨 |
| --- | --- | --- |
| D1 | pinned 的訊號**沿用 `retention='durable'`**，不新增 `failure_mode` 維度 | 零 schema 變更、零遷移。`durable` 現有語意是「常青事實：免衰減、免 stale 裁剪」，與「永不輪替出 BRIEF」同源。代價：需要新增標記入口（見 D2） |
| D2 | **新增 `memoria mark <refId>` 命令**，推翻 `CLAUDE.md`「there is no separate `mark` command」那條立場 | 該立場成立的前提（重跑 `remember` 即可標記既有記憶）對 `gitdec-*` 結構上不成立。`upsertMemoryAttributes` 本來就是泛用的，缺的只有 CLI 表面。屬 agent 契約變更，須同步修正 `CLAUDE.md` 該句並記入 CHANGELOG |
| D3 | 「環境類記憶」判定為 **`project` 不在 `repositories` 表** | 零新增欄位、零遷移，現有 15 筆資料 100% 乾淨切開（`memoria-ops` 8 筆未註冊；`Memoria`／`external-repo` 已註冊）。`scope` 不可用——`memoria-ops` 橫跨 `user:kevin` 7 筆與 `project:memoria-ops` 1 筆。代價：判定是衍生的，若未來真把 `memoria-ops` 註冊成 repo，它會靜默不再常駐（記入待確認事項 U-1） |
| D4 | brief 產出 **`knowledge/BRIEF-<project>.md` 與全域 `BRIEF.md` 並存**，全域那份保留為「環境類 + 跨專案摘要」 | 使用者現有的 `~/.claude/CLAUDE.md:5` 那行不用改也不會壞；per-project 那份由各專案 CLAUDE.md 自行加 `@`。這是「手動產生 + 靜態 `@` 注入」限制下唯一真的成立的方案 |

## 驗收標準（Gherkin）

### mark 命令

```gherkin
Scenario: SCN-001 標記既有的 git 促升決策為常駐
  Given 記憶庫中存在一筆 git 促升的決策事件，其 id 形如 gitdec-<summary>-<n>
  And 該 ref_id 在 memory_attributes 中沒有 retention 標記
  When 執行 memoria mark <該 ref_id> --durable
  Then 命令成功結束
  And memory_attributes 中該 ref_id 的 retention 等於 'durable'
  And events 表中該筆事件的 content 與 timestamp 未被改寫

Scenario: SCN-002 標記不存在的記憶時明確失敗
  Given 一個不存在於 events 也不存在於 sessions 的 ref_id
  When 執行 memoria mark <該 ref_id> --durable
  Then 命令以非零狀態結束並說明該 ref_id 不存在
  And memory_attributes 沒有因此新增任何列
```

### BRIEF 的 pinned 區

```gherkin
Scenario: SCN-003 pinned 區不受時間窗口與 topK 限制
  Given 有 N 筆記憶被標記為 retention='durable'
  And 其中至少一筆的時間早於 brief 的 --days 窗口
  When 執行 memoria brief
  Then BRIEF 的 pinned 區列出全部 N 筆
  And 列出的筆數不受 --days 與 topK 影響

Scenario: SCN-004 pinned 的記憶不在近期決策區重複出現
  Given 一筆 retention='durable' 的記憶，其時間落在 --days 窗口內
  When 執行 memoria brief
  Then 該記憶出現在 pinned 區
  And 該記憶不出現在「近期決策」區

Scenario: SCN-005 零標記時 BRIEF 維持原樣
  Given 記憶庫中沒有任何記憶被標記為 retention='durable'
  When 執行 memoria brief
  Then BRIEF 不出現 pinned 區的標題或任何佔位內容
  And 產出的檔案內容與本 issue 實作前的產出 byte-identical

Scenario: SCN-006 被取代的記憶即使常駐也不進 pinned 區
  Given 一筆記憶同時具有 retention='durable' 與非空的 superseded_by
  When 執行 memoria brief
  Then 該記憶不出現在 pinned 區
  And 該記憶不出現在任何其他區塊
```

### 依 cwd 的 per-project 輸出

```gherkin
Scenario: SCN-007 在已註冊 repo 的工作目錄產出該專案的 BRIEF
  Given 目前工作目錄位於一個已在 repositories 註冊的 repo 內
  When 執行 memoria brief
  Then 產出 knowledge/BRIEF-<該 repo 的 project 名>.md
  And 該檔的近期決策只包含 project 等於該 repo 名的決策
  And 該檔不包含其他已註冊 repo 的決策

Scenario: SCN-008 環境類記憶出現在每一個專案的 BRIEF
  Given 一筆記憶的 project 不存在於 repositories 表
  And 存在兩個已註冊的 repo A 與 B
  When 分別在 A 與 B 的工作目錄執行 memoria brief
  Then 該記憶同時出現在 BRIEF-A.md 與 BRIEF-B.md

Scenario: SCN-009 工作目錄不對應任何已註冊 repo 時不猜
  Given 目前工作目錄不位於任何已註冊 repo 內
  When 執行 memoria brief
  Then 產出全域 BRIEF.md 而非任何 per-project 檔案
  And 輸出明確說明未偵測到已註冊 repo、已退回全域範圍
  And 沒有任意選擇某一個 repo 作為範圍

Scenario: SCN-010 破壞性變更可用一個旗標還原
  Given 使用者希望維持本 issue 實作前的單檔全域行為
  When 執行 memoria brief --global
  Then 只產出全域 BRIEF.md，不產出任何 per-project 檔案
  And 該檔的內容範圍與本 issue 實作前一致
```

### 可觀察性與接線

```gherkin
Scenario: SCN-011 環境類記憶的筆數在輸出可見
  Given 記憶庫中有 N 筆 project 不在 repositories 表的記憶
  When 執行 memoria brief
  Then 人類可讀輸出報出環境類記憶筆數等於 N
  And --json 輸出有對應欄位且值等於 N

Scenario: SCN-012 環境類記憶的漂移看得見
  Given 已執行過一次 memoria brief 並報出環境類筆數 N
  And 其中一個 project 隨後被 repo add 註冊為 repository
  When 再次執行 memoria brief
  Then 報出的環境類筆數小於 N
  And 該變化不需使用者另外查詢即可從輸出察覺

Scenario: SCN-013 產出 per-project 檔後印出接線指引
  Given 目前工作目錄位於已註冊 repo A 內
  When 執行 memoria brief
  Then 產出 knowledge/BRIEF-A.md
  And 輸出包含一行可直接複製的 @<該檔絕對路徑>
  And 該行標明它應加入該專案的 CLAUDE.md
```

## Gherkin 核准紀錄

- 核准 commit：待提交
- 核准來源：使用者於 2026-08-24 對話中明示核准，分兩輪：第一輪 SCN-001～SCN-010，第二輪 SCN-011～SCN-013（由 U-1、U-2 的處置決定後追加）
- 核准範圍：SCN-001 至 SCN-013 全部已核准，無待核准、無待重新核准（未分批且同日全部核准，依規範採單行省略形式）

## 邊界

### 可修改

- `src/core/db/brief.ts`（`queryBrief` / `renderBrief`）
- `src/cli/commands/brief.ts`（cwd 偵測、`--global` 旗標）
- 新增 `src/cli/commands/mark.ts` 與 `src/cli.ts` 的一行註冊
- `src/core/memoria.ts` 的 brief／mark 門面方法
- `CLAUDE.md`（修正「there is no separate `mark` command」該句）、`CHANGELOG.md`
- `scripts/test-cli-memory.sh` 或新增對應的 `scripts/test-*.sh`

### 不可觸及

- `memory_attributes` 的 schema（本 issue 零 schema 變更）
- `impact_level` 的既有值與寫入路徑（不遷移、不重新判定——見根因 1）
- `git-promote.ts` 的促升邏輯
- recall 的排序與 `applyMemoryAttributes` / `applyUtilityWeighting` 的先後順序（issue-5 不變式）
- 既有 CLI 命令名稱

### 不納入本 issue（另開）

- 向量覆蓋率指標與 empty-store 的 route_mode 狀態（原交辦 P0(b)）
- feedback 迴圈的結構性衰減（原交辦 P3）
- 記憶從「會議紀錄形狀」改為「可執行約束形狀」（原交辦 P4）

## 實作步驟

| # | 狀態 | 產出 | 完成判準 |
| --- | --- | --- | --- |
| 1 | **已完成**（2026-08-24） | `memoria mark <refId>` 命令，含 `--durable` / `--episodic` / `--sensitivity`，ref 存在性檢查 | SCN-001、SCN-002 通過（`scripts/test-memory-attributes.sh` 的 (H)/(I) 段，exit 0）；`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help` 均通過；`test-smoke.sh`／`test-cli-memory.sh` 無回歸 |
| 2 | 未開始 | `queryBrief` 新增 pinned 查詢（`retention='durable'` 且 `superseded_by IS NULL`），`renderBrief` 新增區塊，零標記時整區不輸出 | SCN-003、SCN-004、SCN-005、SCN-006 通過 |
| 3 | 未開始 | cwd → `repository_instances.path` → project 的解析，與 per-project 檔案輸出 | SCN-007、SCN-009 通過 |
| 4 | 未開始 | 環境類記憶判定（`project NOT IN (SELECT name FROM repositories)`）併入每個 per-project BRIEF，並在人類可讀輸出與 `--json` 報出其筆數 | SCN-008、SCN-011、SCN-012 通過 |
| 5 | 未開始 | `--global` 還原旗標 | SCN-010 通過 |
| 6 | 未開始 | 產出 per-project 檔後印出可直接複製的 `@<絕對路徑>` 接線指引 | SCN-013 通過 |
| 7 | 未開始 | `CLAUDE.md` 該句修正、`CHANGELOG.md` 記入 Added（`mark`、pinned 區）與 Changed（brief 預設輸出佈局，`--global` 可還原） | 文件與實際行為一致；`docs-check` 通過 |

## 首要驗證

**SCN-005（零標記 byte-identical）優先於其他所有項目。** 理由：它是 issue-5 為 `memory_attributes` 立下的不變式，也是本 issue 唯一會回溯影響既有使用者的地方——pinned 區是新增能力，出錯只是少了東西；但若零標記時 BRIEF 產出改變，每個沒用到本功能的使用者都會被動受影響。其次是 SCN-010，因為它是破壞性變更的逃生口，必須在 SCN-007 之前可用。

完成證據：`scripts/test-*.sh` 的紅綠燈輸出，加上在真實 `~/.memoria`（15 sessions／39 decisions／8 筆 durable）上跑一次 `memoria brief` 前後的 diff。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| U-1 | D3 的環境類判定是衍生的：若未來把 `memoria-ops` 註冊成 repo，那 8 筆操作紀律會不再常駐於每個專案 | **已解決**（2026-08-24） | 處置：不靠偵測邏輯，改由 SCN-011 在輸出報出環境類筆數、SCN-012 保證該數字下降時看得見。漂移仍可能發生，但不再靜默 |
| U-2 | per-project BRIEF 要各專案 CLAUDE.md 自行加 `@` 才會生效；`external-repo` 的 CLAUDE.md 不在本 repo 管轄範圍 | **已解決**（2026-08-24） | 處置：由 SCN-013 在 brief 產出時直接印出該加的那行，不另寫第二份說明文件——避免重蹈 v1.25.1 那次「腳本輸出與文件互相矛盾」的雷 |
| U-3 | `--days` / `topK` 對 per-project 檔案是否應有不同預設 | **已決**（2026-08-24） | 沿用現有預設（30 天／topK 10），不另立數字。理由：目前沒有資料能支持任何別的值，拍一個只是換一個猜。實際使用後若 per-project 窗口經常為空，再依 issue-16 的量測紀律重新評估 |
| U-4 | `mark` 目前只標記傳入的那一個 ref，不會自動連帶標記 `note-*` ↔ `noteev-*` 的另一半；`remember --durable` 則兩半都標（`memoria.ts:405-412`）。對 SCN-001 的 `gitdec-*` 無影響（它沒有配對半），但 `mark note-xxx --durable` 會只標到一半 | **未決**（2026-08-24 實作步驟 1 時浮現） | 不阻塞步驟 1——SCN-001／SCN-002 都不涉及配對。刻意未實作：配對屬未經核准的行為，依規範不得擅自寫入。步驟 2 的 pinned 查詢若以 `hit.id` 比對，需先決定要補一個 Scenario 還是接受不對稱 |

## Gate 豁免紀錄

- **豁免項目**：`/new-issue` skill 要求以 `docs/AGENTS.md`（≥ 1.17）與 `docs/agents/{document-types,readme-templates,issue-checklist}.md` 作為分級、驗收標準形式與待確認事項格式的單一真相來源。
- **豁免理由**：本 repo 不存在 `docs/AGENTS.md`，也不存在 `docs/agents/` 目錄——這不是版本落後，是該套治理文件從未存在於本 repo。root 的 `AGENTS.md` 是工程指南（build／test／架構／code style），語意不符且無版本號。
- **核准**：使用者於 2026-08-24 明示選擇「沿用 repo 既有格式」，保留 skill 的逐題澄清與驗收標準核准流程，文件結構比照 `docs/issues/issue-16/README.md`。
- **殘留差異**：本 repo 既有 16 個 issue 均未使用 Gherkin；本 issue 是首次使用 `SCN-` 編號，屬使用者明示核准的增量，非既有慣例。
