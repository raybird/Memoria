# 獨立複查報告

- 範圍：完整 issue-28 `BASE..HEAD` 的交互影響，重點複查 `f38ce845be9cd1c5a846ed4d686ac62bd923d900..HEAD` 七項修復。
- Reviewed BASE SHA：`50c2eb7d01167192ad03fcd7801b18942126f234`
- Reviewed HEAD SHA：`62075c8f53abd74b2a8d39b5789dfa287d3194e8`
- Reviewed patch-id（完整範圍）：`7ca39b49e6e214b744331b7c3b8167b97b605fd5`
- 修復 diff patch-id：`d3372d92aa7858869ce4aaee6736f133bddf2663`
- 獨立 reviewer：本次獨立 Codex review task；非原實作者，未修改產品或測試，未委派其他 reviewer。
- Review artifact：`docs/issues/issue-28/review-62075c8-followup.md`
- 日期／風險：2026-10-23／High（檔案覆寫、跨目標寫入及向量 readiness）。

這是與既有未追蹤 `review-62075c8.md` 不同的獨立複查。既有檔案保持原樣；其 SHA256 為 `883cbff3110070f9e052494fec400b3d4929cc4cc89c5f8c2dc981d2949c4894`。任務初始傳入、來自既有報告的 HEAD `62075c8aa9c430e0470b183735e09aa85b3579d3` 查詢為 `bad object`；經 `git rev-parse 62075c8` 與協調者確認後，使用上列實際 HEAD。既有報告 metadata 不可靠，未沿用其 PASS。

## 問題與風險

### F-1 — MUST FIX / P1：data-root 內部必寫目標仍未納入完整預檢

位置：`src/cli/setup-plan.ts:273`、`src/cli/runtime.ts:92`、`src/cli/runtime.ts:255`。

`assertSetupPlanSafe` 只檢查資料根本身、host skill、instruction 與 install settings。即使 `--agent none`，後續仍必寫 `<root>/.agents/skills/memoria`；此目標未採 host skill 的辨識／保護檢查。對 `.memory` 的檢查則傳入其路徑給只檢查 parent 的 helper，實際只檢查 root，沒有檢查 `.memory` 本身。

獨立 outer CLI 探針使用 freshly-built bundle 的 installed-shape runtime，隔離 HOME、XDG 與 Memoria/libSQL env，執行：

```text
node <isolated-runtime>/dist/cli.mjs setup --scope global --memoria-home <root> --agent none --no-vector --yes --json
```

三個 fixture 的實際結果：

| 輸入／狀態 | 實際結果 | 預期 |
| --- | --- | --- |
| `<root>/.agents/skills` 為內容 `sentinel` 的一般檔案 | exit 1，先輸出 `init ok:true`、`verify ok:true`，再因 `.agents/skills/memoria` 的 `ENOTDIR` 失敗；新 `.memory/sessions.db` 已存在 | 修改任何資料前拒絕 |
| `<root>/.agents/skills/memoria/SKILL.md` 為手寫 `custom handwritten sentinel` | exit 0，手寫內容消失，已被部署版取代 | 拒絕覆寫來源不明的既有 skill |
| `<root>/.memory` 為指向同一暫存 fixture 內未選目錄的 symlink | exit 0，symlink 指向目錄新增 `sessions.db` | 在跟隨未知 symlink 寫入前拒絕 |

以上合併為一項，根因是整份計畫遺漏 data-root 內部實際寫入目標。舊 #2 的 host/settings 父路徑具體案例已修好，但 SCN-009 的「全部預檢、衝突時零副作用」仍不成立；手寫 skill 有實際資料遺失風險。建議將資料庫／內部目錄、資料根 skill、brief 及備份目的地納入同一預檢，對被取代的 skill 使用來源辨識與備份規則，並覆蓋上述負向案例。

### F-2 — MUST FIX / P1：最近祖先是真目錄時，較上層的未知 symlink 仍被略過

