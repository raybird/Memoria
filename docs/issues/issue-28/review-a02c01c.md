# 獨立複查報告

- 範圍：完整 issue-28 `BASE..HEAD` 交互影響，重點為 `62075c8f53abd74b2a8d39b5789dfa287d3194e8..HEAD` 修復。
- Reviewed BASE SHA：`50c2eb7d01167192ad03fcd7801b18942126f234`
- Reviewed HEAD SHA：`a02c01c2649d843f611f969a1c666b7e84895bb7`
- Reviewed patch-id（完整範圍）：`6814e78ca162794bd4c79867ae747bc7d4fbbdc9`
- 修復 diff patch-id：`8a112424f868a83f90ce549b51e3bac39685ce31`
- 獨立 reviewer：延續上輪的獨立 Codex review task，非原實作者；未修改產品或測試，未提交、未委派其他 agent。
- Review artifact：`docs/issues/issue-28/review-a02c01c.md`
- 日期／風險：2026-10-23／High（多目標檔案寫入保護）。

本報告獨立核對 [上輪 F-1～F-3](review-62075c8-followup.md)，未沿用既有 PASS。以 `git rev-parse HEAD` 確認被測提交，工作區開始時乾淨。

## 問題與風險

### MUST FIX / P1 — F-2 殘留：四層上限仍允許透過未知使用者 symlink 寫入

位置：`src/cli/runtime.ts:197`；呼叫面包含 host skill 與 `src/cli/agent-integration.ts:173` 的既有 instruction 預檢。

`checkWritableAncestorDir` 現在會繼續向上檢查，但驗過四個存在目錄就提前成功。這能攔下原本的 `~/.codex` symlink，卻沒有實現已核准 SCN-009 的未知 symlink 拒絕契約；任意較深的 host 路徑仍會遮蔽同一種祖先。

獨立外層探針使用本次新 bundle 的 installed-shape runtime，HOME／XDG／Memoria/libSQL env 全隔離。fixture：

```text
<fixture>/link -> <fixture>/unselected
<fixture>/unselected/a/b/c/d/e/skills/    # 已存在真目錄
<fixture>/unselected/a/b/c/d/e/AGENTS.md  # 原內容為 host sentinel
CODEX_HOME=<fixture>/link/a/b/c/d/e
```

執行：

```text
node <isolated-runtime>/dist/cli.mjs setup --scope global --memoria-home <root> --agent codex --no-vector --yes --json
```

實際 exit 0；JSON Lines 包含 `agent-skill ok:true` 與 `readiness ok:true`。`unselected/a/b/c/d/e/skills/memoria/SKILL.md` 被建立，原 AGENTS.md 增加 `<!-- memoria:managed:start -->` 接線區塊。直接呼叫同一 helper 的對照亦為：淺層 `link/skills/memoria -> ok:false`，深層 `link/a/b/c/d/e/skills/memoria -> ok:true`、`link/a/b/c/d/e/AGENTS.md -> ok:true`。

此例的 link 完全由暫存使用者路徑構成，與 macOS `/var` 等 OS alias 無關；新增四層上限未經驗收規格授權縮減安全邊界。建議完整檢查使用者控制的祖先鏈，對已知平台 alias 採明確處理，而非靠深度猜測；補此深層 CODEX_HOME 外層負向案例，要求 setup 在任何寫入前拒絕。此項延續原 F-2，不重複列為另一個新問題。

## 前輪修復逐項判定

| 前輪項目 | 獨立實測結果 | 判定 |
| --- | --- | --- |
| F-1a：data-root `.agents/skills` 為一般檔案 | exit 1，`step:skill, ok:false`；`.memory/sessions.db` 未建立 | 原案例已修復 |
| F-1b：data-root 手寫 SKILL.md | exit 1，拒絕缺部署標記的 skill；手寫 sentinel 完整保留、DB 未建立 | 原案例已修復 |
| F-1c：data-root `.memory` 為 symlink | exit 1，`step:init, ok:false`；symlink 目標未新增 DB | 原案例已修復 |
| F-2：原 `HOME/.codex -> unselected`，且已含 skills 與 AGENTS.md | exit 1，`step:agent-skill, ok:false`；DB、外部 skill 均未建立 | 原具體案例已修復，整體要求仍有上述深層缺口 |
| F-3：空 corpus＋既有零 byte vectors.db | exit 0，`vector:ready`、`corpusVerified:false`、`isolatedProbeVerified:true`，route `vector`；已建立 memoria_vectors | 原案例已修復 |

另外以既有 SQLite 向量檔含 `user_sentinel(value)` 表與 `preserve me` 資料列測試相同 F-3 路徑：exit 0、空向量 schema 初始化成功，原表與資料列仍在。新初始化使用與 helper ingest 一致的 `CREATE TABLE/INDEX IF NOT EXISTS`，未引入 drop／replace；本次未觀察到既有 DB 內容遺失。

