# Issue 33 - 多個程式同時寫同一份資料根：repo sync 重複記錄事件、Daily 筆記掉資料

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 概述

一個下游 repo 常同時開好幾個 worktree，每個 worktree 各跑一個 agent，全都寫同一份 `~/.memoria`。skill 型部署每次都另開一個 `memoria` CLI 程式。目前的保護只在單一程式內有效，跨程式同時執行時有兩處會出錯，2026-11-17 已在隔離資料根上重現：

1. **`repo sync` 重複記錄。** 同一個 repo 的所有 worktree 在 Memoria 裡是同一個 repository。`withRepoSyncLock`（`src/core/memoria.ts:151`）只讓同一程式內的 sync 排隊，程式註解與 `docs/OPERATIONS.md:490` 都把跨程式列為 v1 已知限制。兩個程式同時 sync 同一個 repo（一次 `--no-ff` merge 加一個 tag），每一種事件都記錄了兩次：`git_events` 17 筆，單獨 sync 的對照組是 9 筆，`merge_commit_discovered` 也是 2 筆；目前有效的 ref 也多一份（`git_refs` 中 `is_current=1` 的每個 ref 各 2 列）。
2. **Daily 筆記掉資料。** `syncDailyNote`（`src/core/db/sync.ts:23-29`）先讀出整份 `knowledge/Daily/<日期>.md`、接上新的一筆再整份寫回，沒有鎖。16 個程式同時 `remember`，5 輪中有 2 輪 Daily 只有 15 筆，資料庫是 16 筆。

同一組實驗裡沒有任何程式遇到 `database is locked`。資料庫的鎖等待時間目前沒有在程式中設定，沿用 better-sqlite3 的預設 5 秒；這次維持 5 秒，只改成在程式中明確寫出，並用測試守住這條界線。

本 issue 只修鎖與並行寫入。記憶是否依 worktree／分支隔離不在範圍內（2026-11-17 對話決定先做鎖修正）。

## 快速導覽

### 當前流程
worktree A、B 各自執行 `memoria repo sync <repo>` → 兩個程式都讀到同一份舊的 ref 狀態 → 各自比對、各自寫入 → 每個事件與目前有效的 ref 都多一份

### 修正後流程
worktree A 取得該 repo 的 sync 租約 → B 發現租約有效，等待 → A 完成並釋放 → B 取得租約，讀到 A 寫入後的狀態，沒有新東西可記

## 關鍵差異

| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 同一 repo 跨程式同時 sync | 各自寫入，事件與 ref 重複 | 依序執行，結果與單獨 sync 相同 |
| 另一個程式 sync 太久 | 不會發生（不等待） | 等到上限後報 `repository_sync_busy`，什麼都不寫；HTTP 回 409 |
| 握著租約的程式當掉 | 不適用 | 租約過期後下一個 sync 可接手 |
| Daily 筆記 | 讀出整份再寫回 | 直接附加在檔尾，檔頭只在建立時寫一次 |
| 資料庫鎖等待時間 | 未設定，沿用預設 5 秒 | 在程式中明確設定為 5 秒，行為不變 |

## 涉及檔案

```text
src/core/
├── db/connection.ts      # 可改：withDb 開連線時帶上鎖等待時間
├── db/schema.ts          # 可改：initDatabase 帶上鎖等待時間；migration 18 新增 git_sync_leases
├── db/verify.ts          # 可改：唯讀開連線時帶上同一個等待時間
├── db/git-sync-lease.ts  # 新增：租約的取得、續約、釋放與查詢
├── db/sync.ts            # 可改：syncDailyNote 改為附加寫入
├── memoria.ts            # 可改：performRepoSync 在程式內鎖之後再取跨程式租約
├── db/git-scan.ts        # 不可觸及：掃描與事件寫入邏輯不變
└── git/                  # 不可觸及
src/server.ts             # 可改：repository_sync_busy 對應 409
scripts/test-repo-edge.sh # 可改：跨程式同時 sync、租約逾時與接手
scripts/test-cli-memory.sh # 可改：同時 remember 的 Daily 筆數、鎖等待
docs/OPERATIONS.md、docs/API.md、docs/API.zh-TW.md、docs/agents/architecture.md  # 常青文件
```

## Gherkin 驗收劇本