位置：`src/cli/runtime.ts:170`（特別是第 185 行的提早 return）；交互位置：`src/cli/agent-integration.ts:158`。

`checkWritableAncestorDir` 找到第一個存在且可寫的真目錄即成功，不再檢查上層路徑。當 host 根是 symlink，而其 `skills` 子目錄已存在，檢查只看到 `skills`。既有 instruction 檔也只檢查自身存取權，無祖先檢查。

實際 fixture：

```text
<HOME>/.codex -> <fixture>/unselected-host
<fixture>/unselected-host/skills/          # 已存在的真目錄
<fixture>/unselected-host/AGENTS.md        # 已存在的一般檔案，含手寫 sentinel
```

以與 F-1 相同的 installed-shape runtime 執行上列 setup 命令，將 `--agent none` 改為 `--agent codex`：exit 0；`unselected-host/skills/memoria/SKILL.md` 被建立，既有 `unselected-host/AGENTS.md` 也被接線更新。若拿掉既有 AGENTS.md，instruction 檢查會碰到直接 parent symlink 而拒絕；因此有無既有檔案會改變安全判定。

這是與 F-1 不同的 helper 實作缺口；即使補齊計畫目標，也仍會漏掉較上層 symlink。影響 SCN-009。建議對所有實際目標（包含已存在檔案）檢查必要祖先鏈，避免最近真目錄遮蔽較上層 symlink，並加入此既有子目錄／既有 instruction 的交叉案例。

### F-3 — MUST FIX / P2：空 corpus 搭配既有空向量檔時，setup 永遠無法完成

位置：`src/cli/setup-plan.ts:343`、`src/cli/setup-plan.ts:435`。

`runFullVectorIngest` 直接計算來源數修好了非空 corpus 被誤當空庫的問題，但來源為 0 時仍立即返回，沒有初始化既有空向量檔。新加的 `!report.coverage` guard 隨後將該檔缺少 `memoria_vectors` table 視為 `read_failed`，在執行隔離 probe 前失敗。

獨立外層 CLI 對照使用同一 installed-shape runtime、真實既有 stub/libSQL 依賴（預置到隔離 cache，無網路下載、無 mock），執行：

```text
MEMORIA_EMBED_PROVIDER=stub node <isolated-runtime>/dist/cli.mjs setup --scope global --memoria-home <root> --agent none --vector --yes --json
```

| 唯一差異 | 實際結果 |
| --- | --- |
| 空 corpus，`<root>/.memory/vectors.db` 不存在 | exit 0；`vector.status:ready`、`corpusVerified:false`、`isolatedProbeVerified:true`，route `vector` |
| 空 corpus，先建立零 byte 的 `<root>/.memory/vectors.db` | exit 1；`core.status:ready`、`vector.status:failed`，錯誤 `vector coverage could not be verified (read_failed)` |

直接呼叫實際 exported helpers 的對照也得到 `runFullVectorIngest -> {embedded:0,expected:0,missing:0}`，隨後 `verifyVectorReadiness` 拋出同一錯誤。原檔與空 corpus 重跑時不會改變，因此正常重試無法修復。這影響 SCN-007 的空記憶庫完成判定與 SCN-010 的可重試性。建議在空 corpus 路徑也建立可度量的本地 store，再執行隔離驗證；保留對真正無法度量 store 的誠實失敗，不應直接把 unknown 當完整成功。

## 舊七項逐項判定

