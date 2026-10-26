# Issue 30 發布前收斂獨立審查

- 範圍：局部 diff `b0f00b9..115bcfe`，6 個檔案；雙語 README 最低版本、SPEC 分段驗證日期、issue 狀態／發布前紀錄，以及 release commit 訊息。不是重新審查 UI 產品或判定發布已完成。
- Reviewed BASE SHA：`b0f00b9ce8ef8acd38e0f739974fa01e8dd0f91d`
- Reviewed HEAD SHA：`115bcfecc5bb17e6eed41c7b60cb94189a10fa9d`
- Reviewed patch-id：`1b907185784a32782bc92e0b0e7d36b8925614fb`
- 獨立 reviewer：宿主 subagent `/root/release_review`，未參與本次實作或文件撰寫。
- Review artifact：`docs/issues/issue-30/review-115bcfe.md`
- 日期：2026-10-26；本次風險 Low（發布前說明與單一提交訊息字串）。

## 問題與風險

無 MUST FIX、SHOULD FIX 或需使用者決策的發現；無 gate 豁免。

## 已查核維度

### 授權、版本及發布事實

- 授權依協調者傳入的使用者原話及 [release.md:5](./release.md#授權與範圍)：「發布更新完畢之後就做 release」。現有合併與發布授權持續有效，本次沒有擴張產品範圍或要求重做已完成的 UI 驗收。
- `package.json` 仍為 `1.32.0`，`CHANGELOG.md` 的 UI 仍在 `[Unreleased]`，HANDOVER 實際出貨表仍止於 `v1.32.0`。依 RELEASE.md「Minor：backward-compatible features」及已合併的可選 UI 新功能，下一個 minor `v1.33.0` 的選擇合理。
- `README.md:45,87` 與 `README.zh-TW.md:45,87` 均寫 UI 需要 `v1.33.0` 或更新版本，保留 checkout 的 build／Node 入口；這是最低版本要求，沒有聲稱 npm 已發布。SPEC 第 7 行以 2026-10-26／issue-30／最低 UI 版本補充新能力，保留第 5 行舊範圍的真實驗證日期，解決前次日期範圍建議。
- issue README 第 231 行維持已完成的產品交付，將出貨依據指向 CHANGELOG／HANDOVER；歷史 Timeline 保留當時尚未發版的事實，沒有虛構 merge commit 或發布完成。
- release.md 第 18 行明列目前只記發布前依據，後續依 prepare → CHANGELOG／HANDOVER → publish 完成實際版本、workflow 及產物驗證。未預填 `v1.33.0` 的成功出貨列或 npm 結果。

### 腳本、安全與架構

- 完整固定 diff 證明 `scripts/release.sh:176` 是唯一可執行修改：`git commit -m "Release $tag"` 改為 `git commit -m "chore(release): 發布 $tag"`。符合根 AGENTS 與 project.md 的 `type(scope): 中文摘要`，沒有 AI 署名；`$tag` 仍在同一個雙引號參數內展開。
- `tag` 仍取自 `package.json` 的 version，annotated tag 的名稱及訊息、push ref、workflow 輪詢與產物驗證都未改。未新增命令注入入口、檔案／網路存取、權限或敏感資料輸出。
- 手動核對直接入口為 package.json 的 `release:publish` → `bash scripts/release.sh publish` → 腳本第 247 行 `cmd_publish`。提交訊息只影響 Git 歷史文字；沒有修改產品呼叫者、CLI／HTTP 契約、schema、runtime 依賴或安裝清單。
- GitNexus 的 `cmd_publish` upstream impact 由實作者記錄為 UNKNOWN／Target not found，因 shell 函式未索引；本次沒有把它當成 LOW 結果。reviewer 以完整腳本及入口交叉核對補足此小範圍的人工影響判斷，未修改任何 symbol。
- 以 code-simplify 標準檢查整份 diff：沒有新增業務邏輯、重複流程或過度抽象；雙語 README 是既有同步責任，發布紀錄只留本次依據與完成判準，無需額外精煉。

### 重要失敗面

| 輸入／狀態 | 預期與覆蓋 | 判定 |
| --- | --- | --- |
| 使用者仍安裝 1.32.0 | README 明示 UI 需 1.33.0，checkout 提供獨立入口；中英文版本要求一致。以固定 diff 和現有 package 版本交叉核對。 | 有效；沒有把舊套件說成已有 UI。 |
| 1.33.0 尚未真正發布 | release.md 明示發布前狀態；完成結果由後續 tag／workflow／HANDOVER 證明。正式 publish 的 CHANGELOG 及 HANDOVER 守門未變。 | 有效；本報告不預先判定發布成功。 |
| release commit 建立 | 雙引號參數保持原樣，只替換固定文字；`bash -n` 成功。未改 guard、git add、tag、push 或等待順序。 | 有效；無須真實執行不可逆發布來驗固定訊息。 |
| 髒工作區、tag 已使用、workflow 或 npm 尚未出現 | 原有拒絕條件、輪詢與失敗退出完整保留；本 diff 未弱化任何守門。 | 沿用既有行為；後續仍須由正式 publish 實跑。 |

### 證據與獨立驗證

以下均於固定 HEAD `115bcfe`、報告新增前的乾淨工作區查核，2026-10-26：

- `git diff b0f00b9ce8ef8acd38e0f739974fa01e8dd0f91d 115bcfecc5bb17e6eed41c7b60cb94189a10fa9d`：完整核對 6 檔、26 insertions／6 deletions；`git patch-id --stable` 得到上述 patch-id，merge-base 為固定 BASE。
- `bash -n scripts/release.sh`：exit 0。
- `pnpm run release:docs-check`：exit 0，`Release doc sync check passed for v1.32.0`。它證明當前 1.32.0 檔案同步，沒有冒稱已驗證不存在的 1.33.0 產物。
- `git diff --check b0f00b9ce8ef8acd38e0f739974fa01e8dd0f91d 115bcfecc5bb17e6eed41c7b60cb94189a10fa9d`：exit 0。
- `gh run view 40248104762 --json headSha,status,conclusion,jobs`：exit 0，查得 [CI 40248104762](https://github.com/raybird/Memoria/actions/runs/40248104762) 的 headSha 精確等於固定 BASE `b0f00b9`，status completed、conclusion success；10 個 job 全部 success：Static checks + build、Node 18 smoke、Ubuntu／macOS npm install、Package + no-clone install，以及 repo／wiki／core／adapters／http-mcp 五組 E2E。一次後續簡化查詢遇到網路連線失敗，依權限流程重新唯讀查詢成功；沒有以失敗查詢推定綠燈。
- `git diff --exit-code f7dfba2 115bcfe -- src scripts/build.mjs scripts/test-memory-browser.sh scripts/test-ui-http.sh scripts/test-npm-install.sh scripts/test-no-clone-install.sh .github/workflows/ci.yml .github/workflows/release.yml package.json pnpm-lock.yaml`：exit 0。產品、相關測試、CI、打包建置與依賴在原產品 PASS 後未變；另核對 [完整產品審查](./review-f7dfba2.md) 及 [合併後文件審查](./review-77524ee.md) 的固定範圍和限制。

本次沒有刪改或弱化測試。文件採版本／授權／CI／腳本事實的交叉核對，固定提交訊息採語法與完整 diff 檢查；沒有以鏡像斷言或 mock 冒充真實發布。上述既有 CI 僅綁定 BASE，不能稱為 HEAD 新跑的完整 CI；本次變更不影響產品，重用其產品驗證並補本次直接檢查合理。

### 限制與後續完成判準

- 本次不重新執行 UI 瀏覽器矩陣、全部 CI 或實際 publish；未變產品由既有完整審查與固定 BASE CI 支持。release.md 的本機原型移出及 checksum 是協調者紀錄，本 reviewer 僅確認當前工作區乾淨、diff 未納入原型，未聲稱重新取得原型兩側內容。
- 本 PASS 不涵蓋未建立的版本 bump、CHANGELOG／HANDOVER 出貨列或公開產物。後續依既有 RELEASE.md 執行 prepare／publish，完成其 guards、release workflow、四平台 tar／checksum、已發布 Linux tar parity 及 npm 精確版本驗證；發布失敗時不能把本 PASS 當成出貨成功。
- 本次僅新增指定報告，未 commit、tag、push 或 publish。協調者若新增唯一、非 merge、只加入本報告的一個直接後繼提交，須依 review-evidence.md 執行 `verify-artifact.py` 後才可沿用此 PASS；報告 SHA 不預填。

## 流程判定

**PASS（發布前局部 diff）**。必要維度已查核並持久化，無 MUST FIX；固定範圍可進入既有發布流程。本判定只綁定 Reviewed HEAD `115bcfecc5bb17e6eed41c7b60cb94189a10fa9d`，不代表 `v1.33.0` 已發布。
