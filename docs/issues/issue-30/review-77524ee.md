# Issue 30 合併後文件獨立審查

- 範圍：純文件 `51ee396..77524ee`，共15份Markdown；不是重新審查或重啟已合併的產品需求。
- Reviewed BASE SHA：`51ee396f8fc1a78a19c6a419cde0ca3c24cc6da2`
- Reviewed HEAD SHA：`77524ee9bd511c5e03e07709540e4e3955e82a1e`
- Reviewed patch-id：`0b8168a6f2eeebd508f84ecfdcec1903d065602b`
- 獨立 reviewer：宿主 subagent `/root/final_review`，未參與本次文件撰寫。
- Review artifact：`docs/issues/issue-30/review-77524ee.md`
- 日期：2026-10-26；本次風險 Low（說明／合併紀錄，無產品行為變更）。

## 問題與風險

**無 MUST FIX，無需決策、未解驗收或 gate 豁免。**

NICE TO HAVE：`SPEC.md:5` 仍保留2026-10-23／v1.31.1的全檔最後驗證說明，而本次新增的UI及setup敘述已核對到較新實作。正式發版整理版本文件時，可把這行改成分段驗證範圍或更新到實際重驗版本，避免讀者把舊版本標頭誤認為新UI也在該版本發布。本次README、CHANGELOG及交接文件已明確說明UI尚未發版，故此為非阻塞的日期／範圍可讀性改善。

## 已查核維度

### 範圍、合併及發布事實

- 固定diff只有15份`.md`；`src/`、`scripts/`、package版本／lockfile、CI、產品資產與打包行為均無變更。原產品13項SCN與完整PASS仍由[review-f7dfba2.md](./review-f7dfba2.md)及[verification.md](./verification.md)證明，本次不複製或偽造產品紅綠測試。
- 本機`git reflog show main`明確有`51ee396 merge issue-30-memory-ui: Fast-forward`，前一筆為`f89d675`；`git log main`顯示本次文件提交的單一parent為`51ee396`，符合專案不開PR、fast-forward的方式。issue README／Task 3.2回填「已完成」以實際使用者合併授權及本地合併為依據，不虛構merge commit。
- 獨立執行review skill的`verify-artifact.py`，核對產品Reviewed HEAD `f7dfba2`到報告提交`51ee396`，輸出`OK：只有新增本次報告；原 review 可依其真實判定沿用。`。此次文件變更另有本報告，不把artifact例外擴張至15份文件。
- package仍為1.32.0；新CHANGELOG在Unreleased，雙語README明示main已實作但套件尚未發布，給出checkout build／Node入口。HANDOVER保留實際出貨表，新增目前狀態並將過往摘要標成歷史；沒有預填新版本、tag、npm或GitHub Release成功。
- pre-release.md明列推送後完整CI仍待實際執行，不將本機docs-check、打包清單或舊產品PASS冒稱新main CI已綠。本審查同樣不宣稱已push或發布。

### 文件與真實實作一致性

| 文件／失敗面 | 核對結果 |
| --- | --- |
| 雙語README | UI能力列、入口移至License前，兩份章節數相等；初始化資料根、前景Ctrl+C、內嵌離線資產、明確搜尋遙測與原碼／安裝版差異一致。沒有宣稱舊1.32.0已含UI。 |
| 雙語CLI | Tab／Enter／Escape與目前事件處理及焦點恢復相符；`serve --help`有--ui／--json／--port，src啟動JSON確實含UI URL，EADDRINUSE不暗換port/root。 |
| 雙語API | 16KiB以上413與router的`bytes > 16384`契約一致；原400與唯讀／來源邊界說明保留，未放寬安全需求。 |
| OPERATIONS | 取消停止UI呈現但Core可能繼續計算，符合AbortController與Core序列搜尋現況；語意fallback、doctor及未知類型重連敘述與最後產品修正一致。 |
| SPEC | 新UI範圍與已審產品一致；setup區分legacy裸--vector與full onboarding，核對setup.ts的isFullOnboarding及choices.vector下ingest／coverage分支，未把它改為新行為。 |
| CHANGELOG | 功能、相容性、升級與限制涵蓋本次實作；無UI-specific migration、模型重建或自動service/hook承諾；明確搜尋遙測例外及本機history資訊已揭露。 |
| AGENTS | http-mcp五支測試的名稱及執行順序與CI一致，更新驗證日期與範圍；沒有改流程契約、核准狀態字串或新增常駐重複規則。 |
| RELEASE／HANDOVER | UI變更時才觸發隔離browser矩陣，使用現有npm／tar檢查；發布時更新README、CHANGELOG及真實出貨列，入口與前置條件明確。未要求此文件提交重做未變的產品測試。 |
| issue文件 | 歷次RETURN保留歷史；最終完整PASS與報告artifact可追溯，產品已合併與尚未發版分開記錄，唯一任務來源未分岔。 |

### 寫作規範、架構及測試真偽

依writing-rules核對：本次AGENTS只同步已存在的CI事實，既有局部UI指引保持明確觸發；RELEASE新增要求只在UI／發布分支讀取，不放入每個工作回合的重複規則。沒有更改核心契約或重新建立需求核准，雙語README／CLI／API同步。使用現有已知名詞與可觀察完成判準；未新增工具、依賴或不必要流程。安裝／架構指引已有內容且無行為變化，pre-release說明不重複修改的理由合理。

純文件無新可執行行為，紅燈不適用；等價證據為對實作／help／CI／Git事實的交叉核對及靜態連結檢查。不存在改測試換綠燈、同義反覆的業務斷言或以mock掩蓋缺失。原產品的高風險安全面與SCN-001～013未因本diff改變；既有限制保留，本次不將文件整理當作全平台或live模型新驗收。

## 實際獨立驗證

- `node dist/cli.mjs serve --help`：exit 0，列出--port、--ui、--json。
- `pnpm run release:docs-check`：exit 0，`Release doc sync check passed for v1.32.0`。
- `git diff --check 51ee396 77524ee`：exit 0。
- Python依固定diff檔案清單驗證：`PASS: 15 markdown-only files; 108 relative file links exist; README UI before license; bilingual section counts equal`。此檢查驗檔案連結及結構，不冒稱所有anchor或產品行為都經自動驗證。
- Git log／reflog及上列verify-artifact均已獨立執行；typecheck／build及npm dry-run的32檔清單依[pre-release.md](./pre-release.md)實際紀錄查核，未宣稱reviewer自己重跑全部命令。

## 流程判定

**PASS（合併後純文件範圍）**。使用者已授權的本地fast-forward合併及發版前文件整理有可追溯依據，文件符合當前實作與「尚未發版」事實。issue-30產品交付維持已完成；新main完整CI與真正發布仍依後續固定SHA／版本取得證據，不預填綠燈或出貨紀錄。

本PASS只綁定Reviewed HEAD `77524ee`。若新增唯一一個只加入本報告的直接後繼提交，可依review-evidence.md執行verify-artifact驗證例外；其他變更另核對範圍及審查有效性。
