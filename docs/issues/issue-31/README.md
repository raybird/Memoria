# Issue 31 - 多個 agent 收尾時卡住：半寫入的筆記讓向量修法永遠補不完，每次又全量重 embed

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 概述

2026-11-10 維護者機器上，幾個 agent 收尾時同時卡住好幾分鐘。原因是三個缺陷疊在一起：

1. **`remember --type skill` 留下半寫入的筆記。** Skills 檔名直接用整段筆記文字的 slug，沒有長度上限。一筆 300 多 bytes 的技巧筆記在寫檔時報 `ENAMETOOLONG`，但 session 與事件已經寫進 DB，記憶節點和 skills 列都沒有產生。用同一段文字重試會回 `ok:true, created:false`，殘骸卻一直留著。
2. **doctor 的向量修法補不到這筆。** payload 產生器只會帶有記憶節點的 session，沒有節點的 session 永遠進不了 payload。所以修法每次都成功，vector coverage 卻永遠是 `missing=2`；skill 的收尾判準是 `missing=0`，於是 agent 一再重跑修法。
3. **每次修法都要全量重 embed。** builder 沒有游標，`vector-ingest.mjs` 也不會跳過沒變的列，所以缺 2 筆也要重 embed 全部 2,183 筆。實測一次約 3.5 分鐘、2.6GB RSS，大約佔滿 5 顆核心。幾個 agent 一起跑時互搶 CPU，寫入時再排隊等 300 秒的寫入鎖。

本 issue 修正這三處。殘骸已在 2026-11-10 從本機資料根刪除，刪除前有備份。

## 快速導覽

### 當前流程
長名稱 skill 筆記 → DB 寫入 → 寫 Skills 檔 `ENAMETOOLONG` → 命令失敗、DB 留下沒有節點的 session → doctor 回報 `missing>0` → 修法全量 embed 約 3.5 分 → 仍是 `missing>0` → 下一個 agent 再跑一次

### 修正後流程
長名稱 skill 筆記 → 檔名截斷並加雜湊 → 寫入完成。其他 I/O 失敗時撤回這次新建的筆記。doctor 發現沒有節點的 session 時，修法先跑 `memoria index build`。ingest 只 embed 新增或內容有變的列，缺 2 筆就只 embed 2 筆；寫入維持逐列提交，大批寫入期間語意召回照常。

## 關鍵差異

| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| Skills 檔名 | 完整 slug，可能超過 255 bytes | slug 超過 200 bytes 時截斷在字元邊界，加 `_<8 碼雜湊>` |
| 新筆記寫衍生檔失敗 | DB 留下半寫入的 session／事件，重試回報假成功 | 撤回這次新建的 session 與事件，命令失敗，重試會完整寫入 |
| `vector-ingest.mjs` | 每列都重 embed、逐列提交 | 跳過 name／kind／text 都沒變的列，沒有要寫的列時不載入模型；寫入維持逐列提交（2026-11-10 依審查 M-1 修訂，原為單一交易） |
| doctor | 只看 vector coverage | tree index 有缺口時多一行 `tree index`，向量修法前面串上 `memoria index build` |

## 涉及檔案

```text
src/core/
├── utils.ts              # 可改：Skills 檔名長度上限 helper
├── db/sync.ts            # 可改：extractSkills 用新的檔名規則
├── db/memory-note.ts     # 可改：撤回新筆記的刪除函式
├── memoria.ts            # 可改：rememberNote 失敗時撤回
├── db/telemetry.ts       # 可改：新增唯讀的 readMemoryIndexCoverage；queryStats 不動
├── index.ts、db/index.ts # 可改：barrel 匯出新函式
└── db/recall.ts          # 不可觸及：buildMemoryIndex 行為不變
src/cli/commands/doctor.ts    # 可改：tree index 檢查與修法前綴
src/cli/shared.ts             # 可改：sync --dry-run 預覽的 Skills 路徑用同一套檔名規則
skills/memoria-vector/
├── vector-ingest.mjs     # 可改：跳過未變更列，維持逐列提交
├── embed.mjs             # 不可觸及
└── vector-recall.mjs     # 不可觸及：recall 契約不變
skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs  # 不可觸及
scripts/test-cli-memory.sh    # 可改：SCN-001～003
scripts/test-vector-recall.sh # 可改：SCN-004、SCN-005
docs/OPERATIONS.md、skills/memoria-vector/README.md、docs/CLI.md、docs/CLI.zh-TW.md、docs/agents/project.md  # 常青文件與地雷
```

