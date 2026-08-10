# Issue 9: 語意召回成功時 `confidence` 反而回報 0——`relevance` 用字面覆蓋率算，與 RFC §5b 相違

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 9（本地文件編號） |
| 複雜度級別 | 待評估（改動點小——一個欄位的來源；但「confidence 在語意路徑該怎麼定義」是設計問題，且動到 envelope 契約） |
| 狀態 | **待評估**（根因已定位並實測驗證，未拍板、未實作） |
| 需求來源 | 2026-08-10 v1.24.0 升級後的例行驗證。順手看 `--json` 輸出時發現 `relevance` 與 `confidence` 全是 0，而命中本身是正確的 |
| 建立日期 | 2026-08-10 |
| 相關 | `docs/RFC-semantic-recall.md` §5b（原始設計明文說 confidence 應為 fused score）、`src/core/recall-vector.ts`、`src/core/memoria.ts:606`、[issue-8](../issue-8/README.md)（同一模組的另一個獨立缺口） |

## 摘要

`mode:'vector'` 召回正確命中字面完全不重疊的記憶——**這正是語意召回存在的理由**——但回傳的 `meta.confidence` 是 `0`，每個 hit 的 `relevance` 也是 `0.000`。

成因是 vector 路徑的 `relevance` 用 `tokenCoverage()`（**字面** token 覆蓋率）填值。於是形成一個自相矛盾的迴路：**語意召回越成功（查詢與記憶的字面重疊越少），回報的信心值越接近 0**。

`confidence` 是 `MemoriaResult` envelope 用來讓下游 agent 判斷「這次召回可不可信」的欄位，回 0 會被讀成「完全不可信」——而事實是它找對了。

## 實測證據（2026-08-10，v1.24.0，真實 `~/.memoria`）

查詢「停止伺服器行程要注意什麼」，對記憶「停 Memoria server 一律用 PID 精準停，不要用 pkill 樣式比對」：

```
route_mode: vector | latency: 986 ms | confidence: 0
hits: 5
  [0.000] memoria-ops | 停 Memoria server 一律用 PID 精準停，不要用 pkill 樣式比對   ← 排第 1，正確
  [0.000] memoria-ops | {"decision":"停 Memoria server 一律用 PID 精準停，...        ← 排第 2，同一則
```

排序完全正確，數值全是 0。

### 純函式驗證（`tokenCoverage` 直測）

同一則記憶當 haystack：

| 查詢 | tokenize 結果 | coverage |
|---|---|---|
| `停止伺服器行程要注意什麼` | `["停止伺服器行程要注意什麼"]` | **0.000** |
| `停 Memoria server` | `["memoria","server"]` | 1.000 |
| `pkill PID` | `["pkill","pid"]` | 1.000 |
| `how to stop the server process` | `["how","to","stop","the","server","process"]` | 0.167 |

第一列是關鍵：`TOKEN_SPLIT_PATTERN = /[^a-z0-9一-鿿]+/` 保留全部 CJK 字元，而中文沒有空白分隔，**整句話因此變成單一 token**。`tokenCoverage` 做的是 `haystack.includes(token)`，於是要求整個查詢字串原樣出現在記憶裡才算命中——中文的自然語言查詢幾乎必然得 0。

英文改寫得 0.167（"server" 有出現），所以英文下是「偏低」，中文下是「恆為 0」。

## 根因

三段串起來：

1. **`src/core/recall-vector.ts:166/170/174/181`** — `mapNamesToRows` 對每個 hit 填 `relevance: tokenCoverage(query, content)`，`score: 0`。
2. **`src/core/recall-vector.ts:208`** — `mapNamesToRows(dbPath, hits.map((h) => h.name), ...)`。helper **算了 cosine distance 並回傳**（`{name, kind, distance}`，見 `skills/memoria-vector/vector-recall.mjs:62`），但這裡只取 `name`，**distance 被整個丟棄**，再也沒有任何語意訊號進入 `VectorRow`。
3. **`src/core/memoria.ts:606`** — `confidence: hits.length > 0 ? (hits[0].relevance ?? hits[0].score) : 0`。`??` 只在 `null`/`undefined` 時 fallback，而 `relevance` 是**有效的 0**，所以永遠不會退到 `score`（RRF fused 值）。

### 與 RFC 的偏離

`docs/RFC-semantic-recall.md` §5b 明文寫：

> `confidence` becomes the top fused score (documented as a scale change; ties into the separate "decouple confidence from decay" item).

**實作沒有做到這一句。** RFC 預期 confidence 換一個尺度（fused score），實作卻讓字面 relevance 擋在前面。這是實作與設計的落差，不是設計本身的取捨。

（但 RFC 那句本身也不完全可用——見「修法選項」對方案 A 的尺度批評。照抄 RFC 只能把 0 換成 0.0164。）

## 影響範圍

