# Issue 14: `db_integrity` 檢查失敗時不說出它看到什麼，使誤報無法被診斷

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 14（本地文件編號） |
| 複雜度級別 | Small（一項檢查的取值與訊息，無 schema、無契約變更） |
| 風險等級 | Low（純診斷面） |
| 狀態 | **未實作**（待排程） |
| 需求來源 | 2026-08-13，downstream-http-sidecar 在正式環境回報 `/v1/health` 穩定回 `ok:false`，唯一失敗項是 `db_integrity`，但同一個檔案獨立驗證是好的 |
| 建立日期 | 2026-08-13 |
| 相關 | `src/core/db/verify.ts:82-84`、`src/core/db/connection.ts`（連線池）；[issue-12](../issue-12/README.md)（同一種「訊號不說出自己看到什麼」的失效） |

## 根因已定位（2026-08-13 更新，本 session 完整重現）

> 本節取代原本的「根因未定位、修的只是可診斷性」。原判斷成立於當時的資訊，但下游提出跨行程這個變因後，本機重現成功了。

**長生命週期的 pooled readonly 連線，在**任何**其他行程寫過這個 DB 之後，`PRAGMA quick_check` 會誤報 FTS5 索引損壞，且不會恢復。**

```
before external write                      rows=1 ok?=true   [{"quick_check":"ok"}]
after external no-op UPDATE                rows=1 ok?=false  [{"quick_check":"malformed inverted index for FTS5 table main.recall_fts"}]
after external INSERT (fires FTS trigger)  rows=1 ok?=false  （同上）
3s later                                   rows=1 ok?=false  （不恢復）
fresh connection, same instant             ok
```

外部寫入是 `UPDATE sessions SET summary = summary`——**一列、值沒變**。連真正改到東西都不需要。

### 決定性的對照：FTS5 才是變因

先前本機重現失敗，是因為 fixture 是一張陽春表。**同樣的跨行程寫入，沒有 FTS5 就不會壞、有就會壞**：

| fixture | 跨行程寫入後 |
|---|---|
| 單一普通表 | `ok` |
| 真實 Memoria schema（`recall_fts`，trigram + triggers） | `malformed inverted index for FTS5 table main.recall_fts` |

機制是 SQLite 在完整性檢查時會呼叫 FTS5 的 integrity 檢查，而長生命週期連線上的 FTS5 快取狀態在外部寫入後失效——它拿陳舊的快取去比對，於是報出根本不存在的損壞。資料完全正常（新連線永遠是 `ok`）。

### 進一步收窄：唯讀不是變因，且只有「重開連線」能恢復

| 情境 | 外部寫入前 | 外部寫入後 |
|---|---|---|
| 長生命週期 **readonly** handle | ok | **FAIL** |
| 長生命週期 **read-write** handle | ok | **FAIL** |
| 同一條陳舊連線上重新 `prepare` | — | **FAIL**（無效） |
| **關閉後重開**連線 | — | **ok** |

兩個對實作直接有影響的結論：

1. **不是 readonly 專屬**——`withDb` 的 rw 池同樣會腐化。修法不能只針對唯讀那條。
2. **重新 prepare 不會清掉陳舊狀態，只有重開連線會。** 所以「完整性檢查改用專屬連線」必須是**每次檢查重開一條、用完關掉**，不能只是另外建一個長生命週期的池——那只是把同一個 bug 搬到另一個池裡，而且下次觸發時更難聯想到這裡。（此提醒由 downstream-http-sidecar 提出，本機實測確認。）

### 一個不重現的對照，以及它的限制

downstream-cli-container 的部署三個條件全中（FTS5 外部內容表、`SqlitePool` 長生命週期連線、三個容器同時開同一個 DB），但**在 Rust 的 sqlx（底層 libsqlite3）上不重現**——外部寫入前後 `quick_check` 皆 `ok`，FTS5 `'integrity-check'` 也 `ok`，且可見性正常（跨 pool 寫入立刻讀得到，沒有陳舊視圖）。