## Gherkin 驗收劇本

```gherkin
Feature: 多個 agent 寫記憶並收尾時不會卡住

  @SCN-001
  Scenario: 長名稱 skill 筆記完整寫入
    Given 一個已初始化的資料根
    When 執行 remember 寫入一筆 slug 超過 255 bytes 的 --type skill 筆記
    Then 命令成功，回傳 created: true
    And knowledge/Skills 下的檔名不超過 255 bytes，結尾是 "_<8 碼十六進位>.md"
    And stats 的 memoryIndex.missing 為 0
    And slug 不超過 200 bytes 的 skill 筆記，檔名與變更前相同

  @SCN-002
  Scenario: 新筆記寫衍生檔失敗時撤回
    Given 一個 knowledge/Skills 目錄無法寫入的資料根
    When 執行 remember 寫入一筆新的 --type skill 筆記
    Then 命令以非 0 結束並顯示錯誤
    And DB 中沒有這筆筆記的 session 與事件，recall 也查不到它
    When 恢復目錄權限後用同一段文字再執行一次
    Then 命令成功，回傳 created: true，memoryIndex.missing 為 0

  @SCN-003
  Scenario: 撤回不影響既有記憶
    Given 資料根已有一筆完整寫入的筆記 A
    And knowledge/Skills 目錄無法寫入
    When 寫入另一筆新的 skill 筆記 B 失敗
    Then 筆記 A 的 session、事件與記憶節點都還在，recall 查得到 A
    When 用 A 的同一段文字重跑 remember
    Then 回傳 created: false，A 不被刪除

  @SCN-004
  Scenario: ingest 只 embed 新增或內容有變的列
    Given 一個已用某份 payload ingest 過的向量庫
    When 用同一份 payload 再 ingest 一次
    Then 輸出 embedded 為 0、unchanged 為上次 embed 的筆數，向量列的 updated_at 不變
    When payload 中一筆實體的文字改變，另新增一筆實體後再 ingest
    Then 輸出 embedded 為 2，其餘列計入 unchanged，兩筆的向量與文字更新為新內容
    And 有其他行程持有寫入鎖時，有列要寫的 ingest 仍會等鎖並成功
    When 一次 ingest 要寫入 1500 筆，期間反覆執行語意召回
    Then 每次召回都成功回應，沒有因 SQLITE_BUSY 退回字面查詢

  @SCN-005
  Scenario: doctor 對沒有記憶節點的 session 給出可補齊的修法
    Given 設好 LIBSQL_URL 的資料根，其中有一個 session 沒有記憶節點
    When 執行 doctor
    Then 出現 tree index 檢查並標示失敗，顯示缺漏數
    And vector coverage 的修法以 memoria index build 開頭
    When 照印出的修法執行後再跑 doctor
    Then tree index 與 vector coverage 的 missing 都是 0
    And 沒有 tree index 缺口時，vector coverage 的修法不含 index build

  @SCN-006
  Scenario: 真實語料上的修法與並行 ingest 在時限內完成（維護者機器，local embedding）
    Given 真實資料根的副本（約 2,180 筆可 embed 實體），向量庫缺 2 筆
    When 執行 doctor 印出的修法
    Then 30 秒內完成，ingest 輸出 embedded 為 2，doctor 回報 missing=0
    When 再刪掉 2 筆向量後，同時啟動 4 支 ingest
    Then 4 支都在 60 秒內成功結束，doctor 回報 missing=0
```

