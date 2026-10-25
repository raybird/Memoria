# Issue 30 交付複審報告

- 範圍：完整 `f89d675..96b9421` 本機交付；複核前次完整審查及 `2777c31..96b9421` 全部 delta。
- Reviewed BASE SHA：`f89d6754a9eaa534c5ce018716698ddb70164721`
- Reviewed HEAD SHA：`96b94218a9fcafcc176183fa971591be129dc3c9`
- Reviewed patch-id：`e3b45eb94dda90c1dfe922dc22cdc679b697ee8e`
- 獨立 reviewer：宿主 subagent `/root/final_review`，未參與產品實作。
- Review artifact：`docs/issues/issue-30/review-96b9421.md`
- 日期：2026-10-26；風險 High。

## 問題與風險

### MUST FIX — 未知類型來源遇斷線後猜成目前列表類型，重連仍誤報404

位置：`src/ui/app.ts` 的 `resolveMemory` catch → `openMemory(id)`；`openMemory` 的 `kind = state.type` 預設值及 `loadDetail` 的 `?type=${state.detailType}`。

摘要的常駐約束可以引用 decision、skill 或 session。從預設 decision 列表進入摘要後，若使用者在服務中斷時點一筆仍存在的常駐 skill／session，無 type 的來源 lookup 因斷線失敗。新 catch 雖正確讓錯誤區可見，卻用 `openMemory(id)` 把尚未解析的類型猜成 decision。重連後的詳情重試仍傳 `type=decision`，後端因精確類型不符而回404，將實際存在的記憶誤報為已清理。對應 SCN-005、SCN-009、SCN-010；不是新增產品範圍。

獨立 probe 對 reviewed HEAD 原文 `resolveMemory` 經現有 TypeScript transpiler 移除型別，模擬 `Failed to fetch`，記錄 openMemory 的預設類型。另以真實 Core 與隔離資料建立一筆 SkillLearned，查核有無 type 的差異。實際輸出：

```text
after_network_failure [{"id":"skill-still-exists","kind":"decision"}]
backend {"untyped":"skill","guessedDecision":"memory not found"}
exit 0
```

命令為 `node --import tsx --input-type=module` 的隔離函式／Core probe，不宣稱 browser E2E；沒有修改產品或共用資料。此時 app 雜湊 `587918be4b53b3f39c7fd4cd9cbd2155dfd253a6d479ce1c4ac007eb4cbd2b72` 與 `git show 96b9421:src/ui/app.ts` 一致。

建議未知類型失敗時保持 unknown，重試重新進行無 type 的解析；或可見的錯誤頁提供重跑 resolveMemory 的操作。不能只把網路失敗猜成不存在，亦不能以固定 decision 填補未取得的事實。補「摘要常駐 skill／session → 停服務 → 點來源 → 恢復服務 → 重試讀到實際類型」案例。

### SHOULD FIX — 持久 UI 狀態邊界守門

沿用 [前次完整報告](./review-2777c31.md) 的非阻塞建議。新發現再次顯示 decision 成功／404 路徑無法涵蓋未知跨類型來源與斷線恢復；應在持久手動矩陣或現有工具的狀態測試中明列，避免只驗預設類型。

## 前兩項 MUST FIX 複核

- 摘要已刪 ref：catch 走既有 openMemory，正確切換 brief→library，404不再落入隱藏reader。協調者 Chrome 紅綠為 `readerHidden=true` → `false`，並能回110筆列表；此項已解決。
- 純空白 URL query：readState 先 trim，空白條件標 invalid 並回退空查詢；Chrome 由誤報斷線變為111筆、空輸入與預設值提示。此項已解決。
- 刪除失敗分支的重複狀態操作提升一致性；但預設 kind 對未知來源的網路錯誤仍有上述缺陷，因此不能將這個版本判 PASS。

## 已查核維度

完整原始碼、HTTP安全、Core資料與marker／Git來源、內嵌打包及雙語文件的查核結論，見前次完整報告的「已查核維度」；本次以固定 SHA 比對確認，未受 delta 影響的內容保持相同。`2777c31..96b9421` 唯一程式變更是 readState 與 resolveMemory，另外是驗證紀錄及前次報告；沒有 schema、依賴、後端、CI、打包或規格變更。

| SCN | 本次完整交付覆核 |
| --- | --- |
| SCN-001 | loopback、readiness、EADDRINUSE、普通 API 契約未變；證據有效。 |
| SCN-002 | Host／Origin／Fetch Metadata、固定資產、CSP、文字escape與一般瀏覽零業務寫入未變；證據有效。 |
| SCN-003 | 原始類型、50筆、穩定時間／ID分頁、note不重複未變；證據有效。 |
| SCN-004 | 精確範圍、environment先scope、ref markers未變；證據有效。 |
| SCN-005 | 完整原文與來源可讀，摘要已刪ref可見404已修；跨類型來源遇斷線仍可能誤報404，需修。 |
| SCN-006 | 搜尋的guard／取消、降級、confidence、無自動feedback與原Core契約未變；證據有效。 |
| SCN-007 | 使用既有BriefData且無BRIEF.md寫入未變；證據有效。 |
| SCN-008 | 中文工作台／長內容／主題的既有實測仍有效，未變更外觀。 |
| SCN-009 | 空白q已正規化；history／焦點／來源race既有證據有效；跨類型未知來源恢復需修。 |
| SCN-010 | 已刪ref與空白q兩項已解；未知類型來源的斷線重試仍未正確恢復，需修。 |
| SCN-011 | 三尺寸／鍵盤／對比／coarse／reduced-motion的既有證據仍有效，輔具限制明確。 |
| SCN-012 | 後端萬筆樣本、50筆邊界與前端提交回應未變；證據有效。 |
| SCN-013 | 補修後重新build、npm／tar安裝與真實network none兩者exit0的紀錄已持久化；不把原始碼測試冒稱安裝驗證。 |

新版驗證紀錄保留兩項真實紅綠、被測 app 雜湊與最後安裝重驗；未弱化測試或更動驗收門檻。核准 SCN 集合與 Proof of Test 一致，無新增需決策問題或豁免。既有取消後Core可能繼續計算、macOS／Node18／live模型與實體輔具等限制，維持明確揭露，未當作新阻塞。可讀性與證據持久力建議不作為本次 RETURN 的理由；RETURN 只由上述可確認的功能缺陷驅動。

## 流程判定

**RETURN TO execute-task**。Task 3.2 的獨立審查 gate 尚未通過，dev-cycle 目前回實作修復；不得標等待合併或沿用本報告到新 HEAD。修正未知類型來源的斷線恢復並提交後，可針對新的固定完整範圍再次複審。
