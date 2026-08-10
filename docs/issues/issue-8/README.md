# Issue 8: 語意召回的 helper 是 spawn-per-query 且無並行上限，每個行程吃 450–624MB

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 8（本地文件編號） |
| 複雜度級別 | 待評估（傾向 Medium；加並行閘門不難，但「上限設多少 / 超限怎麼辦」需要決策） |
| 狀態 | **待評估**（分析完成，未拍板、未實作） |
| 需求來源 | 2026-08-10 調查另一台主機「被拖垮」時做的資源量測。**該主機的問題最後確認不是這一項**（見「與那次調查的關係」），但量測本身暴露了一個獨立的設計缺口 |
| 建立日期 | 2026-08-10 |
| 相關 | `docs/RFC-semantic-recall.md` §14.1（spawn-per-query 的原始決策）、`src/core/recall-vector.ts` |

## 摘要

`recallVector` 每次呼叫都 `spawn` 一個 helper 行程去載入 embedding 模型並查詢向量。**沒有任何並行閘門**——沒有 semaphore、沒有佇列、沒有行程池。單一查詢的成本可以接受，但並行時直接線性疊加，而每個行程的峰值記憶體是 **450–624MB**、CPU 約 **1.8 個核心**。

在資源受限的機器上，數個並行召回就足以耗盡記憶體並讓 CPU 飽和。

## 實測證據（2026-08-10，Intel i5-11400 / 12 核 / 31GB）

單次 spawn（`/usr/bin/time -v`）：

```
Maximum resident set size: 638,716 KB  ≈ 624 MB
User time 1.86s + System 0.35s = 2.21s CPU
Elapsed (wall) 1.24s          → 約 1.78 個核心
```

對照純字面召回的整個 CLI 行程：**74 MB / 0.08s**。

4 個並行 spawn 時，`ps` 觀察到四個 447–452MB 的 helper 行程同時存在。線性外推：

| 並行召回 | 記憶體 | 需要的核心 |
|---|---|---|
| 1 | ~0.6 GB | 1.8 |
| 4 | ~2.4 GB | 7.2 |
| 8 | ~4.8 GB | 14.4 |

> **2026-08-10 修正**：本節原本以「8GB / 4 核」為推估基準，並據此宣稱 4 個並行就會把機器推進
> swap。**那個規格是錯的**——它出自對另一台主機的臆測，而該主機的實測資料（`freeze-monitor`
> 的 `metrics-*.tsv`）顯示 `mem_available` 在 **17.9–28.3 GB** 之間（實體記憶體至少 32GB），
> 且單一行程曾吃到 **427% CPU**（至少 5 核以上）。上表因此改為不綁定機型的線性外推。
>
> 這件事**削弱了本 issue 的緊迫性**：目前已知會跑 Memoria 的機器都在 32GB 級距，4 個並行召回
> 佔 ~2.4GB 並不構成壓力。缺口本身依然成立（無閘門就是無上限），但它現在是**理論缺口**而非
> 迫在眉睫的風險——真正會痛的場景是多客戶端 HTTP server 部署，或日後真的部署到低配機器。

## 為什麼原始決策沒有涵蓋這點

`docs/RFC-semantic-recall.md` §14.1 拍板：

> 單筆推理 ~3ms、已快取冷啟動 ~950ms → **spawn-per-query 即可行，原 Phase 2 的長駐 pooling 機制整個免掉**

這個判斷在**單一查詢**下完全正確。缺的是並行維度：`~700MB devDeps` 當時被當成「安裝體積」，沒有被當成「**每個行程的常駐記憶體**」——模型與 runtime 是載進 RSS 的，不是留在磁碟上。

## 已經做對的部分（不要重做）

- `runHelper` 的 timeout 會 `child.kill('SIGKILL')`，行程**不會**殘留累積。
- 整條路徑 fail-open：helper 失敗或逾時都降級到字面召回，不會讓 recall 失敗。

所以缺的**只有**並行閘門。

## 影響面

| 情境 | 是否受影響 |
|---|---|
| HTTP server 同時服務多個 recall 請求 | **是**——每個請求各自 spawn |
| 多個 agent／多個容器共用一台主機 | **是** |
| CLI 單次 `memoria recall --mode vector` | 否（一次一個） |
| 沒有設 `LIBSQL_URL` / 未安裝 helper 依賴 | 否（走不到這條路徑） |

## 與那次調查的關係（重要，避免誤植因果）

這個 issue 源自調查另一台主機被拖垮的過程，但**那台的原因不是這一項**：檢查其部署設定後確認它沒有啟用語意召回（無 `MEMORIA_EMBED_PROVIDER` / vector 相關設定，`LIBSQL_URL` 只出現在 opencode 的 `mcp-memory-libsql` 設定裡），其 Memoria 資料量為 783 sessions／711 nodes，三條召回路徑在該量級都是毫秒級。

