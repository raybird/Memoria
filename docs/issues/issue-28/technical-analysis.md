# Issue 28 - 技術方案與取捨

本檔為待核准設計建議；驗收與待決事項由 [README](./README.md) 管理。

## 技術可行性

現有 init／verify、skill 部署、快取安裝、coverage 檢查與 brief renderer 已能完成各步；同日實機也驗證了本地 embedding 與 libSQL 查詢。主要工作是建立共用設定解析、可預檢的變更計畫與 setup 編排，而非新增記憶引擎。

互動選單可使用 Node 內建 `readline/promises`，設定檔以既有 Zod 驗證、fs 寫入；維持零新增 runtime 依賴。向量 helper 維持獨立子程序與既有 cache，不 import 到核心依賴。

## 方案選型與取捨

### 1. 保存安裝選擇

| 方案 | 優點 | 成本／限制 |
| --- | --- | --- |
| 修改 shell 啟動檔，提供 env.sh | 與現有環境 gate 相容 | 不一定涵蓋 GUI、不同 shell 或新 host；修改個人 dotfiles，難以確保每個程序都繼承 |
| 原生使用者 JSON 安裝設定（建議） | CLI 與 launcher 自行讀取，新程序不依賴 shell；可顯示設定來源 | 需明確優先序、啟動時驗證及不同執行範圍的隔離 |

建議第二項。這次實機的 env.sh 是人工設定結果，不是要求新 setup 永遠繼續採用的介面。預設不修改 `.bashrc`／`.profile`，明確環境設定仍可覆寫。

安裝設定與 `<data root>/configs/config.json` 的 git domain 配置分開：前者用來找到 data root，不能依賴先找到 data root 才能讀取。設定只保存資料預設、啟用的本地向量選擇及所選 host；認證 token 繼續留在環境或既有憑證機制。

設定實體位置由平台 resolver 提供（Linux 尊重 XDG_CONFIG_HOME、macOS 使用使用者應用設定位置、Windows 使用 APPDATA）；實際路徑必須由 setup／doctor 印出。保留隔離測試覆寫入口，不寫死維護者 HOME。

### 2. 全域預設與專案記憶優先序

建議採最小相容順序：有該旗標的命令之明確 data-root 參數 > `MEMORIA_HOME` > 現有 cwd／cwd/memoria 偵測 > 保存的全域預設 > 原 runtime fallback。`MEMORIA_DB_PATH`／sessions／config path 仍以各自明確環境值覆寫。

```diff
 有效資料位置解析
   明確環境 / 既有本地資料
+  保存的全域預設（前面沒有命中時）
   原 runtime fallback
```

全域優先於本地的替代方案雖更像「到處同一份記憶」，卻會改掉既有專案行為；故建議保留本地優先，並在偵測到本地資料時顯示來源。若要整個 shell 強制共享，既有 MEMORIA_HOME 仍可表達，不自動搬移或合併資料。

向量設定以有效 data root 套用：預設本地向量檔由有效 root 推導，不將另一個 root 的絕對向量檔硬套過來。`LIBSQL_URL` 等明確覆寫保持優先；自訂 DB path 與 ingest 預設來源不符時沿用 issue-27 的阻擋語意。遠端或自訂 helper 的 coverage 只能報 unknown，不能歸為完整成功。

### 3. 規範與 host 接線

建議由 setup 先生成全份變更計畫；使用者確認後，才針對選定的 host 逐項套用。既有 `assertHostSkillTarget` 的手寫 skill 保護與部署副本備份沿用，擴到多目標預檢，避免最後一個目標衝突時前面已被改寫。

| 接線方式 | 取捨 |
| --- | --- |
| 整檔替換或把全域檔改成 symlink | 簡單但會破壞原有 host 規則或檔案管理習慣，不採 |
| 受管理區塊＋備份＋去重（建議） | 保留非受管理內容，重跑只刷新自己的段落；來源不明的 symlink／既有衝突先拒絕 |

