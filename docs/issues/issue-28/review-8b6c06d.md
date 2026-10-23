# 最終完整交付審查報告

- 範圍：完整 issue-28 交付 `BASE..HEAD`，包含原功能、各輪修復、測試、部署 skill 與最終文件修訂；不是僅沿用 F-2 局部 PASS。
- Reviewed BASE SHA：`50c2eb7d01167192ad03fcd7801b18942126f234`
- Reviewed HEAD SHA：`8b6c06d6c4b97dc3eb8bc3519473c1c72f0af1ec`
- Reviewed patch-id：`488fc2717d6e7689d3bd9ca934642119d1cd0fbe`
- 獨立 reviewer：延續 `review-62075c8-followup`、`review-a02c01c`、`review-0de3683` 的獨立 Codex review task；非原實作者。本次未修改產品／測試、未提交、未委派其他 agent。
- Review artifact：`docs/issues/issue-28/review-8b6c06d.md`
- 日期／風險：2026-10-23／High（資料根隔離、多目標檔案保護與向量 readiness）。

## 問題與風險

**無未解 MUST FIX；無須阻擋交付的 SHOULD FIX。** 原七項與後續 F-1～F-3 已逐一核對，結論與證據如下。前輪局部報告保持原文；本報告重新核對完整最終範圍與證據有效性後給出完整交付判定。

本次另注意到 `docs/OPERATIONS.md` 將裸 `setup --vector` 描述成完整 ingest 的措辭；最終 `8b6c06d` 已明確區分 legacy deps／warm-up 與帶 onboarding 選項的完整流程，符合 `src/cli/commands/setup.ts` 保留原自動化契約的行為，該建議已解決。

## 審查範圍與版本證據鏈

以下 patch-id 均以固定 SHA 的 `git diff BASE HEAD | git patch-id --stable` 重新核對。前幾輪失敗報告是缺陷與修復基線，不當成 PASS 重用。

| 輪次／artifact | 實際範圍 | patch-id／判定 |
| --- | --- | --- |
| [review-f38ce84.md](review-f38ce84.md) | 共同 BASE..`f38ce845be9cd1c5a846ed4d686ac62bd923d900`，完整 issue | `90c8d021fbcfcc70e92e08decc560fb6776ab252`；原七項 MUST FIX |
| [review-62075c8-followup.md](review-62075c8-followup.md) | 共同 BASE..`62075c8f53abd74b2a8d39b5789dfa287d3194e8`，完整交互複查 | 完整 `7ca39b49e6e214b744331b7c3b8167b97b605fd5`；f38..620 修復 `d3372d92aa7858869ce4aaee6736f133bddf2663`；發現 F-1～F-3 |
| [review-a02c01c.md](review-a02c01c.md) | 共同 BASE..`a02c01c2649d843f611f969a1c666b7e84895bb7`，完整交互複查 | 完整 `6814e78ca162794bd4c79867ae747bc7d4fbbdc9`；620..a02 修復 `8a112424f868a83f90ce549b51e3bac39685ce31`；F-1/F-3 解決，F-2 深層殘留 |
| [review-0de3683.md](review-0de3683.md) | a02..`0de3683f6a5e74857ae6ab7cb220df121a0c9585`，僅 F-2 局部修復 | 局部 `906106bab41406a5122f2b990dd561eb1eace0b8`；局部 PASS。共同 BASE..0de 的完整 patch-id 為 `4ec5f869415298256e49b39be0ed5d35f73a4f7e` |
| 本報告 | 共同 BASE..最終 `8b6c06d6c4b97dc3eb8bc3519473c1c72f0af1ec`，完整交付 | 完整 `488fc2717d6e7689d3bd9ca934642119d1cd0fbe`；0de..8b6 文件修訂 `bf3f080404e57c8d4bb640800112f8ea11b9ed8f` |

以 `git diff --exit-code 0de3683 8b6c06d -- src scripts skills .github package.json pnpm-lock.yaml` 確認 exit 0；最後一個提交只有 OPERATIONS、issue metadata／plan 與前輪報告，已逐項閱讀，不含產品／測試變化。因此 0de 的動態證據對最終產品有效；沒有單憑相同 patch-id 放行新 HEAD。既有 `review-62075c8.md` 的錯誤 SHA／PASS 不作本次依據，正確版本與獨立發現以本表的 followup 為準。

## 原七項與後續發現的最終查核

