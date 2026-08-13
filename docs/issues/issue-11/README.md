# Issue 11: `@huggingface/transformers` 掛在 helper 的 devDependencies，但 `MEMORIA_EMBED_PROVIDER=local` 時是執行期必需

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 11（本地文件編號） |
| 複雜度級別 | Small（改的是一個 `package.json` 欄位；但選哪個方案需要拍板，見下） |
| 風險等級 | Low（失敗有明確錯誤訊息，不是靜默降級——與 [issue-10](../issue-10/README.md) 不同） |
| 狀態 | **未實作**（待拍板） |
| 需求來源 | 2026-08-13 另一 session 分析 Memoria 升級機制時發現，經本 session 查證 |
| 建立日期 | 2026-08-13 |
| 相關 | [issue-10](../issue-10/README.md)（helper 根本沒被交付）、[issue-12](../issue-12/README.md)（doctor 應該要能講出這個狀態） |

## 摘要

`skills/memoria-vector/package.json`：

```json
"dependencies":    { "@libsql/client": "^0.17.2" },
"devDependencies": { "@huggingface/transformers": "^4.2.0" }
```

但 `embed.mjs` 的預設 provider 就是 `local`（`:60` — `process.env.MEMORIA_EMBED_PROVIDER ?? 'local'`），而 local provider 在 `:25` 動態 import `@huggingface/transformers`。

於是：在 helper 目錄跑 `npm install --omit=dev`（或設了 `NODE_ENV=production`）會裝出一個**預設設定下跑不動的 helper**——只有 `@libsql/client`，沒有 embedding 後端。

## 實際行為

`embed.mjs:23-31` 的 import 有 try/catch，失敗時丟出：

```
MEMORIA_EMBED_PROVIDER=local requires @huggingface/transformers —
run `npm install` inside skills/memoria-vector, or set MEMORIA_EMBED_PROVIDER=stub.
```

訊息本身是好的：明確、可行動、指出兩條出路。所以這**不是** issue-10 那種靜默失效，嚴重度低一級。問題在於「`npm install` 會裝好」這個前提，恰恰在 production 安裝慣例（`--omit=dev`、`NODE_ENV=production`、多數容器 image 的預設）下不成立，而錯誤訊息沒有提醒這件事。

## 這是刻意的取捨，不是單純的分類錯誤

helper 的 `description` 寫得很清楚：

> Deliberately OUTSIDE Memoria's core dependencies — installed on demand, spawned via `node:child_process`, never imported by `src/`.

`@huggingface/transformers` 連同模型權重約 850MB。把它移到 `dependencies` 會讓每個裝 helper 的人都付這個代價，包含只想用 `MEMORIA_EMBED_PROVIDER=stub` 跑測試的人。所以這需要拍板而不是直接改。

## 候選方案

| 方案 | 內容 | 代價 |
|---|---|---|
| A | 移到 `dependencies` | helper 安裝一律 ~850MB；stub-only 使用者被迫付費 |
| B | 移到 `optionalDependencies` | 預設會裝，安裝失敗不中斷；但 `--omit=optional` 一樣會漏，只是換一個旗標 |
| C | 留在 devDependencies，改文件與錯誤訊息 | 零安裝成本；但把正確性交給使用者記得加 `--include=dev` |
| D | C + [issue-12](../issue-12/README.md) 的 doctor 檢查 | 保留成本結構，並讓錯誤狀態在出問題前就被說出來 |

初步傾向 **D**：`local` 是預設值但語意召回整體是 opt-in，符合 repo 一貫的「optional 保持 optional，但失效必須可見」原則（同 v1.24.0 CHANGELOG 對 `memoryIndex` 不進 `verify` 的處理）。待拍板。

## 驗收標準

- [ ] 拍板採用哪個方案
- [ ] `skills/memoria-vector/README.md` 明確寫出 production 安裝旗標對 local provider 的影響
- [ ] 若採 A/B：驗證 `npm install --omit=dev` 後 `MEMORIA_EMBED_PROVIDER=local` 可運作
- [ ] 若採 C/D：錯誤訊息補上 `--omit=dev` / `NODE_ENV=production` 這個具體成因