一併量測排除的候選：

| 候選 | 實測 | 判定 |
|---|---|---|
| `recallTree` 整表載入 | 200k nodes → rss 500MB | 慢，不足以癱瘓 |
| LIKE fallback（無 FTS 的舊 DB） | 100k sessions / 200k events → 185ms，rss 幾乎不變 | 純 CPU，不吃記憶體 |
| vector helper spawn | 450–624MB／次 | **本 issue**，但那台沒啟用 |

換句話說：本 issue 是**潛在風險**，不是已發生事故的根因。記錄於此以免日後把兩件事混為一談。

### 那台主機的真正原因（2026-08-10 定案，非本 issue）

後續取得該主機 `freeze-monitor` 的原始資料（`metrics-*.tsv` / `docker-*.tsv` / `events.log`）與
`journalctl --list-boots`，查明是**兩件互不相干的事**，都與 Memoria 無關：

| 現象 | 根因 | 關鍵證據 |
|---|---|---|
| 8/09 兩次瞬間重開（19:11、19:42） | **CPU 過熱觸發硬體 thermal shutdown** | boot id 三度更迭（間隔 84s / 64s 冷開機），無 clean shutdown；四個 boot 的 `journalctl -p err` 全空，而 `/var/log/journal` 早已持久化——錯誤根本沒機會落盤；斷電前最後一次採樣 CPU 溫度 **10 秒跳 21.4°C（53.2 → 74.6）**，同時 `cargo test` 的測試二進位吃 427% CPU 全核滿載；`events.log` 另錄有 **103.1°C** 的歷史高點 |
| 8/10 09:32–09:48 全機卡頓 16 分鐘 | **`fstrim`**（systemd `fstrim.timer`，每週一） | 時間戳與 stall 事件起點一秒不差；`disk_busy_ms` 1–2 → **10052–12633**（取樣間隔 10000ms，即磁碟滿載）；`nvme_temp` 42.9 → 53.9°C；全程 `memory_psi_full = 0.00`、`mem_available` 26GB 紋風不動 |

兩次事件都**明確排除**了 Memoria：它從未出現在 `top_processes` / `top_memory_processes`（兩個
session 共 0 次命中），容器 `oom_killed` 為 0。第一次凍結時 top 名單裡的 `adapters-924bdf` 一度
可疑，查證後確認是 **cargo 的測試二進位**（`<crate>-<hash>` 命名，同一筆裡 `cargo` 也在跑），
Memoria 全專案沒有產生該名稱的程式碼。

順帶一提，這次調查也修正了本 issue 的規格前提——見上方「2026-08-10 修正」。

## 修法選項（未拍板）

| 方案 | 說明 | 疑慮 |
|---|---|---|
| A. 並行閘門（semaphore） | 限制同時最多 N 個 helper；超限者排隊 | 排隊會拉長尾延遲，可能撞上呼叫端的 recall timeout |
| B. 並行閘門 + 超限直接降級 | 超過上限就當作 `vector_unavailable`，走字面召回 | 語意召回變成「盡力而為」——高負載時靜默退化，需要 telemetry 讓它可見 |
| C. 長駐 helper（RFC 原本放棄的 pooling） | 模型只載入一次，記憶體從 N×600MB 降為常駐一份 | 行程生命週期、健康檢查、崩潰重啟都要管；與「core 零新增依賴、helper 可有可無」的定位衝突 |
| D. 不修，文件警告 | 零風險 | 靠部署者自己知道；而這正是最容易被忽略的那種知識 |

**傾向 B**（閘門 + 降級，並記 telemetry），因為它同時保住 fail-open 語意與資源上限；C 是真正的根治但代價大，值得等實際負載資料再決定。

## 待確認

1. 上限預設值該是多少？是否要能以環境變數覆寫（比照 `MEMORIA_VECTOR_TIMEOUT_MS`）？
2. 超限時排隊（A）還是降級（B）——取決於呼叫端更在意「拿到語意結果」還是「準時回應」。已知有容器化部署把 `MEMORIA_RECALL_TIMEOUT_MS` 設到 1500，排隊很可能直接撞牆。
3. 降級是否要新增一個 route_mode（如 `vector_saturated`）以便與 `vector_unavailable` 區分？沒有區分的話，telemetry 會把「沒裝 helper」和「負載過高」混在一起。
4. helper 的記憶體峰值能否降低（例如換更小的量化模型、或限制 transformers 的執行緒數）？這會改變上限的合理值。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-10 | 調查另一台主機被拖垮時量到 helper 的資源足跡；確認該主機未啟用語意召回、原因另有他因；本項作為獨立的潛在風險立案 |

---
**建立日期**: 2026-08-10
**最後更新**: 2026-08-10
**文件版本**: 1.0
**狀態**: **待評估**