這把嫌疑從「SQLite 對 FTS5 + 長連線 + 跨行程寫入的固有行為」往**特定 binding 的連線狀態管理**推。

**但該對照有兩個限制，回報者自己標註了**：他們的 pool 是可寫的（不過本機實測顯示 rw 一樣會壞，所以這一項已不構成差異），而且兩個 pool 在**同一個行程**內、不是真正的跨行程。如果真正的跨行程是決定性變因，那個「不重現」就不構成反證。採信時要記得這一點。

正常運作下只有 server 自己寫，不觸發。要觸發得有**另一個行程**碰過那個 DB——例如有人在容器內用 CLI 跑一次 `remember`、`sync` 或直接開 DB 看一眼。也就是說：**「你維運過這個部署」這件事本身，會讓健康檢查從此謊報損壞，直到行程重啟。**

下游已在正式環境排除其他變因：不是版本（1.25.0 與 1.27.0 皆會）、不是連線年齡（掛 17 分鐘無外部寫入仍 `ok`）、不是資料損壞（同一時刻新連線乾淨）。

## ⚠ 這個 issue 現在有兩塊，可以分開做

1. **可診斷性**（原範圍）——失敗訊息帶出實際值。**這塊的價值已被上面的重現證明**：那句 `malformed inverted index for FTS5 table main.recall_fts` **一直都在**，是 `verify.ts:84` 用常數字串把它蓋掉的。如果它一開始就被印出來，方向在幾分鐘內就會清楚，而不是耗掉兩個 session 各自重現。
2. **誤報本身**——不要用 pooled 連線跑完整性檢查（或檢查前重開一條）。這塊是行為修正，可獨立成 issue。

## 摘要

`runVerify` 的 `db_integrity` 檢查：

```js
const quickCheck = db.prepare('PRAGMA quick_check').get() as { quick_check?: string }
const integrityOk = quickCheck?.quick_check === 'ok'
add('db_integrity', integrityOk ? 'pass' : 'fail',
    integrityOk ? 'PRAGMA quick_check=ok' : 'PRAGMA quick_check failed')
```

失敗訊息是一個**常數字串**，把 `quick_check` 實際回傳的內容整個丟掉。三個後果：

1. 回傳的若是錯誤描述字串，讀的人看不到那是什麼。
2. `.get()` 回 `undefined` 時，`?.` 讓它靜默變成 `false`——**症狀與真正的資料損壞完全相同**，而兩者該做的處置天差地遠。
3. `PRAGMA quick_check` 出錯時最多回 100 列，`.get()` 只取第一列，其餘直接消失。

`/v1/health` 的 `ok` 是所有檢查的 AND，所以這一項失敗會讓整個健康訊號永遠是 `false`。回報者引用了本 repo 自己在 issue-12 寫下的判斷——「讓從沒開啟的 opt-in 功能判失敗，等於發紅燈給每個使用者，那會訓練人忽略它」——並指出這是同一種失效，只是這次是**誤報**而不是過度檢查。

## 實測證據（2026-08-13）

**正式環境**（下游容器，v1.25.0，`MEMORIA_HOME=/data`）：`GET /v1/health` 穩定 `data.ok=false`，16 項中只有 `db_integrity` 失敗，`db_connect` 與所有 `table_*` / `columns_*` 皆 pass。

**同一個容器、同一個檔案、新開的連線**：

```
PRAGMA quick_check    → [{"quick_check":"ok"}]   （列數 1）
PRAGMA integrity_check → [{"integrity_check":"ok"}]
.get() 亦回 {"quick_check":"ok"}
journal_mode = delete
```

所以**不是**多列被 `.get()` 吃掉、**不是** `undefined`、**也不是**回了錯誤描述字串——至少從一條新連線看不是。