| 受影響 | 程度 |
|---|---|
| `mode:'vector'` 的 `confidence` / `relevance` | **恆為 0**（中文查詢）或偏低（英文改寫） |
| `mode:'hybrid'` | **不穩定**——`hits[0]` 若來自 lexical 有真值，來自 vector 則為 0，同一查詢的信心值取決於誰排第一 |
| `mode:'keyword'` / `tree` | **不受影響**。中文長查詢在 keyword 下是 0 hits → confidence 0，那是誠實的（沒召回就是沒召回） |
| **UFL confidence×utility 校準** | **讀數失真**。vector 路徑的召回全部落進最低信心桶，校準表會呈現「低信心卻高效用」的假象 |
| `routeUtility`（v1.23.0） | 本身**不受影響**（它讀的是 observed utility，不是 confidence），但與 calibration 並列呈現時容易被一起誤讀 |

最後兩列是這個 bug 真正的代價：v1.23.0 加 `routeUtility` 就是為了用資料回答「語意召回是否勝過字面」，而 calibration 那半邊對 vector 路徑目前是沒有意義的。

## 為什麼沒有更早發現

- **召回本身是對的**。排序、命中、去重都正常，壞掉的只有隨行的元資料，e2e 測試斷言的是「召回到正確的 id」而非「confidence 合理」。
- **`test-vector-recall.sh` 用 stub provider**，斷言集中在降級矩陣（`vector_unavailable` / `vector_timeout` / route_mode 路由），沒有對數值做語意合理性斷言。
- **英文下不是 0 而是偏低**，看起來像「分數比較保守」而不像 bug。要中文查詢才會乾淨地暴露成 0。
- 只有在**真的用語意召回去問一句字面不重疊的話**、而且去看 `--json` 才會撞到。

## 修法選項

| 方案 | 做法 | 取捨 |
|---|---|---|
| A. 照 RFC §5b | `confidence` = top fused score | 忠於原設計，但 RRF fused 值是 `1/(60+rank+1)` ≈ **0.0164**，下游一樣讀成「幾乎不可信」。**把 0 換成 0.0164 不解決問題** |
| B. 用 cosine distance | `relevance = 1 - distance` | **已否決**。e5 的 cosine 有區間壓縮，絕對值跨查詢不可比——這正是當初選 RRF 的理由（RFC §5b）。用它當 confidence 等於重新引入被否決過的假設 |
| C. rank 導出的正規化信心 | 由名次映射到 0–1 | 尺度可讀，但衡量的是「排第幾」不是「多像」：第 1 名恆為滿分，沒有鑑別力，且無法表達「這批 hit 全都不太相關」 |
| D. `confidence` 回報 `null` | 語意路徑明示「無法評估」 | **語意最誠實**（0 = 確定不可信，null = 無從判斷，兩者對下游是不同指令），符合本專案 no-silent-caps 的一貫立場；但 `ResultPayload.confidence` 型別是 `number`，改動 envelope 契約 |
| E. 分路由定義 + `confidence_basis` | confidence 依 route 用不同基礎，另在 meta 明載它是怎麼算出來的 | 下游能自己決定信不信，不靜默換尺度；成本是 envelope 多一個欄位、文件與 adapter 都要同步 |

**傾向 E（可與 C 或 D 組合）**——理由是本專案對「不靜默」一向嚴格：真正的問題不是「這個數字太小」，而是「同一個欄位在不同 route 下由完全不同的東西算出來，而下游無從得知」。先讓基礎可見，再談要不要換演算法。

## 待確認

1. **`confidence` 的型別是否可以放寬為 `number | null`**——這是 envelope 契約變更，會影響 SDK、HTTP 契約與 adapter。若不可以，方案 D 出局。
2. **`hybrid_vector` 路徑要不要跟 `vector` 一致**——目前 hybrid 的 confidence 取決於 `hits[0]` 恰好來自哪一路，這個不穩定性本身就該修，但修法可能與 vector 路徑不同。
3. **UFL calibration 是否需要回溯處理**——既有 telemetry 裡 vector 路徑的 confidence 全是 0，修好之後新舊資料混在同一張校準表裡。是否需要標記分界，或按 route 分開呈現。
4. **`tokenCoverage` 的 CJK 分詞是否另案處理**——它讓「整句中文 = 一個 token」，影響不只本 issue（`HANDOVER-improvements.md` P5 已記錄 CJK token 範圍是一個待決項）。本 issue 可以不碰它（vector 路徑本就不該用字面覆蓋率），但兩者的關係應該寫清楚，避免各修各的。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-10 | v1.24.0 升級後的例行驗證中發現：vector 召回命中正確但 `confidence: 0` |
| 2026-08-10 | 根因定位完成——`tokenCoverage` 填 vector 路徑的 relevance、helper 的 distance 在 `recallVector` 被丟棄、`??` 不會 fallback；純函式直測驗證 CJK 整句單 token；比對 RFC §5b 確認實作與設計偏離。狀態：待評估 |

---

**最後更新**：2026-08-10
