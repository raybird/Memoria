# 審查報告

- 範圍：完整 issue-28 分支，`main..issue-28-unified-setup`
- Reviewed BASE SHA：50c2eb7d01167192ad03fcd7801b18942126f234
- Reviewed HEAD SHA：f38ce845be9cd1c5a846ed4d686ac62bd923d900
- Reviewed patch-id：90c8d021fbcfcc70e92e08decc560fb6776ab252
- 獨立 reviewer：本次 Codex reviewer（非原實作者；本宿主無可委派的第二層 subagent）
- Review artifact：docs/issues/issue-28/review-f38ce84.md
- 風險：High；資料根、向量庫與多目標安裝的隔離／預檢。

## 問題與風險

1. MUST FIX / P1 — `src/cli/commands/setup.ts:428-431`：CLI 已在啟動時把預設根 A 的向量 URL 寫入 process.env，明確 setup 到 B 時誤把它當使用者覆寫，向 A ingest B 的語料。必須保留環境值來源，對最終 setup root 重新推導保存設定。
2. MUST FIX / P1 — `src/cli/setup-plan.ts:258-260`：host skill 預檢未驗證父路徑。第二個 host 的 `skills` 是一般檔案時，預檢通過，第一個 host 與 DB 已修改才 ENOTDIR；settings 祖先是一般檔案時同樣在修改後才失敗。需在任何寫入前檢查所有預計寫入路徑及其可寫祖先。
3. MUST FIX / P2 — `src/cli/setup-plan.ts:303-306`：coverage unknown 被解作空 corpus；本地向量 DB 缺 table 或遠端 URL 時，非空來源直接回傳 0/0 而未 ingest。需獨立計算來源筆數，unknown 不得成為完整成功。
4. MUST FIX / P2 — `src/cli/commands/setup.ts:174-176`：互動預覽與確認之後才套用 requestedHome，實際變更根與使用者確認的根不一致。需在預覽前決定所有有效覆寫。
5. MUST FIX / P2 — `src/cli/commands/setup.ts:99-100`：新專案 onboarding 忽略 cwd 已存在的 `.memory`，另建 cwd/memoria；接線與一般 CLI 使用不同 DB。完整 onboarding 應沿用已偵測的本地根（保留 legacy 呼叫相容性）。
6. MUST FIX / P2 — `src/cli/commands/setup.ts:470-472`：非互動 project --no-vector 不保存設定，後續程序仍啟用原有的 project vectors。應保存 project 的停用選擇而不改全域資料根。
7. MUST FIX / P2 — `src/cli/commands/setup.ts:386-391`：global 基本模式把共用 vector.enabled 改 false，連 roots 中其他專案也停用。停用應限於目標根。

## 已查核維度

- 核准：讀取 issue README 的 SCN-001～014 與核准紀錄、implementation-plan 及既有 review；獨立閱讀完整程式 diff，未以先前 PASS 代替本次查核。
- 需求：上述問題分別影響 SCN-001/003/006/007/008/009/010/012/013；基本全域 setup、資料根 precedence、managed blocks、host 複本保護及既有參數保留均已檢查。
- 架構：未新增依賴或 schema；查核 paths、install-settings、CLI 啟動、setup、instruction wiring 與 helper ingest 邊界。GitNexus 對 resolveMemoriaPaths 回報 HIGH，直接 callers 包含 run、registerSetupCommand、startServer、registerServiceCommand。
- 安全：驗證多 host 的後段父路徑衝突、設定檔父路徑衝突、互動確認後更換 root；預檢不足不能由後續備份補足。
- 品質：重構後 runChild 共用合理；缺陷不是格式或一般簡化建議。向量 root 問題涉及設定值來源，並非核心 recall 排名變更。
- 測試：inner driver 有真實 assertion 並通過；新增腳本未涵蓋已保存 vector profile 下以 setup flag 切換 root、多根停用、已有 cwd/.memory 的 onboarding、後段 host 父路徑阻擋。未將環境阻塞判為產品測試失敗或假綠燈。

### 本次實際證據（2026-10-23，被測版本 f38ce84）

- `pnpm run check && pnpm run build && node dist/cli.mjs --help >/dev/null && bash -n install.sh scripts/test-setup-onboarding.sh && pnpm run release:docs-check`：exit 0。
- `node --import tsx scripts/setup-onboarding-driver.mts`：exit 0，全部斷言通過。
- `bash scripts/test-setup-onboarding.sh`：exit 1，tsx IPC `listen EPERM /tmp/tsx-1000/...pipe`，未到產品驗收；以 `node --import tsx` 執行 inner driver 避免該 IPC。
- `bash scripts/test-smoke.sh`：exit 7，已通過 verify/export/prune/stats，於 adaptive recall skip 後無法繼續；sandbox 限制，不作全綠證據。
- 使用 freshly-built bundle 的 installed-shape 暫存包（複製 dist/skills/package.json、連結既有 node_modules；未安裝新依賴）驗證：
  - `setup --scope global --agent both --no-vector --yes --json`，第二 host 的 `.codex/skills` 為一般檔案：exit 1，但第一 host 的 SKILL.md 與新 sessions.db 都已存在。
  - `MEMORIA_USER_CONFIG_PATH=<一般檔案>/install.json setup --scope global --agent none --no-vector --yes --json`：exit 1，但新 sessions.db 已存在。
  - 在已有 cwd/.memory 的目錄執行 `setup --scope project --agent none --no-vector --yes --json`：exit 0，setup 目標為 cwd/memoria，隨後 doctor 仍指向 cwd。
  - `printf '1\n4\n2\ny\n' | ... setup --interactive --memoria-home <另一根>`：exit 0，預覽舊全域根，實際初始化另一根。
  - 保存 enabled=true、roots=[A,B] 後對 B 執行 project --no-vector：exit 0，profile 未變，B doctor 仍顯示 enabled；對 A 執行 global --no-vector：exit 0，profile 變 enabled=false、roots=[B]，B doctor 反而顯示 not enabled。
- 直接以真實 exported helpers 驗證（無 mock）：saveInstallSettings(A vector enabled) → applyEffectiveVectorEnv(A) → buildSetupPlan(B)，所得 setup root=B、LIBSQL_URL=A/.memory/vectors.db。
- 對含真實記憶的暫存 B，設定 LIBSQL_URL 為缺少 memoria_vectors table 的空 SQLite 檔，再執行 runFullVectorIngest：exit 0，inspect 回報 read_failed、ingest 卻回傳 embedded=expected=missing=0；遠端 URL 亦同。沒有發出遠端請求。
- 全量 helper 子程序在本 sandbox 的 stdout/檔案可見性不足，未把本次局部探針宣稱為完整向量 E2E；核心缺陷由可重現的設定解析／coverage 返回值及其呼叫路徑確認。

## 流程判定

RETURN TO execute-task — 存在上述 MUST FIX，尚不能沿用既有 PASS。未修改產品程式碼，未提交或推送。
