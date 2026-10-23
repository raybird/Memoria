# 獨立審查報告

- 範圍：發版前 CI 測試依賴準備順序的局部修正，不含尚未提交的六個 release bump 檔案。
- Reviewed BASE SHA：`a24653b7b00f8a09d57636ef1161ef715418f4ce`
- Reviewed HEAD SHA：`7211b81e15419c2f1cf41660134d8bcde9133046`
- Reviewed patch-id：`40361c30bea268b34948741990f7630c79dad609`
- 獨立 reviewer：延續 issue-28 的獨立 Codex reviewer，非本修正實作者；未修改產品／測試、未提交、未委派其他 agent。
- Review artifact：`docs/issues/issue-28/review-7211b81.md`
- 日期：2026-10-23。

## 問題與風險

無 MUST FIX／SHOULD FIX。原有 helper dependency install 區塊移到 inner driver 前，修正 fresh checkout 的真實先決條件缺口；沒有刪除／弱化 assertion 或改動產品行為。

## 已查核維度

### 根因與實際 CI 紅燈

獨立讀取 [CI 39902809662 core job 120248053124](https://github.com/raybird/Memoria/actions/runs/39902809662/job/120248053124) 的失敗 log（`gh run view 39902809662 --job 120248053124 --log-failed`）：onboarding Step 1 已進入 F-3，於 `setup-onboarding-driver.mts:574` 呼叫 `runFullVectorIngest` 初始化真 libSQL store；`setup-plan.ts:409` 報 `ERR_MODULE_NOT_FOUND: Cannot find package '@libsql/client'`，job exit 1。原準備區塊在 Step 5，尚未執行。

這是測試先決依賴未及時準備；原本本機 helper 依賴既存，因而未在先前本機綠燈暴露。CI 失敗是真實訊號，不能以本機既存依賴的綠燈替代 fresh checkout 驗證，也不是缺少產品功能的 TDD 紅燈。

### 修正範圍與測試完整性

- 固定 BASE..HEAD 唯二差異為 `scripts/test-setup-onboarding.sh` 與 plan 的 CI 修正證據紀錄；已讀完整 diff。六個未提交 release bump 檔案明確排除，未將其內容納入本 PASS。
- 以程式比對 BASE／HEAD script：原 install 區塊逐位元組相同、恰有一份，現在位於 `node --import tsx scripts/setup-onboarding-driver.mts` 前。移除該區塊與新增說明註解後，兩版其餘文字完全相同。因此 fixtures、assertions、後續向量流程均未弱化。
- `git diff --exit-code BASE HEAD -- src skills package.json pnpm-lock.yaml .github` exit 0：無 runtime／helper／依賴宣告／CI gate 變更。安裝失敗仍受 `set -euo pipefail` 阻擋，不會以略過 driver 換取綠燈。既有 npm 設定／輸出方式沒有本輪改動。
- `bash -n scripts/test-setup-onboarding.sh` exit 0；shell 頂層搬移不涉及函式 symbol，GitNexus symbol impact 不適用。最小搬移沒有可再精煉內容，無須改寫測試架構。

### 獨立 fresh-helper 紅綠對照

本 reviewer 實際執行 `python3 /tmp/memoria-ci-order-review.py`，driver exit 0；建立 `/tmp/memoria-ci-order-rzprkvjr/checkout`：從固定 BASE 的 `git archive` 取得 source，套用與 HEAD 相同的候選 shell，僅連結既有**根套件** node_modules。helper node_modules 不存在，HOME／XDG cache／Memoria／libSQL env 均隔離；沒有刪改真實 helper 依賴或使用者記憶。網路與子程序依權限流程升級。

| 步驟／命令 | 實際結果 |
| --- | --- |
| 安裝前：`node --import tsx scripts/setup-onboarding-driver.mts` | exit 1；F-3 之前的 assertions 通過，精確重現 `Cannot find package '@libsql/client'` |
| 在隔離 helper 執行既有命令：`npm install --omit=dev --no-audit --no-fund` | exit 0，`added 15 packages`；不是安裝整個 local 模型 |
| 安裝後，重跑相同完整 inner driver | exit 0；F-3a／F-3b 通過，輸出 `[driver] all assertions passed` |

此對照證明把原 block 提前即可滿足新增 F-3 的真實依賴，不依賴本機 helper 的既有安裝。不是 mock 掉被驗收的 SQL 初始化。隔離 archive 的產品／driver 與固定修復 HEAD 相同，僅頂層 shell 順序不同。

主 agent 另回報 `bash scripts/test-setup-onboarding.sh` 在 sandbox 外完整 Step 1～7 exit 0，已讀 `/tmp/memoria-release-onboarding.log` 尾段的原七項、F-1／F-2 深層／F-3 與 `[setup-onboarding] ok`。首次 sandbox 受限失敗沒有當成產品綠燈。主流程本機 helper 已存在的限制，由上述 fresh-helper 對照補足。

### 與完整交付審查的關係、限制

[review-8b6c06d.md](review-8b6c06d.md) 的完整 issue-28 產品審查仍綁定其原 SHA，原七項與 F-1～F-3 的產品修復結論未被本次測試準備缺口推翻。後續 a24653b 僅新增該完整報告；本修正不改產品／assertions，故原 SCN-001～014 及已查核打包／安全證據仍可作相同產品的基線。本報告補上 fresh checkout 測試可執行性的必要修正審查，沒有把舊 PASS 自動改綁新 SHA。

本次受影響驗收／證據面為 SCN-006／007／013 的真 libSQL inner driver 與 SCN-014 的 fresh CI 可執行性；既有所有 assertions 保留。原生 macOS／Windows、模型實機與新遠端完整 CI 結果未由本 reviewer 重跑；新 CI 必須由發布流程等待實際結果，不能將本局部 PASS 當作遠端 CI 已通過。未提交的版本／CHANGELOG／安裝文件更新不在本報告範圍。

## 流程判定

**PASS（CI 測試準備順序局部修正）** — 固定 BASE..HEAD 為單一既有安裝區塊的正確搬移，真實 fresh-helper 紅燈／安裝／綠燈及完整本機 onboarding 均有證據，無產品或 assertion 變更，無未解 MUST FIX。發布仍須等待新提交的遠端 CI gate。