## Gherkin 核准紀錄
- **核准 commit**: 4cfd0e2
- **核准來源**: 使用者 2026-11-10 對話。修正方向：選「開 issue 再實作」，接受三處修法表（檔名限制長度並加雜湊後綴、先寫檔失敗就不留 DB 記錄；跳過 name 與 text 都沒變的列、寫入包成一個交易；有缺漏時先建記憶節點）。Q1「撤回這次新建的 note」；Q2「只寫進文件」（換模型要先刪 vectors.db 再 ingest，不加旗標或 schema）；Q3「修法前面加 index build」（含「doctor 多一行 tree index 檢查」）；Q4「缺 2 筆 30 秒；4 支並行 60 秒」。TBD-1（ingest 輸出新增 `unchanged`、`embedded` 改為本次實際寫入數）：使用者 2026-11-10 回覆「那麼可以開始修，修好再寫」。規格修訂（SCN-004 新增大批 ingest 期間召回不失敗；寫入由單一交易改回逐列提交）：使用者 2026-11-10 對審查 M-1 選「改回逐列提交」（TBD-3）。

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-11-10 | 已核准 |
| SCN-002 | 2026-11-10 | 已核准 |
| SCN-003 | 2026-11-10 | 已核准 |
| SCN-004 | 2026-11-10 | 已核准 |
| SCN-005 | 2026-11-10 | 已核准 |
| SCN-006 | 2026-11-10 | 已核准 |

## 重構步驟概要

任務清單與狀態只在 [implementation-plan.md](./implementation-plan.md)「實作步驟」維護。

## 風險與首要驗證

- **最大風險**：「跳過未變更列」判斷錯誤。若比對用的文字在 builder 每次產生時都會變（例如含時間戳），就省不下任何工夫；若誤判為沒變，語意召回會靜默拿到舊向量。另一個風險是撤回的範圍：只要誤刪既有記憶就是資料損失。
- **風險等級與理由**：Medium。比對可靠度是真實資料樣態的未知；撤回限定在 `noteExists` 為 false、這次呼叫才建立的 id，範圍可控，也有 SCN-003 防護。
- **首要驗證**：以真實資料根做資料盤點。用目前的 builder 產生 payload，依 ingest 的文字組法和向量庫既有列比對 kind 與 text。
- **選擇理由**：比對結果直接決定效能目標能不能達成、會不會誤判，比先寫實作再量測更早排除方案失效。
- **完成證據**：2026-11-10 盤點結果 `{ entities: 2183, same: 2183, changed: 0, missing: 0 }`，內容已記在 implementation-plan 步驟 1。撤回的範圍由 SCN-003 的回歸測試守住。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | `vector-ingest.mjs` 輸出新增 `unchanged` 欄位，`embedded` 改為「本次實際 embed 並寫入的筆數」（原本是 payload 中可 embed 的總數）；`skipped` 維持「不可 embed 的實體數」 | 已解決 | 使用者 2026-11-10 回覆「那麼可以開始修，修好再寫」，同意此輸出格式。SCN-004 已核准；`test-vector-recall.sh` 重複 ingest 同一份 payload 的斷言隨之修改 |
| TBD-2 | 兩個 agent 同時寫入完全相同的新筆記、其中一個寫衍生檔失敗時，撤回可能刪掉另一個剛寫好的同 id 筆記 | 不影響本次交付 | 追蹤：無。同一段文字、同一時刻、其中一方 I/O 失敗才會發生；後果是重跑 remember 即可恢復，不值得為此加鎖。2026-11-10 |
| TBD-3 | 審查 review-1d86717 M-1（需決策）：ingest 寫入包成單一交易後，大批寫入期間同時進行的語意召回超過 1.5 秒上限而 SQLITE_BUSY（2,500 筆實測 9 次失敗 7 次） | 已解決 | 使用者 2026-11-10 選「改回逐列提交」：保留跳過未變更列，寫入改回逐列提交，並追加大批 ingest 期間 recall 不失敗的回歸測試；規格中「單一交易」一項隨之修訂。影響 SCN-004 |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-11-10 | 建立；SCN-001～003、005、006 依對話核准，SCN-004 待確認輸出格式 | - |
| 2026-11-10 | TBD-1 解決，SCN-004 核准，開始實作 | - |
| 2026-11-10 | 獨立審查 review-1d86717：RETURN TO execute-task（M-1 需決策）；使用者決定改回逐列提交（TBD-3） | - |
| 2026-11-10 | 規格修訂：SCN-004 新增大批 ingest 期間召回不失敗，同日重新核准；寫入改回逐列提交 | - |
| 2026-11-10 | 第二輪獨立審查 review-1b30d7d：PASS | - |
| 2026-11-10 | fast-forward 併入 main（1d077ad） | - |

---
**建立日期**: 2026-11-10  
**分級**: Medium  
**風險**: Medium\
**狀態**: 已完成
