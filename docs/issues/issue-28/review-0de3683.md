# 獨立複查報告

- 範圍：F-2 修復的**局部 diff** 與直接安全／相容交互，非整個 issue-28 的重新完整審查。
- Reviewed BASE SHA：`a02c01c2649d843f611f969a1c666b7e84895bb7`
- Reviewed HEAD SHA：`0de3683f6a5e74857ae6ab7cb220df121a0c9585`
- Reviewed patch-id：`906106bab41406a5122f2b990dd561eb1eace0b8`
- 背景：issue 共同 base 為 `50c2eb7d01167192ad03fcd7801b18942126f234`；前輪發現見 [review-a02c01c.md](review-a02c01c.md)。
- 獨立 reviewer：延續前輪的獨立 Codex review task，非原實作者；未修改產品／測試、未提交、未委派其他 agent。
- Review artifact：`docs/issues/issue-28/review-0de3683.md`
- 日期／風險：2026-10-23／High（祖先 symlink 與多目標寫入保護）。

## 問題與風險

MUST FIX／SHOULD FIX／NICE TO HAVE：本輪局部範圍無新發現。前輪 F-2 的深層 CODEX_HOME 案例已獨立確認修復。

`src/cli/runtime.ts:182` 現在遍歷祖先至根目錄，不再依四層深度提前放行；`src/cli/runtime.ts:171` 的平台例外僅為 darwin 的精確頂層 `/tmp`、`/var`、`/etc`，不會依 basename 放行任意使用者子目錄。

## 已查核維度

### 規格、範圍與品質

- 依 review skill 與已讀 project／acceptance／verification／review-evidence／architecture 契約，核對固定 BASE..HEAD 全部五個異動檔案。產品變更僅祖先 helper 與明確平台 alias；其餘為 inner／outer 回歸、implementation-plan 更新及前輪報告新增。
- SCN-009 的未知 symlink 拒絕／修改前零寫入要求維持；README、核准規格與 gate 豁免沒有本輪變更。主要映射為 SCN-009，直接交互包含 SCN-004／005 的 host skill 與既有 instruction 寫入。
- 未新增依賴、schema、CLI／HTTP／SDK 契約變更。最近存在目錄的可寫檢查仍保留，其上每個祖先繼續辨識 symlink；合法真目錄不因深度被拒絕。
- 新的測試針對原已重現失敗模式，包含非 0、無新 skill、無 managed block、無 data-root 等 assertion，沒有弱化既有測試或同義反覆。抽取精確平台判斷的小 helper 合理，無阻塞的重複／過度設計。

### 獨立外層對照

以本次 freshly-built bundle 建立 installed-shape runtime（複製 dist、package.json、skills，連結既有 node_modules），隔離 HOME、XDG、Memoria/libSQL env。每個 fixture 已含 `a/b/c/d/e/skills/` 真目錄與內容為 `host sentinel` 的 AGENTS.md，設定 CODEX_HOME 為對應深層路徑後執行：

```text
node <isolated-runtime>/dist/cli.mjs setup --scope global --memoria-home <root> --agent codex --no-vector --yes --json
```

| 輸入／狀態 | 實際結果與判定 |
| --- | --- |
| 原失敗案例：`CODEX_HOME=<fixture>/link/a/b/c/d/e`，link 指向未選目錄 | exit 1，`agent-skill ok:false` 明示 link 祖先衝突；root 未建立、目標 skill 未建立、AGENTS.md 完全維持 `host sentinel`、install.json 未建立。原 F-2 已修復 |
| 同深度路徑全部為真目錄 | exit 0，readiness ready；skill 部署、instruction 接線、保存設定正常。沒有深度造成的誤拒 |
| 使用者目錄中名為 `tmp` 的深層祖先 symlink | exit 1，明示該 symlink 衝突；root／skill／settings 均未建立，AGENTS.md 不變。沒有同名子目錄放行回歸 |

實際命令 `node /tmp/memoria-issue28-0de3683-probe.mjs` 的 driver exit 0，各子 setup exit 如上；fixture `/tmp/memoria-0de-UEfCvw`。outer 子程序依權限流程升級執行，全部寫入僅在暫存 fixture，沒有使用者 HOME／host／全域記憶副作用。上表保留可重建的輸入與持久化結果，不將探針 driver 的 exit 0 誤作所有子案例都成功。

### 回歸證據與平台限制

協調者在相同固定 HEAD、Linux／Node 22、新 bundle 回報以下命令全部 exit 0：

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

完整 onboarding 包含新增 inner F-2c/d、Step 7 深層外層案例與既有向量流程；bootstrap 的 `Killed` 是預期故障注入。本輪未另外執行獨立 `test-vector-recall.sh`，不把前輪執行紀錄當成本輪新結果。

darwin 頂層 alias 分支本輪僅靜態核對其 platform 與完整路徑條件；沒有原生 macOS、Windows、Node 18 或實機 local 模型的新驗證，不宣稱平台全面通過。此局部審查未發現可重現的直接相容回歸。沒有修改 symbol 或提交，GitNexus edit-impact／commit detect_changes gate 不適用。

## 流程判定

**PASS（F-2 局部修復）** — 原深層 symlink 漏檢已拒絕且零寫入，真目錄對照正常，必要的本輪失敗面與回歸已查核，無 MUST FIX。此 PASS 僅綁定上列 BASE／HEAD 的局部範圍，不自動代表整個 issue-28 重新完整審查或所有平台驗證完成。
