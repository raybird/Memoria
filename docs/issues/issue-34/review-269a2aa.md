# 審查報告
- 範圍：完整交付範圍（`eb654e2..269a2aa`，本 repo 不開 PR，審查後 fast-forward 進 main）
- Reviewed BASE SHA：eb654e292eb097507f3782e903be715c038545e4（= main；審查者以 `git merge-base main 269a2aa` 確認 merge-base 沒變）
- Reviewed HEAD SHA：269a2aa433b51db7db555aa34a97520c1f800c4b
- Reviewed patch-id：5d46becd4a0ff8c6ed373336da618fe34b44b6a7（審查者以 `git diff eb654e2 269a2aa | git patch-id --stable` 重算，結果相同）
- 獨立 reviewer：Claude subagent（general-purpose），與實作者不同 context
- 增量覆審：上一份報告 review-a6db261.md，增量範圍 a6db261..269a2aa（處理建議 S3、N3）

審查日期：2026-11-25

採用增量覆審的條件都成立：

- review-a6db261.md 綁定 a6db261，記的是完整範圍，判定 PASS。
- a6db261 是 269a2aa 的祖先，中間只有 bafcc0f、269a2aa 兩個非 merge 提交，沒有改寫歷史。
- main 沒有前進，merge-base 仍是 eb654e2。

使用者 2026-11-25 的決定：

- S3、N3：修正。
- S1、S2：接受並記錄。
- S4：記錄，發版時寫進 CHANGELOG。
- N1、N2：不修。

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

無。

### NICE TO HAVE

- **N1. TBD-3 寫「追蹤：無」，但同一格又寫了一個還沒做的後續動作** — `docs/issues/issue-34/README.md` 的 `## 待確認事項` TBD-3 列。
  - 現況：TBD-3 的狀態是 `不影響本次交付`，寫「追蹤：無」，同一格卻寫著「發版時在本版 CHANGELOG 條目寫明……不連續」。
  - 影響：issue 合併後才會發版，這個動作只靠發版的人回頭讀這份 README 才記得做。這不會讓 dev-cycle 或懸置掃描判斷錯誤，因為狀態值和格式都合規。
  - 建議：把去向寫成發版時會讀到的地方，例如 `docs/HANDOVER.md` 的待發版事項，或寫明由下一次 `release:prepare` 編 CHANGELOG 時處理。也可以接受現狀。這一項屬於文件措辭，不阻擋。

## 已查核維度

### 上一份報告建議的修正確認

| 建議 | 修正位置 | 審查者查核 | 結論 |
|---|---|---|---|
| S3：AC-1「留下排名較前的那筆」要有測試擋住 | `scripts/test-cli-memory.sh:424-438` | 見下方說明 | 已修好 |
| N3：`notePairOf` 改用共用的 `noteFingerprintOf` | `src/core/memoria.ts:294-298` | 新舊兩個實作對 13 個邊界輸入逐一比對，0 筆不同 | 已修好，輸出不變 |

S3 的查核細節：

- 新斷言在兩個隔離資料根各做一次。一個讓 event（`noteev-`）排前面，另一個讓 session（`note-`）排前面，做法是對前者回報 explicit 1 分、後者 0 分。`EXPLICIT_UTILITY_MIN_OBS = 1`（`src/core/utils.ts:149`），所以一次 explicit 回報就會生效。
- 期望值來自 feedback 設定的 utility 方向，不是用實作重算，所以不是同義反覆。
- 我拿上次的反向改壞手法重驗，新斷言兩種都擋得住。
- `note` 那個資料根讓 session 排前面，所以「永遠留 event 那筆」的寫法也會被擋下。我沒有實際跑這個變體，這是從斷言推導的。

N3 比對的 13 個輸入：`note-abc`、`noteev-abc`、`note-`、`noteev-`、`note-noteev-x`、`noteev-note-x`、`notee-x`、`gitdec-s-0`、空字串、`NOTE-x`、`note`、`noteevx`、`session_1`。

### 改壞程式重驗 S3

兩個變體都改在 269a2aa 的 scratchpad 副本上，build 後跑 `test-cli-memory.sh`：

| 變體 | 結果 | 結論 |
|---|---|---|
| imB：`collapseNoteHits` 保留排名較後的那筆（上次的手法） | exit 1，`✗ utility favours noteev-3af6079e77d43eea, recall returned: note-3af6079e77d43eea` | 擋得住 |
| imS：`collapseNoteHits` 一律優先留 session 那筆（brief 的策略） | exit 1，同樣的訊息 | 擋得住 |

### 受影響之處