| 發現 | 最終實作與實際證據 | 結論 |
| --- | --- | --- |
| 原 #1：啟動注入 A 的 LIBSQL_URL 污染 setup B | `getExplicitVectorEnv` 區分自動注入，setup 以目標根推導；onboarding Step 6 證明 B 建自己的 vectors.db，A row count 不變 | 已修復 |
| 原 #2：後段 host／settings 父路徑衝突造成先部分寫入 | 全計畫預檢含可寫祖先、內部目錄／檔案與 data-root skill；原 host/settings 負向案例及 F-1/F-2 擴展案例均通過 | 已修復，整體缺口亦已補齊 |
| 原 #3：coverage unknown 將非空 corpus 當空庫跳過 | 從來源 SQLite 計算 expected；非空 corpus＋既有空 store 會 ingest；未知 coverage 拒絕完整成功，空 corpus 的另一分支見 F-3 | 已修復 |
| 原 #4：確認後才套 requestedHome | wizard 在預覽／確認前確定 requestedHome，外層自訂路徑預覽與取消案例通過 | 已修復 |
| 原 #5：既有 cwd/.memory 與 setup 選根不一致 | onboarding 共用 `detectLocalMemoriaRoot`；setup 與新程序 doctor 均指向 cwd，不另建 cwd/memoria | 已修復 |
| 原 #6：project --no-vector 未保存 | 已啟用目標 root 會保存停用；新程序 B 未啟用、A 仍啟用 | 已修復 |
| 原 #7：global --no-vector 關閉其他 root | enabled 依剩餘 roots 判定，defaultDataRoot 不再無條件放行；停 A 後 B 仍啟用 | 已修復 |
| F-1：data-root skill／內部目標漏預檢 | a02 獨立 outer：一般檔案阻擋、手寫 skill、.memory symlink 均 exit 1，DB 未建立、手寫內容保留；最終完整 onboarding 重跑通過 | 已修復 |
| F-2：既有子目錄遮蔽較上層 symlink，後續四層上限仍漏檢 | 0de 遍歷至根；獨立 outer 的深層 CODEX_HOME 與同名 tmp 子目錄 symlink 均 exit 1，root／skill／settings 零建立、AGENTS 逐位元組不變；同深度真目錄 exit 0 | 已修復，無深度誤拒 |
| F-3：空 corpus＋既有空 vector file 無法 setup | a02 獨立 outer：空檔初始化後 exit 0，vector ready、corpusVerified:false、isolatedProbeVerified:true；另含 sentinel 表／資料列的既有 SQLite 檔初始化後原資料保留；最終 onboarding 重跑通過 | 已修復 |

F-1/F-3 的 a02 動態證據仍有效：a02..0de 的產品修改僅祖先 helper，0de..8b6 無產品修改；同時 0de 的完整 onboarding 已涵蓋這些路徑。這是逐路徑重驗有效性，沒有把當時的 RETURN TO execute-task 改稱通過。

## 驗收、核准與 Proof of Test

已讀 review skill 與 project／acceptance／verification／review-evidence／architecture 契約。`git diff 741ba85 8b6c06d -- docs/issues/issue-28/README.md` 僅核准 SHA 回填、Timeline、交付狀態變動，SCN-001～014 的條件／結果未變；全部核准且與表格集合相等。TBD-1～5 已有使用者「核准／全部照建議」的結論，無新的待核准規格或未解 MUST 豁免。

以下規格均固定為 `8b6c06d6c4b97dc3eb8bc3519473c1c72f0af1ec:docs/issues/issue-28/README.md` 的對應 SCN；E1～E5 的實際命令、版本及限制見後文。

