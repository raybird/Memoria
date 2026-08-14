# Issue 15: 自然語言中文查詢變成單一 token，必須整句逐字出現才召得回

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 15（本地文件編號） |
| 複雜度級別 | Medium（改的是 `tokenizeQuery`，而它同時餵給**檢索**與**評分**兩條路；與 issue-9 剛定義的 confidence 尺度耦合） |
| 風險等級 | Medium（會改變匹配行為，精確度可能下降；既有測試的預期會動） |
| 狀態 | **未實作**（待設計） |
| 需求來源 | 2026-08-13，downstream-http-sidecar 修完自身的 summary／scope 問題後仍有 3/7 查詢落空，追出全部是整句中文；本 session 在使用者真實 `~/.memoria` 上獨立驗證 |
| 建立日期 | 2026-08-13 |
| 相關 | `src/core/utils.ts:21-34`（`TOKEN_SPLIT_PATTERN` / `tokenizeQuery`）、`src/core/db/recall.ts`（`recallKeyword` → FTS MATCH → LIKE fallback）、`src/core/db/schema.ts:48-59`（trigram FTS）；[issue-9](../issue-9/README.md)（記過同一個 tokenizer 行為，但把後果侷限在 confidence） |

## 摘要

```js
export const TOKEN_SPLIT_PATTERN = /[^a-z0-9一-鿿]+/
```

CJK 字元全部被視為 token 內字元，而中文沒有空白分隔，所以**一整句中文問句 tokenize 之後是一個 token**。那個 token 接著被要求「整句逐字出現」才算匹配——自然語言問句幾乎必然落空。

關鍵在於 `tokenizeQuery` 同時餵兩條路：`tokenCoverage`（評分／`confidence`）**與**檢索用的查詢構成。issue-9 已經記過這個 tokenizer 行為，但當時把後果侷限在「confidence 回報失真」。實測顯示它也**吃掉召回結果**——比 issue-9 描述的嚴重一級：不是分數難看，是真的召不到。

## 實測證據（2026-08-13，使用者真實 `~/.memoria`，`--mode keyword`）

| 查詢 | 命中 | 說明 |
|---|---|---|
| `精準停` | 2 | 連續 CJK 子字串，逐字存在於記憶中 |
| `一律用` | 2 | 同上 |
| `PID` | 2 | 拉丁字正常 |
| `pkill` | 2 | 同上 |
| `不要用 pkill` | 2 | 混合，拉丁字帶動 |
| **`停止伺服器行程要注意什麼`** | **0** | 整句成為單一 token |
| `語意召回的 helper 裝在哪裡` | 3 | **命中由 `helper` 帶來，非中文部分** |

下游在自己的語料上的對照（同一機制）：

```
「幫我看一下排程設定」 → 0 筆       「排程 設定」 → 2 筆
「記憶庫多大」         → 0 筆       「記憶庫 大小」 → 1 筆
```

### 一個不算證據的案例，記下來免得誤導

`停 伺服器 行程` → 0 筆。這**不是** tokenizer 問題：使用者的記憶寫的是 `server` 不是 `伺服器`，也沒有 `行程` 二字。那是詞彙差異，正確行為就是 0 筆。分析時差點把它算進去。

## 根因

**不是 FTS 索引的能力問題。** `recall_fts` 用的是 `tokenize='trigram'`（`schema.ts:57`），trigram 本來就能做 CJK 子字串匹配——上表前兩列證明了連續中文子字串確實命中。

問題出在**我們餵給它什麼**：`tokenizeQuery` 把整句交出去，於是 trigram 匹配退化成「整串必須連續出現」，LIKE fallback（`%整句%`）同樣是逐字比對。索引有能力，查詢沒有給它機會。

## 影響面

- **本 repo 使用者的日常路徑**：`CLAUDE.md` 要 agent 執行 `memoria recall "<查詢>"`，而 agent 問的是自然語言中文。目前只有 `mode:'vector'` 救得回來，而那需要 `LIBSQL_URL` + helper（opt-in）。純字面路徑基本上召不到。
- **每個下游都得各補一次**：下游已在呼叫端自行切詞解決，但那是一份活在 Memoria 之外的實作。這與 issue-13 決定讓 `/v1/brief` 回傳 `data.markdown`、而非讓每個呼叫端自己重寫 `renderBrief` 是**同一個論證**。

## 待設計（動工前要先決定）

1. **切分策略**：下游用的是「以停用詞斷句後切重疊 2-gram」（先斷句是為了避免跨語意邊界的假相鄰），完整鏈路 1/3 → 3/3。要不要採同一形狀，或用 trigram 對齊 FTS 的 tokenizer？
2. **精確度代價**：短 n-gram 會提高召回、降低精確度。`recall` 有 bm25 排序與 top-k，可能吸收得掉，但需要用真實語料量測，不能用推論定案。
3. **與 issue-9 的耦合**：`tokenCoverage` 是 `confidence` 的來源，issue-9 才剛把它的尺度語意定清楚。改變 tokenize 會改變 confidence 的數值分佈——要決定 confidence 是否跟著改用新切分，或維持原樣（兩者各自成立，但必須是明示的選擇）。
4. **作用範圍**：只改查詢端，或連索引端一起？只改查詢端不需要重建索引，成本低很多。
5. **既有測試**：`test-pure-functions.sh` 直接斷言 `tokenizeQuery` / `tokenCoverage`，預期值會變動；那是預期內的，但要逐條確認每個變動都是想要的。

## 驗收標準（待設計定案後補齊）

- [ ] 自然語言中文問句能召回逐字不重疊但語意相關的記憶（以真實語料量測，附修正前後對照）
- [ ] 拉丁字與混合查詢的既有行為不退步
- [ ] 精確度變化有量測數字，不是推論
- [ ] `confidence` 語意的處置是明示決定，並在 CHANGELOG 寫明
- [ ] `test-pure-functions.sh` 的預期值變動逐條確認過
