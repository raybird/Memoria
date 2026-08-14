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

## ⚠ 範圍界線：這個 issue 修的是「可診斷性」，不是那個誤報

根因**尚未定位**，而且雙方都卡住了（見下）。本 issue 要做的是讓下次發生時，訊息本身就能說出證據，而不是要人從外部重新驗證去反推。這一點必須寫在最前面，免得有人以為修完誤報就消失了。

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
4. 待評估（**不在本 issue 預設範圍**）：一個可能是暫時性的完整性檢查，值不值得把整個 `/v1/health` 拖成 unhealthy。這與 issue-7 R1 對 `verify` 的判斷、issue-12 對 opt-in 的判斷是同一族問題，但那是行為變更，應該分開決定。

## 驗收標準

- [ ] `db_integrity` 失敗時，`message` 含 `quick_check` 實際回傳的內容
- [ ] 多列結果不被截斷（或明確標示截斷了幾列，比照 no-silent-caps）
- [ ] 「取不到值」與「取得了非 ok 的值」在輸出上可分辨
- [ ] `quick_check=ok` 時的輸出與行為不變（既有測試不得改動）
- [ ] `scripts/test-http-api.sh` 或 smoke 覆蓋新的失敗訊息形狀

## 後續（非本 repo 可完成）

下游提了一個能把成因釘在「連線年齡或寫入量」上的實驗：重啟 memoria 容器後立刻打 `/v1/health`，若重啟後 pass、跑一段時間才 fail 即可定位。那是他們的正式服務，由他們自己決定要不要做。本 issue 不依賴那個結果——修好之後，下次發生時訊息自己就會帶出證據。
