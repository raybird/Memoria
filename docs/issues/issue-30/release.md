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

依既有 `release:prepare minor` → 編輯 CHANGELOG／HANDOVER → `release:publish` 執行，確認 annotated tag、release workflow、四平台 tar／checksum、已發布 Linux tar parity 及 npm 精確版本。公開 tag 不重用；若發布步驟失敗，先確認實際遠端狀態並依失敗階段處理。以上為執行前完成判準，實際結果如下。

## 正式發布結果

2026-10-26，已依使用者授權完成，沒有在斷線重連後重用或重建公開 tag：

- `115bcfe` 發布前局部獨立審查 PASS；`c0e4760` 只新增該報告，verify-artifact 輸出 OK。[此基線的完整 CI](https://github.com/raybird/Memoria/actions/runs/40273139538) 也全部成功。
- `pnpm run release:prepare minor`：exit 0，由乾淨、與 origin 同步的 main 將 1.32.0 升為 1.33.0。CHANGELOG 移入 `## [1.33.0] - 2026-10-26`，HANDOVER 先記發布準備，再依完成事實回填。
- `pnpm run release:publish`：exit 0。check、build、release:docs-check、release:package／delivery parity 全通過；smoke、bootstrap、installer-platform、service-manager、npm-install、no-clone-install 六項 gate 全部 PASS。
- 腳本建立並推送提交 `2f0d0cd94291b36d65915ebbca6c074ae0705aac`（`chore(release): 發布 v1.33.0`）及 annotated tag `v1.33.0`。`git cat-file -t v1.33.0` 為 tag，剝除 tag 後與該提交相同；沒有 merge commit 或 force push。[該 release commit 的完整 main CI](https://github.com/raybird/Memoria/actions/runs/40273413079) 成功。
- [Release workflow 40273418253](https://github.com/raybird/Memoria/actions/runs/40273418253) 綁定相同 SHA，六個 job 全部 success：Validate release、linux-x64、linux-arm64、darwin-x64、darwin-arm64、Publish release。四平台皆完成原生打包與 no-clone 安裝檢查。
- [GitHub Release v1.33.0](https://github.com/raybird/Memoria/releases/tag/v1.33.0) 為非 draft，publishedAt `2026-10-26T05:19:09Z`。公開資產共九個：install.sh、四個平台 tar.gz 及各自的 sha256 sidecar。
- 腳本下載公開 Linux tar，`check-delivery-parity.mjs` 回報 `Delivery parity check passed`。另以 `gh release download v1.33.0 --pattern 'memoria-linux-x64-v1.33.0.tar.gz*'` 取得公開 tar 與 checksum，`sha256sum -c` 回報 `memoria-linux-x64-v1.33.0.tar.gz: OK`。
- 腳本以精確版本輪詢 npm，第 8 次確認 `npm serves 1.33.0`；隨後獨立 `npm view @raybird.chen/memoria@1.33.0 version --fetch-retries=0 --fetch-timeout=20000` 也回傳 1.33.0，registry 為 `https://registry.npmjs.org/`。沒有把 registry 傳播等待誤記成發布失敗或另燒版本。

版本、README／CHANGELOG 與發布內容已同步；全域安裝升級可用 `npm i -g @raybird.chen/memoria@1.33.0`。本次不自行重跑使用者 setup、部署 hooks/service 或遷移真實記憶。此後的交接證據提交僅改文件，不變更已發布的 tag 或產物。