| Scenario | 可觀察結果與固定版本證據 | 判定 |
| --- | --- | --- |
| SCN-001 | wizard 選擇／完整預覽／確認完成、取消零副作用；requestedHome 與確認路徑一致；E1 onboarding Steps 3/6 | 通過 |
| SCN-002 | 新目錄／新程序不帶 Memoria env，沿用保存全域根執行 doctor、remember、recall；E1 Step 2、E5 packed npm | 通過 |
| SCN-003 | 本地記憶優先、明確 path/env 優先、project 不改全域預設、既有 cwd/.memory 一致；E1 Steps 1/2/6、E5 cli-memory/brief-scope | 通過 |
| SCN-004 | 兩 host 標準位置可發現且 launcher 可執行、DATA_ROOT 與 runtime 正確；E1 Steps 3/4、E5 packed npm/no-clone；F-2 保護見 E3 | 通過 |
| SCN-005 | 使用者規範保留、可定位備份、managed block／Claude imports／空白路徑可用；E1 Step 4、E5 npm 空白路徑、E3 祖先負向案例 | 通過 |
| SCN-006 | local 能力 E4；stub＋真 libSQL 全量 ingest 不受舊 cursor 影響、missing=0、實際向量路由／新程序設定；E1 Step 5、E2、E4 | 通過（本輪 local 非重新量測） |
| SCN-007 | 基本模式 skipped 且不下載；空庫隔離 probe 成功但 corpusVerified:false，既有空向量檔也可完成；E1 Steps 5/7、E3 | 通過 |
| SCN-008 | 真實記憶／手寫規範保留、managed block 不重複、cache 重用與單 root 停用不影響他根；E1 Steps 4/6/7、E5 | 通過 |
| SCN-009 | host、settings、data-root 內部目標、淺／深祖先 symlink 衝突在修改前拒絕；E1 Steps 1/4/6/7、E3 獨立負向／真目錄對照 | 通過 |
| SCN-010 | 故障非 0、core/vector 分開、既有記憶可讀且重跑恢復；E1 Step 5、E3 空 store 修復、E5 | 通過 |
| SCN-011 | legacy flags／JSON Lines／非互動不等待、互斥選項拒絕；E1 Step 3/bootstrap、E5 npm/no-clone；最終 OPERATIONS 與 source 一致 | 通過 |
| SCN-012 | env 優先、不存認證 token、資料根與向量庫隔離、DB path 不符在 ingest 前拒絕；E1 Steps 1/2/6、E2 | 通過 |
| SCN-013 | 真實空庫 sessions/events 無 probe 殘留、合成記憶只在隔離 store、launcher 執行而非只查存在；E1 Step 5、E3、E5 | 通過 |
| SCN-014 | repo/npm/tarball 命令與 helper 契約相容，未選 host 不修改、不自動安裝 service/hooks；E1/bootstrap、E2、E5；跨平台 resolver／CI 設定與原生驗證限制如下 | 通過，平台限制已揭露 |

### E1：最終產品 0de3683 的靜態與完整流程

協調者在 Linux／Node 22、fresh bundle 回報以下全部 exit 0；其後 8b6 僅文件修改，因此重用：

```text
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash -n install.sh scripts/test-setup-onboarding.sh
pnpm run release:docs-check
bash scripts/test-setup-onboarding.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
```

完整 onboarding 含 Step 6 原七項與 Step 7 F-1～F-3／深層 F-2；有實際 assertion，沒有刪除／弱化測試以製造通過。bootstrap 的 `Killed` 是預期故障注入，不是未揭露失敗。

### E2：可重用的向量契約回歸

`a02c01c2649d843f611f969a1c666b7e84895bb7` 的 `bash scripts/test-vector-recall.sh` 為 exit 0（stub provider＋真 libSQL），已記於 [review-a02c01c.md](review-a02c01c.md)。此後沒有 recall／embed／ingest helper 語意修改；祖先保護的動態交互已由 E1／E3 覆蓋。未把該命令誤列為 0de／8b6 重新執行。

### E3：本獨立 reviewer 的紅綠探針

探針的命令、fixture、子 setup exit 與實際副作用保存於 [620 followup](review-62075c8-followup.md)、[a02 報告](review-a02c01c.md)、[0de 報告](review-0de3683.md)。三輪均用隔離 HOME／Memoria env 與 installed-shape 的真實 bundle；有沙盒限制時依權限流程升級，不碰使用者全域資料。

- 620：data-root 內部衝突已造成先寫 DB／手寫 skill 遺失；淺層 host symlink 可寫；空 corpus＋空 vector file 完整 CLI exit 1，對照不存在 vector file exit 0，確立 F-1～F-3 真實失敗模式。
- a02：重跑前述 F-1 原案例均拒絕且零 DB；F-3 兩種既有檔案（空檔／含 sentinel 的 SQLite）完成且保留原資料；發現深層 CODEX_HOME 可繞過四層上限。
- 0de：`node /tmp/memoria-issue28-0de3683-probe.mjs` driver exit 0；深層未知 link 與使用者同名 tmp link 子 setup 均 exit 1，root／skill／settings 未建立，原 AGENTS.md 精確為 `host sentinel`；同深度真目錄子 setup exit 0、readiness ready。這直接驗證 F-2 最後殘留已修，且沒有深度誤拒。

