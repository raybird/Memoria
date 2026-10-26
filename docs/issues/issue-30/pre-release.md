# Issue 30 合併與發版前文件檢查

日期：2026-10-26。使用者要求「可以幫我合併，然後發版前確認一下有沒有說明文件或 readme 需要一併更新」。本次完成合併及文件整理，沒有執行版本 bump、tag、npm publish 或 GitHub Release。

## 合併依據

- 原 main／origin/main：`f89d6754a9eaa534c5ce018716698ddb70164721`，fetch 後沒有新變更。
- 產品 Reviewed HEAD：`f7dfba28abec652fdcc3fbfb9fd6bb7cab970c82`，[完整獨立報告](./review-f7dfba2.md) PASS。
- 報告提交：`51ee396f8fc1a78a19c6a419cde0ca3c24cc6da2`，verify-artifact 輸出「只有新增本次報告；原 review 可依其真實判定沿用」。
- 實際執行 `git switch main`、`git merge --ff-only issue-30-memory-ui`，main fast-forward 至 `51ee396`。這是 fast-forward，沒有額外 merge commit。後續本檔所述提交只改文件，不修改已通過審查的產品／測試／打包行為。

## 文件檢查與更新

| 文件 | 結果 |
| --- | --- |
| README.md／README.zh-TW.md | UI 入口原在 License 後，移入正式使用導覽，新增能力列、啟動／資料根／前景關閉說明，明示目前未發版與 checkout 命令；更新舊驗證日期／版本描述。 |
| docs/CLI.md／CLI.zh-TW.md | 核對 loopback、scope、唯讀、搜尋與網址資訊；補齊 Tab／Enter／Escape、啟動 JSON 與埠衝突。 |
| docs/API.md／API.zh-TW.md | 路由、參數、envelope、Host／Origin／Fetch Metadata、CSP 與唯讀限制已齊；補齊 16 KiB 以上的 413 錯誤碼。 |
| docs/INSTALL.md | 已說明資產內嵌 npm／tar、無額外前端、build 後使用，無需重複修改。 |
| docs/OPERATIONS.md | 已有指定資料根、doctor、BRIEF.md／遙測及停止程序說明；補上取消僅停止 UI 呈現、後端可能繼續計算及重連解析真正類型。 |
| CHANGELOG.md | 新增 Unreleased 的功能、邊界、相容性／升級及驗證摘要；不把新功能寫成已發布的 1.32.0。 |
| SPEC.md | 補上已實作的本機 UI 範圍；同時修正既有 setup 說明，區分裸 --vector 暖機與完整 onboarding ingest。 |
| AGENTS.md | 同步 CI http-mcp 的兩支 UI 測試與順序；依 writing-rules 保留既有局部 UI 觸發指引，不增加常駐重複規則。 |
| docs/agents/architecture.md | 已記模組邊界、Core 搜尋聚合、唯讀初始化選項與內嵌資產，與實作一致，無需修改。 |
| RELEASE.md | 補上 UI 契約與隔離瀏覽器驗收入口；正式發布時更新 README 可用版本、CHANGELOG 與 HANDOVER 真實出貨列。 |
| docs/HANDOVER.md | 新增目前版本／已合併未發版狀態、交付與審查依據、下一步；將舊摘要明列歷史，保留原日期。出貨表保持實際已發布版本。 |
| issue-30 README／implementation-plan | 回填實際合併與完整 PASS 依據，Task 3.2 完成，產品需求結案；發版狀態另列。 |

SDK／adapter／部署 skill 的行為與路徑未因 UI 改變，現有安裝與整合說明不需另增 UI 接線或遷移程序。這是文件修訂，沒有新的功能驗收或規格修訂。

## 實際驗證

本機 Linux x64、Node v22.20.0，產品版本仍為 1.32.0，已合併程式與產品審查版本相同；本次未提交工作區只改上列 markdown。依序執行：

- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs serve --help`、`pnpm run release:docs-check`：全部 exit 0；help 有 --ui／--json／--port，doc sync 回報 v1.32.0 通過。
- Python 靜態檢查當時 14 份變更文件的 105 個相對連結、README UI 標題位置及雙語章節數、AGENTS 與 CI http-mcp 五支測試順序：PASS。本檔新增後重驗最終集合：15 份 markdown-only 文件、108 個相對連結均有效，exit 0。
- `npm pack --dry-run --json` 加獨立檔案清單斷言：exit 0，32 個檔案，包含兩份 README、CHANGELOG、dist/cli.mjs，沒有 work/ 原型或 ui-browser-fixture。
- `git diff --check`：exit 0。

本次不以文件檢查冒充重新執行全部產品測試；既有 [驗收與回歸證據](./verification.md) 仍適用未變的產品。推送後 main 的完整 CI 結果以其固定 SHA 的 GitHub Actions run 為準，不在尚未執行時預填綠燈。本次文件提交另由獨立 reviewer 核對差異與實作契約。

## 尚未發布的事項

正式發布仍依 RELEASE.md：保存本地原型並使工作區符合 prepare 守門，取得 main 乾淨 CI，選擇實際版本，將 Unreleased 移入版本章節、更新 README 未發版提示與 HANDOVER 出貨列，再由 release 腳本發布及驗證。首次新增 UI 建議 minor，未先建立版本號或虛構出貨紀錄。`work/ui-concept/` 保留原狀且不加入此次提交。