| 舊項目 | 判定 | 實際依據 |
| --- | --- | --- |
| #1 跨根自動注入 LIBSQL_URL 被當明確覆寫 | 原具體案例已修復 | `getExplicitVectorEnv` 區分啟動注入；setup ingest 重新用目標根推導；新增 inner assertion 與外層 A/B store 隔離案例通過 |
| #2 host/settings 祖先一般檔案導致先部分寫入 | 原具體案例已修復；整體安全要求仍未完成 | 新 helper 阻擋直接父路徑一般檔案，driver 與外層第二 host 案例通過；F-1/F-2 證明其他必要目標與較上層 symlink 仍漏檢 |
| #3 coverage unknown 把非空來源當 0/0 跳過 | 原具體案例已修復；有新空庫回歸 | 改從 SQLite 計數，非空來源＋既有空向量檔的完整 setup 案例通過；unknown 現在會拒絕，未再當完整成功；F-3 為空 corpus 的另一分支 |
| #4 requestedHome 在確認後才套用 | 原具體案例已修復 | requestedHome 進入 wizard，預覽與 choices 在確認前確定同一根；取消時的外層自訂路徑預覽案例通過 |
| #5 既有 cwd/.memory 被忽略 | 原具體案例已修復 | onboarding 共用 `detectLocalMemoriaRoot`；外層 setup 初始化 cwd 且 doctor 指回 cwd，沒有另建 cwd/memoria |
| #6 非互動 project --no-vector 不保存 | 原具體案例已修復 | 已啟用 root 使 saveSettings 為 true；外層停用 B 後新程序 doctor 判 B 未啟用，A 保持啟用 |
| #7 global --no-vector 把其他 root 關掉 | 原具體案例已修復 | `enabled` 由剩餘 roots 決定，defaultDataRoot 不再無條件啟用；外層停 A 後 B 仍啟用 |

## 已查核維度

### 驗收、核准與版本

已讀 review skill、`docs/AGENTS.md`、`project.md`、`acceptance.md`、`verification.md`、`review-evidence.md`、`architecture.md`、issue README 與 implementation-plan。流程契約 2.3 滿足 review skill 2.1 要求。`git diff 741ba85 HEAD -- docs/issues/issue-28/README.md` 僅核准 SHA 回填、Timeline 與狀態變動，SCN-001～014 語意未變，核准表與情境集合一致；無新 gate 豁免。

| 驗收 | 查核／證據與結論 |
| --- | --- |
| SCN-001 | wizard 預覽、確認、取消及明確 root 路徑；onboarding 測試通過 |
| SCN-002 | 保存全域資料根後新程序 remember/recall/doctor；onboarding 測試通過 |
| SCN-003 | 本地根 precedence、明確覆寫與 .memory 偵測；原案例通過，symlink 保護另見 F-1/F-2 |
| SCN-004 | 兩 host wrapper 部署與新程序執行；onboarding/bootstrap 測試通過；未知祖先保護見 F-2 |
| SCN-005 | 既有 instruction 備份、managed block 與範圍接線；正向測試通過；祖先安全見 F-2 |
| SCN-006 | 非空來源全量 ingest、舊 cursor、coverage 與 vector 路由；stub＋真 libSQL 測試通過 |
| SCN-007 | 基本模式及不存在 store 的空庫通過；既有空檔案的空庫失敗，見 F-3 |
| SCN-008 | 重跑 managed blocks、資料保留與 cache 沿用；正向測試通過；手寫 data-root skill 保護失敗，見 F-1 |
| SCN-009 | 舊指定父路徑阻擋案例通過；完整預檢仍失敗，見 F-1/F-2 |
| SCN-010 | 故障注入能區分 core/vector 並重試；空庫既有空向量檔重試不會自癒，見 F-3 |
| SCN-011 | 非互動、JSON Lines、互斥參數與取消；onboarding/bootstrap 通過 |
| SCN-012 | 明確 env precedence、DB root 不符阻擋、token 不保存、A/B 向量根隔離；原案例通過 |
| SCN-013 | isolated probe 與真實空庫 sessions/events 零殘留；onboarding 測試通過；F-3 在 probe 前退出 |
| SCN-014 | 本次 smoke/bootstrap/vector-recall 通過；未選 host、無新增 service/hooks 及 helper stdout 契約已讀碼查核；跨平台與 packed npm 證據限制見下 |

### 實際測試與探針