```gherkin
Feature: 多個程式同時使用同一份資料根時，記錄不重複、不遺失

  Background:
    Given 一個已初始化的資料根
    And 一個已註冊的 git repository，註冊後新增了 feature 分支、一次 --no-ff merge 與一個 tag

  @SCN-001
  Scenario: 兩個程式同時 sync 同一個 repo，結果與單獨 sync 相同
    When 兩個程式同時執行 repo sync 該 repo
    Then 兩個命令都以 0 結束並回傳 ok: true
    And 各種 git 事件的筆數與只執行一次 repo sync 的對照資料根相同
    And 每個 ref 只有一列 is_current=1
    And 租約表中沒有留下任何租約

  @SCN-002
  Scenario: 另一個程式 sync 超過等待上限時報錯且不寫入
    Given 該 repo 有一筆尚未過期的 sync 租約，持有者是另一個程式
    When 以較短的等待上限執行 repo sync 該 repo
    Then 命令以非 0 結束，錯誤以 "repository_sync_busy" 開頭，並寫出持有者的 pid、主機與開始時間
    And 這次呼叫沒有新增 scan run、commit、ref 或事件
    And 透過 HTTP 呼叫 POST /v1/repos/:ref/sync 時回 409

  @SCN-003
  Scenario: 持有租約的程式當掉後，下一個 sync 可以接手
    Given 該 repo 有一筆已過期的 sync 租約，持有者已不存在
    When 執行 repo sync 該 repo
    Then 命令以 0 結束，不必等到等待上限
    And 事件筆數與沒有殘留租約時相同
    And 租約表中沒有留下任何租約

  @SCN-004
  Scenario: dry-run 等待進行中的 sync，但不寫入任何東西
    Given 該 repo 有一筆尚未過期的 sync 租約，持有者是另一個程式，稍後會釋放
    When 執行 repo sync --dry-run 該 repo
    Then 它等到租約釋放後才回傳預覽結果
    And 這次呼叫沒有新增或修改租約、scan run、commit、ref 或事件

  @SCN-005
  Scenario: 多個程式同時 remember，Daily 筆記一筆不少
    When 16 個程式同時各 remember 一筆不同的筆記
    Then 資料庫有 16 個 session
    And 當天的 Daily 筆記有 16 筆條目，且只有一個檔頭
    And 單獨 remember 時，Daily 筆記的內容與變更前逐位元組相同

  @SCN-006
  Scenario: 寫入鎖的等待以 5 秒為界
    Given 另一個程式取得資料庫的寫入鎖並持有 2 秒
    When 在這段期間執行 remember
    Then 命令在鎖釋放後以 0 結束，筆記寫入成功
    Given 另一個程式取得資料庫的寫入鎖並持有 8 秒
    When 在這段期間執行 remember 另一筆筆記
    Then 寫入等待約 5 秒後放棄，命令以非 0 結束，錯誤含 "database is locked"
    And 撤回寫到一半的筆記時會再等同一把鎖，最多再 5 秒，所以命令在約 5～10 秒之間結束
    And 資料庫中沒有這筆筆記
```

## Gherkin 核准紀錄
- **核准 commit**: 待提交
- **核准來源**: 2026-11-17 對話。使用者要求「先做鎖修正」，選「先寫 issue 文件」審閱後，對 SCN-001～006 選「核准並開始實作」。TBD-1 選「維持 5 秒，只改成明確寫出」，該選項的說明為「行為不變；SCN-006 改為描述 5 秒的界線」，SCN-006 依此改寫；TBD-2 選「等 120 秒後報錯」；TBD-3／TBD-4 選「照建議」（409；dry-run 只等待、不取得租約）。2026-11-18 對話：SCN-006 依實測修訂為「寫入等約 5 秒後放棄，總計約 5～10 秒」（TBD-5）後，使用者回覆「確認」，重新核准。

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-11-17 | 已核准 |
| SCN-002 | 2026-11-17 | 已核准 |
| SCN-003 | 2026-11-17 | 已核准 |
| SCN-004 | 2026-11-17 | 已核准 |
| SCN-005 | 2026-11-17 | 已核准 |
| SCN-006 | 2026-11-18 | 已核准 |

## 重構步驟概要

任務清單與狀態只在 [implementation-plan.md](./implementation-plan.md)「實作步驟」維護。

