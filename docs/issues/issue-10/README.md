# Issue 10: release tarball 不含 `skills/memoria-vector`——no-clone 安裝路徑的語意召回靜默不存在

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 10（本地文件編號） |
| 複雜度級別 | Small（打包腳本多複製一個目錄 + 一項安裝測試斷言，無程式碼變更） |
| 風險等級 | Medium（失效是靜默的：fail-open 退回字面召回，使用者以為語意召回在跑） |
| 狀態 | **未實作**（待排程） |
| 需求來源 | 2026-08-13 另一 session 分析 Memoria 升級機制時發現，經本 session 查證 |
| 建立日期 | 2026-08-13 |
| 相關 | [issue-11](../issue-11/README.md)（helper 裝得起來但跑不動，同一條交付鏈的下一段）、[issue-12](../issue-12/README.md)（兩者都沒有任何診斷會說出來）、[issue-7](../issue-7/README.md)（v1.23.1 修的是 npm 包不含 helper，本 issue 是 tarball 路徑的同型缺口） |

## 摘要

`scripts/package-release-artifacts.sh:47` 只複製 `skills/memoria-memory-sync`：

```bash
cp -R "$ROOT_DIR/skills/memoria-memory-sync" "$STAGE_DIR/skills/memoria-memory-sync"
```

`skills/memoria-vector` 從未進入 release tarball。**透過 `install.sh` / no-clone 路徑安裝的 Memoria，語意召回不可能運作**。

## 兩條安裝路徑只有一條壞掉

| 路徑 | vector helper | 來源 |
|---|---|---|
| `npm install @raybird.chen/memoria` | **有** | `package.json` 的 `files` 自 v1.23.1 起含 `skills/memoria-vector/*.mjs`、`package.json`、`package-lock.json`、`README.md` |
| `install.sh` / release tarball | **無** | `package-release-artifacts.sh` 只複製 `memoria-memory-sync` |

這正是本 issue 容易被漏掉的原因——v1.23.1 修好了 npm 那半邊，tarball 這半邊維持原狀，而兩者的症狀完全相同。

## 失效鏈（為什麼是靜默的）

`src/core/recall-vector.ts`：

1. `resolveHelperScript()`（:54-64）依序試 `../skills/memoria-vector/vector-recall.mjs` 與 `../../skills/...`，都不存在則回 `null`。
2. 呼叫端（:205-206）`if (!script || !existsSync(script)) return { rows: [], status: 'unavailable' }`。
3. 語意召回的 fail-open 設計把它轉成 `route_mode: 'vector_unavailable'`，**退回字面召回並正常回傳結果**。

沒有錯誤、沒有警告、沒有非零退出碼。使用者設好 `LIBSQL_URL`、跑 `recall`、拿到看似合理的結果，實際上拿到的是純字面召回。這與 issue-9 的教訓同型：語意層的失效不會自己說話。

## 修正方向

1. `package-release-artifacts.sh` 一併複製 `skills/memoria-vector`（比照 `files` 的範圍：`*.mjs` + `package.json` + `package-lock.json` + `README.md`，**不含 `node_modules`**）。
2. `scripts/test-no-clone-install.sh` 目前完全沒有提到 vector（已確認：該腳本與 `docs/INSTALL.md` 皆無任何 `vector` 字樣），需加斷言：解壓後 `skills/memoria-vector/vector-recall.mjs` 存在。沒有這條斷言，同樣的缺口會再發生一次。
3. 決定 tarball 是否也帶 `install.sh` 的 helper 安裝步驟——這牽涉 [issue-11](../issue-11/README.md) 的 ~850MB 執行期依賴，兩者應一起拍板。

## 驗收標準

- [ ] `pnpm run release:package` 產出的 tarball 內含 `skills/memoria-vector/vector-recall.mjs` 與 `embed.mjs`
- [ ] tarball **不含** `skills/memoria-vector/node_modules`
- [ ] `scripts/test-no-clone-install.sh` 斷言 helper 檔案存在，且該斷言在修正前的打包腳本上會失敗
- [ ] npm 路徑的既有行為不變
