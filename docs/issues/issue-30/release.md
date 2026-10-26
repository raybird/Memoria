# Issue 30 — v1.33.0 發布紀錄

## 授權與範圍

2026-10-26，使用者在合併與文件整理後要求「發布更新完畢之後就做 release」，並於斷線重連後要求繼續。依 RELEASE.md 的相容新增功能分類，本次目標為 minor `v1.33.0`。產品交付已合併，`b0f00b9` 的 [完整 CI](https://github.com/raybird/Memoria/actions/runs/40248104762) 十個 job 全部成功，包括 Node 18 smoke、Ubuntu/macOS npm 與五組 E2E。

## 發布前收斂

- 雙語 README 改為「需要 v1.33.0 或更新版本」，保留 checkout 用法；SPEC 補分段驗證日期，不把 UI 當作舊版本能力。
- issue 狀態維持已完成，出貨依據改指向 CHANGELOG／HANDOVER，不讓發版後仍留下「尚未發版」的現況標記。
- release.sh 唯一邏輯文字變更為 git commit 訊息 `chore(release): 發布 $tag`，符合專案中文提交規範；guard、測試、tag、push、等待與已發布產物驗證均不變。
- 修改 cmd_publish 前已呼叫 GitNexus upstream impact；shell 函式不在索引，回傳 UNKNOWN／Target not found。手動核對直接入口為 release.sh 的 publish 分支及 package.json 的 release:publish，修改僅影響提交訊息，沒有產品呼叫者或資料流變更。此限制如實保留，不宣稱圖分析為 LOW。
- `work/ui-concept/` 是未追蹤的本機原型，已移到 repo 外的個人 artifacts 目錄保存；前後 SHA-256 均為 `372ae2562015be07a1d1726bd7978aa957dbc128b8caec11c5852bca069772ad`。不納入版本控制、npm 或 tar。
- `bash -n scripts/release.sh`、`pnpm run release:docs-check`、`git diff --check` 均 exit 0；這輪不改產品行為，沿用已完成的產品驗收。提交訊息文字以語法檢查與完整 diff 核對，不新增鏡像測試。

## 發布完成的判準

依既有 `release:prepare minor` → 編輯 CHANGELOG／HANDOVER → `release:publish` 執行，確認 annotated tag、release workflow、四平台 tar／checksum、已發布 Linux tar parity 及 npm 精確版本。公開 tag 不重用；若發布步驟失敗，先確認實際遠端狀態並依失敗階段處理。此檔目前記發布前依據，完成事實由後續固定 tag／workflow 與 HANDOVER 出貨紀錄補明，不預填成功。