協調者於相同固定 HEAD、新建 bundle、Node 22 環境回報以下實際命令全部 exit 0；本 reviewer 另外讀取新增斷言與呼叫路徑，未以舊報告的 PASS 代替審查：

```text
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash -n install.sh scripts/test-setup-onboarding.sh
pnpm run release:docs-check
bash scripts/test-setup-onboarding.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-vector-recall.sh
```

完整 onboarding 包含 Step 6 七項新增回歸案例，均通過；未覆蓋 F-1/F-2/F-3 的輸入組合。bootstrap 的 `Killed` 是既有故障注入的預期輸出。上述綠燈確實驗證其案例，沒有發現刪除／弱化測試或同義反覆；這裡是重要失敗面覆蓋缺口，不將已通過案例指為假綠燈。

本 reviewer 實際執行：

- `node /tmp/memoria-issue28-followup-probe.mjs`：最終 installed-shape 探針 driver exit 0；其子 setup 的真實 exit／輸出／檔案觀察已逐一保存在 F-1/F-2。fixture `/tmp/memoria-issue28-followup-5RiprT`，所有寫入均在該暫存樹。runtime 複製本次 `dist/cli.mjs`、package.json 與 skills，連結既有 node_modules，不另安裝依賴。
- `node --import tsx /tmp/memoria-issue28-empty-vector-probe.mts`：driver exit 0；實際 helper 拋出 F-3 的 read_failed，沒有 mock。
- `node /tmp/memoria-issue28-empty-outer.mjs`：對照 driver exit 0；完整子 setup 分別 exit 0／1，fixture `/tmp/memoria-issue28-empty-outer-zFHbsV`，真實 stub/libSQL 依賴由隔離 cache 沿用，沒有模型下載。F-3 表格保留了持久化輸入與結果；暫存探針腳本不屬交付檔案。
- `git diff BASE HEAD | git patch-id --stable` 與修復範圍同命令：得到報告開頭兩組 patch-id。

限制：首次沙盒子程序未提供可用 stdout／產品觀察，依權限流程升級後重做；首次 repo-shape 又被隔離 HOME 下 pnpm 預檢擋住，故改以與打包安裝相同的 installed-shape 測量，前兩次均未當產品結論。沒有修改真實 HOME、host 設定、全域記憶或持久 Memoria telemetry。本次沒有重跑 local 模型實機、完整 packed npm/no-clone、Node 18 或 macOS/Windows；implementation-plan 的既有證據保留為歷史證據，不擴張為本次新驗證。

### 架構、安全與品質

- 已查核完整 BASE..HEAD 的檔案清單及 source diff，並查核修復與原功能的交互路徑：CLI 啟動套 env → setup root 選擇 → plan → 預檢 → init → skill／instructions → settings → vector ingest/readiness。
- 沒有新增 runtime 依賴、schema 或 HTTP/SDK envelope 變更；核心 path/install-settings API 經 barrel 匯出，vector helper 仍透過 child process，不把其依賴併入 core。
- 新的環境來源追蹤及 per-root roots 判斷修正原跨根污染；一般 no-vector 與全域／專案相互停用案例通過。
- 安全審查關鍵剩餘面為 F-1/F-2；備份並不能取代寫入前拒絕未知目標。未知 coverage 不再製造假成功，但空庫狀態轉換缺一條可恢復路徑（F-3）。
- 跨 Task 共用 runChild／祖先檢查的抽取方向合理，沒有為可讀性要求廣泛重構。此次沒有修改任何函式，GitNexus symbol edit impact 與 commit detect_changes gate 不適用；未提交。

## 流程判定

**RETURN TO execute-task** — 舊七項的原具體回歸案例皆通過，但尚有兩項 P1 預檢／寫入保護缺口及一項 P2 空庫向量 setup 回歸。F-1/F-2/F-3 沒有豁免，不可因既有測試全綠或既有報告 PASS 直接交付。