### E4：已有 local 模型實機證據及重用界線

固定最終版 [implementation-plan.md](implementation-plan.md) Task 4.1 保留維護者實機 `MEMORIA_EMBED_PROVIDER=local`、packed v1.31.2、multilingual-e5-small q8／cache hash `690ebce65e137374` 的數據：空庫 0/0 且隔離 probe 成功，非空庫 coverage 5/5、missing=0，新程序 doctor 指向 global-config；英文改述查中文記憶 route `hybrid_vector`／`vector`、fallback false，延遲 1860／1787 ms。

這是歷史模型能力證據，本 reviewer 未重做實機模型驗證，也不把它稱為最終 HEAD 的新量測。模型／embedding helper 沒有本 issue 程式差異；後續變更在設定來源、預檢與空 store 初始化，由 E1～E3 的真 libSQL 管線覆蓋，故可重用其模型能力證據，並保留此版本限制。

### E5：本次發版前打包與直接相關補充 gate

協調者在產品固定為 0de3683、最終僅增加文件的交付狀態下回報下列全部 exit 0：

```text
pnpm run release:package                      # 含 artifact parity
bash scripts/test-npm-install.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-installer-platform.sh
bash scripts/test-service-manager.sh
bash scripts/test-brief-scope.sh
bash scripts/test-cli-memory.sh
```

npm 測試實際 pack/install、執行含空白路徑的 launcher、雙 host 部署及跨程序 global remember/recall；no-clone 驗 checksum、獨立安裝與原 setup/serve 契約。不是僅有檔案存在或舊報告文字。這些結果與 E1 補齊 Task 5.1 的本次相關打包／流程 gate。

## 架構、安全、文件與限制

- 完整最終異動清單及 source 已核對：CLI 啟動與 core paths/install-settings → wizard／plan → 全目標預檢 → init/deploy／managed instructions → 保存設定 → full ingest/readiness。source 未改動的部分以前輪完整審查為基線，逐輪確認變更與交互，沒有只將局部 PASS 換標籤。
- 無新 runtime 依賴或持久 schema；HTTP／SDK envelope、recall 排名／confidence、helper stdin/stdout 沒有行為改寫。向量依賴仍在子程序，從 core barrel 消費共用 resolver。未知 coverage 不當完整成功，認證 token 不保存。備份、手寫保護與預檢各自驗證，不以備份代替衝突前拒絕。
- cross-task 的 runChild 與祖先檢查共用方向合理，沒有阻塞的重複分歧或過度設計。向量初始化使用與 ingest 一致的 IF NOT EXISTS schema，sentinel DB 對照證明原內容保留。
- README／CLI／INTEGRATIONS 雙語、INSTALL、OPERATIONS、AGENTS／architecture、deployed skill 與 CI 的更新觸發已核對；最後 OPERATIONS 修訂與 legacy/full 分支一致。issue README 的「待合併與發版」與 plan 未勾選的合併／發布項保留正確，未提前宣稱 merge/release。
- 平台限制：本輪實際環境為 Linux／Node 22。Windows／macOS 路徑 resolver 有 inner assertion；既有 npm-install CI matrix 含 Ubuntu／macOS，新腳本實際走 host 接線。Node 18 的既有 smoke CI 保留。本輪未親跑原生 macOS／Windows／Node 18；darwin 頂層 alias 僅靜態核對精確 platform／路徑條件，不宣稱平台全面實測。這些是已揭露的驗證範圍，不是把未執行項記為通過。
- 本次合併前相關產品／打包 gate 沒有未執行缺口；tag、npm／GitHub 發布及其遠端結果仍屬後續發布工作，不由本審查虛構完成。沒有新決策需求或未解的安全豁免。reviewer 未改 symbol／未 commit，edit-impact／commit detect_changes gate 不適用於本次報告產出。

## 流程判定

**PASS（完整 issue-28 交付）** — 對上列固定 BASE／HEAD 的完整範圍，核准規格、14 項驗收、原七項與 F-1～F-3、必要失敗面及相關發版前 gate 均已查核，無未解 MUST FIX。判定不代表 npm／GitHub 已發布，亦不擴張為所有平台重新實測。

本報告綁定 `8b6c06d6c4b97dc3eb8bc3519473c1c72f0af1ec`。後續若只新增本報告的單一直接後繼提交，須依 review-evidence.md 執行 `verify-artifact.py` 驗證；任何其他產品／測試／文件變動不自動套用此例外。