共用入口可由安裝器維護一份 AGENTS；Codex 全域入口以正常文字讀取 pointer 載入它，Claude 用 `@` import，另明確 import brief。也可沿用使用者已確認的共用 AGENTS 檔；不把其他 host 的專用規則強制共享。具體 host 路徑與 import 語法於實作時依官方來源核對。

Codex skill 可由標準使用者 skill 目錄的可追蹤連結指向 data-root 副本，Claude 沿用 host 部署副本；是否採連結是內部選擇，驗收以可發現、可執行與資料根一致為準。不得無條件覆蓋既有連結。

### 4. 完成驗證

建議結果分為 core、agent、vector 三類，逐項給 requested／ready／skipped／failed 與原因；實際 JSON schema 待核准，但保留既有 step 行格式。

- core：實際目標的 dirs／DB 可用與路徑一致；write probe 使用可回復的暫存資源，不新增永久測試筆記。
- agent：所選發現位置、DATA_ROOT、launcher 與規範中 brief 路徑相符。
- vector：local 模型可執行、樹狀 coverage、全量 ingest、向量 coverage，再以實際 helper 回應驗證路由。不能只檢查 node_modules。
- 空 corpus：真實目標的 coverage `0/0` 合法；合成記憶只在獨立暫存 root／vector store 中驗證，結果明示 corpus 查詢未測。測後完整清理，不推進真實 corpus 的 sync cursor。

安裝流程不承諾跨 DB、目錄與遠端下載的一個大型 transaction。可預知衝突在所有修改前攔下；執行期失敗則回報已完成與未完成項，保留真實資料與可重試狀態。使用者 JSON 設定以暫存檔＋rename 完整寫入，向量依賴沿用 `.complete` 契約，未通過 vector 驗證不得標示 ready。

## 提議的介面與流程

普通使用者：`npm install -g @raybird.chen/memoria` → `memoria setup` 問答。

非互動完整流程可考慮新增 `--global`／`--project`、多次 `--agent`、`--yes`／`--non-interactive` 等明確選項；這些是待核准拼法，v1.31.2 尚不支援。既有 `--memoria-home`、`--agent claude-code`、`--vector`、`--serve`、`--json` 等明確呼叫維持原契約。互動只在 TTY 且使用者進入引導時開啟，JSON 模式不混入 prompt。

內部分工提案：

```ts
type SetupPlan = {
  dataRoot: string
  scope: 'global' | 'project'
  hosts: string[]
  vector: boolean
  changes: PlannedFileChange[]
}

resolveInstallSettings(context): EffectiveInstallSettings
collectSetupChoices(input): SetupChoices
planSetup(choices, context): Promise<SetupPlan>
applySetup(plan): Promise<SetupResult>
verifySetup(plan): Promise<SetupVerification>
```

函式名稱為分工草案，不是新增公共 API。resolver 是共用真相來源；CLI、doctor 與 setup 不各寫一份優先序。HTTP／SDK 已明確傳入的 data root 與環境不因使用者 CLI profile 被悄悄替換。無配置的 repo、tarball 與唯讀容器保留舊路徑。

## 架構影響評估

- 變動面跨啟動解析、CLI setup、host 檔案寫入與向量 readiness，故為 Large；具體符號的 impact 必須在核准後、修改前重跑，不能沿用建檔時 context 作證。
- 不變更記憶 schema、召回排名、HTTP／SDK envelope 與 helper stdin/stdout；Node 18 支援與 npm／tarball 交付 parity 保持。
- `doctor`、setup 的成功／失敗不能用 shell exit 0 單獨判斷，現行 doctor JSON 可能 `ok:false` 仍退出 0；編排必須讀 envelope/checks。
- GUI agent 不會自然讀 shell env；host launcher 也要走同一原生設定 resolver，這是不用 env.sh 當唯一介面的關鍵。

## 待釐清項目

核准阻擋事項集中於 README TBD-1～5，本檔不另增清單。互動樣式、設定 schema 與內部模組名稱可在已核准行為下採最小實作；若實作導致不同外部行為，回到原 Scenario 修訂核准。