## 已查核維度

- **規格與流程**：延續已讀的 review skill、project／acceptance／verification／review-evidence／architecture 規範及 issue README／implementation-plan。核准 SHA `741ba85` 至本 HEAD 的 README 差異僅 SHA 回填、Timeline、狀態，SCN-001～014 語意不變；無 F-2 豁免或安全契約修訂。
- **完整範圍與交互影響**：核對 BASE..HEAD 完整異動清單，逐檔閱讀本輪產品／測試／任務證據差異，沿用上輪對未變動 source 的審查；重查 CLI 選根 → 計畫 → 內部目標／host／instructions 預檢 → init/deploy → vector 初始化與 readiness 的交互路徑。舊七項 root/env/vector 設定回歸沒有本輪新改動，完整 onboarding 仍全過。
- **架構與依賴**：沒有新增依賴、核心資料 schema 或 HTTP/SDK envelope 變更。向量初始化仍由 helper 自己的 libSQL 依賴在子程序執行，DIM 與既有 ingest 一致；未把 helper 依賴匯入 core。
- **品質與測試真偽**：新的內部目標清單與檔案／目錄小 helper 能修復 F-1；未發現跨 Task 過度設計或須阻擋的重複分歧。新增測試有實際失敗／副作用 assertion，F-2 深層組合缺漏不代表既有通過案例是假綠燈。部署標記副本備份未額外擴張成缺陷：本次手寫 skill 案例已拒絕，沒有把未核准的新需求列為 gate。

### 驗收覆蓋

| Scenario | 本輪結論／證據 |
| --- | --- |
| SCN-001 | onboarding wizard、確認／取消、自訂 root 預覽通過 |
| SCN-002 | onboarding 新程序沿用保存全域根通過 |
| SCN-003 | 本地根／env precedence 與既有 `.memory` 偵測通過；F-1c 獨立負向探針通過 |
| SCN-004 | 雙 host 部署／launcher 回歸通過；深層未知 symlink 保護仍失敗，見 F-2 |
| SCN-005 | managed blocks／備份與重跑通過；既有 instruction 祖先的深層漏檢見 F-2 |
| SCN-006 | 非空 corpus、舊 cursor、coverage 與 vector route 的 stub＋真 libSQL 測試通過 |
| SCN-007 | 基本模式、空 corpus 及既有空向量檔通過；F-3 獨立外層探針通過 |
| SCN-008 | 重跑／cache／規範保留回歸通過；F-1b 手寫 skill 保護獨立確認 |
| SCN-009 | F-1 與原 F-2 具體案例通過；深層 CODEX_HOME symlink 仍違反必要安全要求 |
| SCN-010 | 故障注入／重試回歸通過，F-3 原空庫阻塞已解除 |
| SCN-011 | 非互動、JSON Lines、互斥旗標及取消回歸通過 |
| SCN-012 | DB root mismatch、環境覆寫與跨根向量隔離回歸通過 |
| SCN-013 | 隔離 probe 及真實空庫零合成資料回歸通過 |
| SCN-014 | smoke／bootstrap／vector-recall 通過；本輪未重跑所有平台／packed 安裝，限制見下 |

### 本次實際證據與限制

協調者在相同固定 HEAD、Node 22 與新 bundle 回報下列全部 exit 0：

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

完整 onboarding 包含 Step 7 的 F-1～F-3 新案例；bootstrap 的 `Killed` 是預期故障注入。以上綠燈未涵蓋本報告的深層祖先案例。

本 reviewer 實際執行 `node --import tsx /tmp/memoria-issue28-a02c01c-inner.mts` 與 `node /tmp/memoria-issue28-a02c-outer.mjs`，driver 均 exit 0；各子 setup exit／副作用詳列上文，並直接讀取深層 AGENTS.md 確認 managed block。outer fixture `/tmp/memoria-a02c-outer-KsYLMM`；runtime 複製 freshly-built dist、package.json、skills，連結既有 node_modules，stub cache 只沿用真實既有依賴。所有資料／設定寫入隔離於 /tmp，未使用真實 HOME 或全域 Memoria。依權限流程升級執行 outer 子程序；一次準備探針時舊 /tmp 腳本已不存在，該次 MODULE_NOT_FOUND 未當產品證據，已重新建立並完成上述探針。

本輪沒有 local 模型實機、macOS／Windows、Node 18、完整 npm/no-clone 安裝的新證據；保留 implementation-plan 的歷史紀錄，不宣稱本次重跑。未修改函式或提交，GitNexus edit-impact／commit detect_changes gate 不適用。

## 流程判定

**RETURN TO execute-task** — F-1 與 F-3 原具體缺陷已修復，F-2 的原淺層案例也已阻擋，但四層上限仍可重現同一項未豁免 P1 安全缺口。不得用既有測試全綠代表未知祖先 symlink 的完整保護已完成。