## 風險與首要驗證

- **最大風險**：租約出錯會讓 sync 完全停擺。例如當掉的持有者留下的租約一直不過期，或續約在長時間 sync 中停掉，下一個程式在 sync 途中接手，又回到重複寫入。其次，鎖等待時間會改變每一條資料庫連線的行為（`withDb` 影響分析 CRITICAL，50 個直接呼叫者；`initDatabase` CRITICAL，28 個）。
- **風險等級與理由**：High。改動範圍小，但會作用在每一次資料庫存取與每一次 repo sync 上；sync 停擺時，git 記憶就不會再被收集。
- **首要驗證**：主要實作前，先把 2026-11-17 的跨程式重現寫成 `test-repo-edge.sh` 的測試並取得紅燈（事件 17 筆 vs 對照組 9 筆），同時寫好殘留租約接手（SCN-003）與等待逾時（SCN-002）的測試。
- **選擇理由**：重複記錄只有在真正的跨程式並行下才會出現，單元層級無法證明租約真的擋住它；殘留租約與逾時是停擺的兩種形式，要和主要路徑一起守住。
- **完成證據**：SCN-001 測試在修改前紅燈、修改後綠燈，連跑 10 次都綠；SCN-002、SCN-003 綠燈；`core`、`repo`、`http-mcp` 三組 CI 腳本全綠。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | 資料庫鎖等待時間要設多少 | 已解決 | 2026-11-17 使用者選「維持 5 秒，只改成明確寫出」。實驗中 16 個程式同時寫入沒有失敗過，沒有證據需要更長。SCN-006 改為描述 5 秒界線；步驟 4 不改變行為，改記等價證據 |
| TBD-2 | sync 租約被佔住時最多等多久、逾時後怎麼辦 | 已解決 | 2026-11-17 使用者選「等 120 秒後報錯」：逾時報 `repository_sync_busy`，等待上限可用 `MEMORIA_REPO_SYNC_WAIT_MS` 調整（比照 `MEMORIA_GIT_TIMEOUT_MS`）。SCN-002、SCN-003 |
| TBD-3 | HTTP 遇到 `repository_sync_busy` 回什麼狀態碼 | 已解決 | 2026-11-17 使用者「照建議」：409，與既有的 `summary_not_pending` 同為「目前狀態不允許這次操作」。SCN-002 |
| TBD-4 | dry-run 遇到進行中的 sync 怎麼辦 | 已解決 | 2026-11-17 使用者「照建議」：只等待、不取得租約。dry-run 承諾什麼都不寫（spec §19.4），取得租約本身就是寫入。SCN-004 |
| TBD-5 | SCN-006 的失敗時間：characterization test 實測（2026-11-17，修改鎖等待設定之前）8 秒的鎖期間 `remember` 在 8033ms 才失敗。追蹤顯示 `INSERT INTO sessions` 在 5006ms 正確放棄，接著 issue-31 的撤回 `DELETE FROM events` 等到持有者釋放才完成。原本核准的「約 5 秒後以非 0 結束」與現況不符，改為「寫入等約 5 秒後放棄，總計約 5～10 秒」 | 已解決 | 2026-11-18 使用者確認修訂後的寫法，SCN-006 重新核准；步驟 4 的等價證據依修訂後的判準取得 |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-11-17 | 建立；在隔離資料根重現跨程式重複事件與 Daily 掉資料；全部 Scenario 待核准 | - |
| 2026-11-17 | TBD-1～4 解決，SCN-006 依 TBD-1 改為 5 秒界線；SCN-001～006 核准，開始實作 | - |
| 2026-11-17 | 規格修訂：SCN-006 的失敗時間依實測改為約 5～10 秒（TBD-5），待重新核准 | - |
| 2026-11-18 | SCN-006 重新核准（TBD-5 解決）；步驟 1～7 全部完成，待提交 | - |

---
**建立日期**: 2026-11-17  
**分級**: Medium（migration 加 1 張表 + 新增租約模組 + 3 處寫入點；零新依賴，不新增命令或旗標）  
**風險**: High — `withDb` 與 `initDatabase` 影響分析為 CRITICAL；租約出錯會讓所有 repo sync 停擺\
**狀態**: **實作完成**（待提交與審查）