**本機重現嘗試（本 repo，2026-08-13）**：依 server 的形狀建長生命週期 readonly handle + 另一條 read-write handle（`journal_mode=delete`），四種情境跑 `prepare('PRAGMA quick_check').get()`：

| 情境 | 結果 |
|---|---|
| idle | `{"quick_check":"ok"}` |
| writer 持有 RESERVED lock | `{"quick_check":"ok"}` |
| commit 之後 | `{"quick_check":"ok"}` |
| 另一 handle 做 DDL 之後 | `{"quick_check":"ok"}` |
| 大量寫入（25k 列）之後 | `{"quick_check":"ok"}` |

**「pooled readonly 連線」這個假設單獨不足以解釋。** 未排除的變因是**多行程**——本機實驗是單行程雙 handle，而下游的每小時同步若是另一個行程寫同一個檔案，那個形狀沒有被模擬到。

差異只存在於 server 那條從啟動起沿用的 readonly 連線裡（`connection.ts` 的 `withDb` 依 `<mode>:<path>` 快取），而那條連線從容器外觀察不到。

**第三個環境的對照（2026-08-13，downstream-cli-container）**：host 直跑（非容器）、v1.27.0、單一行程、無並發、DB 在本機檔案系統、走 CLI 的 `memoria verify` 而非 HTTP：

```
✓ db_integrity: PRAGMA quick_check=ok
- ok: yes
```

**沒有誤報。** 這把嫌疑面收窄到「容器內 + 長生命週期 pooled server 連線」這個組合，也就是唯一觀察到誤報的那個形態——與本機重現失敗的結果並不衝突，因為本機實驗雖然模擬了 pooled 連線，卻是單行程、短時間、非容器檔案系統。

## 修正方向

1. `db_integrity` 失敗時，訊息帶上**實際取得的值**。
2. 用 `.all()` 取代 `.get()`，保留多列（quick_check 最多 100 列錯誤）。
3. **區分三種狀態**：`ok` / 明確的非 ok 結果 / 取不到值（`undefined` 或擲出）。第三種目前與第二種無法分辨，但代表的意義完全不同。
4. **修掉誤報本身**（見上「兩塊」）：完整性檢查改用專屬的新連線，不走 `withDb` 的池。成本是每次 `verify` 多開一次連線——對一個本來就要掃全庫的檢查，那是可忽略的。
5. 待評估：一個可能是暫時性的完整性檢查，值不值得把整個 `/v1/health` 拖成 unhealthy。這與 issue-7 R1 對 `verify` 的判斷、issue-12 對 opt-in 的判斷是同一族問題。

### 訊息格式：不擴充 `VerifyCheck` 契約

原本考慮加結構化的 `detail: { rows: [...] }`。詢問唯一在正式環境消費這個端點的下游後**否決**：他們的 `pingMemoriaEndpoint` 只看 HTTP status，body 一個欄位都沒讀；需要細節時是人在終端機看 JSON。**為一個目前不存在的消費者擴充公開契約不划算**，人可讀字串就夠。（若日後真的出現程式化消費者，屆時帶著實際用途再加。）

## 驗收標準

- [ ] `db_integrity` 失敗時，`message` 含 `quick_check` 實際回傳的內容
- [ ] 多列結果不被截斷（或明確標示截斷了幾列，比照 no-silent-caps）
- [ ] 「取不到值」與「取得了非 ok 的值」在輸出上可分辨
- [ ] `quick_check=ok` 時的輸出與行為不變（既有測試不得改動）
- [ ] `scripts/test-http-api.sh` 或 smoke 覆蓋新的失敗訊息形狀

## 後續（非本 repo 可完成）

下游提了一個能把成因釘在「連線年齡或寫入量」上的實驗：重啟 memoria 容器後立刻打 `/v1/health`，若重啟後 pass、跑一段時間才 fail 即可定位。那是他們的正式服務，由他們自己決定要不要做。本 issue 不依賴那個結果——修好之後，下次發生時訊息自己就會帶出證據。