| 呼叫端／流程 | 依賴 | 查核 | 結論 |
|---|---|---|---|
| `rememberNote` 的 `--supersedes`（`src/core/memoria.ts:491`） | `notePairOf` 回傳另一半 | 實測 `remember … --supersedes noteev-{A}`：`memory_attributes` 裡 `note-{A}`、`noteev-{A}` 都有 superseded 標記；`test-memory-attributes` exit 0 | 不受影響 |
| `markMemory`（`src/core/memoria.ts:624`） | 同上，另以 `memoryRefExists` 過濾 | 實測 `mark noteev-{B} --durable`：兩半都是 `durable`；`mark gitdec-nonexist-0` 仍然 exit 1 | 不受影響 |
| `brief` 的 `collapseNotePairs`、recall 的 `collapseNoteHits` | `noteFingerprintOf` | 這次沒有改動，`test-brief-scope`、`test-utility-ranking` 都 exit 0 | 不受影響 |
| a6db261 的 AC-1～3 證據 | 增量沒有動到 `recall()`、`utils.ts`、`recall-vector.ts` | 程式差異只有 `notePairOf` 和一行 import | 沿用上一份報告的結論 |

### 增量內每個變動檔案

| 檔案 | 提交 | 結論 |
|---|---|---|
| `src/core/memoria.ts` | 269a2aa | N3 的純重構，行為等價，理由見上 |
| `scripts/test-cli-memory.sh` | 269a2aa | S3 的新斷言有效。新段落用自己的資料根（`home34-noteev`、`home34-note`），不影響其他段落 |
| `docs/issues/issue-34/review-a6db261.md` | bafcc0f | 上一份報告，和審查者寫出的版本一字不差（當時工作樹 clean，沒有差異） |
| `docs/issues/issue-34/README.md` | bafcc0f、269a2aa | 見下面兩小節 |

### README 的寫法與 TBD-1 的更正

寫法：

- `## 現況` 位在 `## 概述` 之後，`**現行 review**` 的格式正確。保存本報告時，記得改成 `review-269a2aa.md`。
- `**狀態**` 是一般的階段描述，沒有誤用特殊狀態值。
- 新增的步驟 4 標為 ✅，附了證據。
- TBD-1～6 的狀態只用 `已解決`、`不影響本次交付` 兩種，每一列都寫了日期、結論與理由；`不影響本次交付` 的三列都寫了「追蹤：」開頭的去向或理由。
- 這幾列沒有 `<`，行首沒有粗體或 `[`。
- 沒有任何一列還是 `待確認`，所以 dev-cycle 不會把它當成懸而未決，也不會誤判成已經可以結案。
- verify-artifact 方面：這次是增量覆審，不靠「審查之後的提交」沿用 PASS，所以不受影響。之後如果只提交本報告和記帳區段，屬於可沿用的範圍。

TBD-1 的更正：

- S1：TBD-1 補上了「keyword 的 FTS 和 LIKE 都先取 4 × limit 筆候選再重排，不需要任何標記」，也寫了「非筆記命中可能被換掉，不只換位置」，和我的實測一致。
- S2：TBD-1 撤回了「superseded 的空位也會一起補上」，並寫明「6 則可見筆記加 1 則被取代，`--top-k 5` 回 4 則，舊版回 2 則不同的」，和我的實測一致。
- 結論把 AC-3 限定在沒有成對筆記的查詢，並說明 superseded 造成的不足在改動前就一律不補，這次沒有變差。這是使用者選的做法 (a)，寫法正確。
- 兩處描述比較概略，但都正確：
  - LIKE 路徑實際是依時間取候選，再用「詞命中 × 衰減」打分。TBD-1 寫成「依衰減分數重排」，方向沒錯。
  - 「被另兩筆取代」對應我實例中 `new_02` 換成 `new_04`、`new_09`。

### 本輪執行的命令

- 全部測試都以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 執行。
- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`：都 exit 0。
- `test-cli-memory`、`test-memory-attributes`、`test-smoke`、`test-brief-scope`、`test-utility-ranking`：都 exit 0。
- 兩個改壞的變體（imB、imS）：`test-cli-memory` 都 exit 1，符合預期。
- N3 等價比對腳本：exit 0。

其餘沿用 review-a6db261.md。

### 豁免、待確認與限制

- 沒有 Gate 豁免。沒有待確認事項，TBD-1～6 都已有結論。
- 本輪新增的限制：「永遠留 event 那筆」的變體沒有實際執行，結論是從斷言推導的。實作者步驟 4 列出的 `test-setup-onboarding`、`test-memory-browser`、`test-ui-http`、`test-http-api`，本輪沒有重跑。這幾支只會受 `notePairOf` 影響，而它已確認行為等價。

## 流程判定

PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
