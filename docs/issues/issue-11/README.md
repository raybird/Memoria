# Issue 11: `@huggingface/transformers` 掛在 helper 的 devDependencies，但 `MEMORIA_EMBED_PROVIDER=local` 時是執行期必需

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 11（本地文件編號） |
| 複雜度級別 | Small（改的是一個 `package.json` 欄位；但選哪個方案需要拍板，見下） |
| 風險等級 | Low（失敗有明確錯誤訊息，不是靜默降級——與 [issue-10](../issue-10/README.md) 不同） |
| 狀態 | **實作完成**（2026-08-13，採方案 D） |
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

初步傾向 **D**：`local` 是預設值但語意召回整體是 opt-in，符合 repo 一貫的「optional 保持 optional，但失效必須可見」原則（同 v1.24.0 CHANGELOG 對 `memoryIndex` 不進 `verify` 的處理）。

## 拍板結果（2026-08-13）：方案 D

使用者拍板採 D。決定的關鍵是 **A 與這個 helper 的存在理由相衝突**——它的 `description` 明寫「Deliberately OUTSIDE Memoria's core dependencies」，把 ~850MB 移進 `dependencies` 等於讓每個只想用 `stub` 跑測試的人替一個他不用的模型付費。B 則只是把陷阱從 `--omit=dev` 換成 `--omit=optional`，換了名字沒有消失。

D 之所以在 issue-12 交付後變得便宜：可見性那一半（`doctor` 檢查）已經在 v1.26.0 做掉了，剩下的只有「讓錯誤訊息點名成因」。

## 驗收標準

- [x] 拍板採用哪個方案 → **D**
- [x] `skills/memoria-vector/README.md` 明確寫出 production 安裝旗標對 local provider 的影響
- [x] 錯誤訊息補上 `--omit=dev` / `NODE_ENV=production` 這個具體成因
- [x] `doctor` 能報出這個狀態（v1.26.0 已交付，見 [issue-12](../issue-12/README.md)）

## 實作結果（2026-08-13）

`embed.mjs` 的錯誤訊息原文是「run `npm install` inside skills/memoria-vector」——**對一個剛剛跑完 `npm install --omit=dev` 而且看著它成功的人來說，這句話讀起來像自相矛盾**。改成點名 `--omit=dev` 與 `NODE_ENV=production` 是最常見成因，並說明 `stub` 的代價（沒有語意品質），讓兩條出路的取捨是明說的而不是暗示的。

README 加一段 callout，把「devDependency 是刻意的」與「`local` 是預設」這兩件事並排寫出來——單看任一件都不會覺得有問題，衝突只在它們相乘時出現，而那正是這個 issue 難被發現的原因。
