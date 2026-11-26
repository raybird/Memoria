# 審查報告
- 範圍：完整交付範圍（issue-36，分級 Small、風險 Low，只改文件）
- Reviewed BASE SHA：53e93bea1d58f4debedcaff326ba02f349feff9d
- Reviewed HEAD SHA：438a19e8b459a06e5829536352aa34d75834a635
- Reviewed patch-id：115295fafc0e042ae563f25595430ac00e37a6be（`git diff 53e93be..438a19e | git patch-id --stable`；增量 `21ad101..438a19e` 的 patch-id 為 9308e0d5ae0929dc6ffcee302de9f63833de45be，只作輔助識別）
- 獨立 reviewer：Claude Code 獨立 subagent（非實作者），2026-11-26
- 增量覆審：上一份報告 review-88b341c.md（PASS，綁定 88b341cf5d9e2802a0ac8442a8ef8d5cd9fd8679），增量範圍 `88b341c..438a19e`。其中 21ad101 是保存報告與建立現況的記帳提交；我重跑 verify-artifact（`--reviewed 88b341c --head 21ad101`），結果 OK。438a19e 只處理上一份報告的建議，處理範圍是使用者選了修正的 N1～N3（TBD-2），外加 S1 與 N4 的結論紀錄（TBD-1、TBD-3）和步驟 3 的重跑證據。

協調者要我把 Reviewed BASE 寫成 88b341c，但 review-evidence.md「增量覆審」規定 Reviewed BASE 是原 BASE、patch-id 依 `BASE..新 HEAD` 計算，只記上一個 HEAD 的報告算局部審查，所以這裡照規定寫 53e93be。增量覆審的條件都成立：上一份是 PASS、記完整範圍、綁定 88b341c；88b341c 是 438a19e 的祖先，中間沒有 merge 也沒有改寫歷史；`git merge-base main 438a19e` 仍是 53e93be；審查時工作樹乾淨，只有本報告這個未追蹤檔。

## 問題與風險

- **MUST FIX**：無。
- **SHOULD FIX**：無。
- **NICE TO HAVE（可不處理）**：`docs/issues/issue-36/README.md` 的 TBD-3。狀態欄的理由「例行更新、影響很小」偏弱。可以改寫成具體理由，例如「`## 涉及檔案` 是凍結內容，補列會讓 PASS 失效，而 CHANGELOG 是每個 issue 都會更新的例行檔」。現在的寫法符合 `已解決` 要有結論、理由與日期的要求，不影響判定。

## 已查核維度

- **上一份建議的處理情況**
  - N1：已修好。`DEPLOYED_SKILL.md:53` 的命中欄位補了 `score`，並寫明 "which only orders the hits"。依據是 `src/core/memoria.ts` 的 rank 流程與 `src/cli/commands/recall.ts:72-73` 的註解，兩者都說排序只看 `score`。
  - N2：已修好。原本獨立的 `[ n/a ]` 段併進 :53 的 bullet；:54 的 confidence 句改成 "when the top hit is such a semantic-only hit"，指回同一個定義。「只靠語意索引 → 沒有 `relevance`」現在只在 :53 定義一次，:54 是引用。AC-2 要求 skill 說明「`[ n/a ]` 代表只靠語意索引找到、沒有字面分數、不是低分」，:53 仍保有這三點，說法也和 `recall.ts:71-76` 的註解一致，所以 AC-2 仍符合。
  - N3：已修好。`docs/CLI.md:62` 與中文版補了 `session_id`；`score` 的說明改成 "not a 0–1 match quality"、「不是 0–1 的比對品質」，和上一份實測值（keyword 約 2e-06、融合後約 0.016～0.033）不矛盾；其他欄位改成泛稱（"other fields such as `source` and `verify`"、「`source`、`verify` 等其他欄位」）。中英文內容對應。
  - S1：使用者選文件不改，記為 TBD-1。我核對了 TBD-1 引用的事實：`feedback.ts:41`、`telemetry.ts:99-101` 的行號與內容正確，和上一份報告的實測一致。
  - N4：使用者選不修，記為 TBD-3。
- **對未改動內容的影響**
  - skill 只改了 :53-56，AC-1 對照的欄位名稱與位置沒有變（`data` 陣列、`id`、`meta` 的四個欄位），所以上一份 AC-1 的實測結論仍成立。
  - CHANGELOG.md:11 對 skill 的描述（`--json` 形狀、`[ n/a ]` 的意思）仍然準確，不需要改。
  - `DEPLOYED_REFERENCE.md`、`docs/INTEGRATIONS.md` 都沒有提到被改的句子。
- **AC-5 與靜態檢查（在 438a19e 重跑）**
  - `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/test-bootstrap.sh`：exit 0，`[bootstrap] ok`。
  - 同樣環境跑 `test-setup-onboarding.sh`：exit 0，`[setup-onboarding] ok`。它以 `cmp` 比對各 host 部署的 skill 與新範本，結果相同。
  - 同樣環境跑 `test-npm-install.sh`：exit 0，`[npm-install] ok`。
  - 三份 log 都沒有 `✗`。`node scripts/check-deployed-skill-sync.mjs` 回 `deployed_skill_check=ok version=1.39.0`，`pnpm run release:docs-check` 通過，DEPLOYED_SKILL.md 沒有出現任何禁用字串。README 步驟 3 補記的重跑證據與我的結果一致。
- **README 的寫法與格式（增量的部分）**
  - `## 待確認事項` 的表頭照 docs/AGENTS.md 範本 `| 編號 | 事項 | 狀態 | 影響 |`，編號 TBD-1～3，位置在實作步驟之後、Timeline 之前。整節沒有 `<`，行首都是表格列，沒有用粗體或 `[` 開頭。
  - TBD-1 是 `待確認`，寫了決定日期，也寫了「追蹤：另開的 issue 尚未建立」。這符合「決定另開追蹤 issue、還沒開好時維持 `待確認`，並寫明要開的 issue」。影響欄是 AC-3。
  - TBD-2 與 TBD-3 都是 `已解決`，狀態欄有日期、使用者原話（「照建議」）、選項與結論。
  - Timeline 補了一列。`**狀態**: 審查中` 正確，`## 現況` 已由 21ad101 建立。
- **需求、架構、安全、品質**：只改文件，不涉及架構與安全。增量沒有引入重複或矛盾。
- **公開 repo 規則**：增量沒有個人絕對路徑，也沒有外部專案真名。提交訊息格式是 `docs(issue-36): …`，沒有 AI 署名。
- 其餘沿用 review-88b341c.md。
- **豁免、待確認與限制（本輪新增）**
  - TBD-1 仍是 `待確認`，屬非阻塞項：AC-3 照核准文字達成，不會造成錯誤寫入，不擋本次交付的 PASS。但在追蹤 issue 開好、TBD-1 改成 `不影響本次交付` 並寫上 issue 編號之前，`**狀態**` 不能寫成 `已完成`，因為還有待確認事項。
  - 保存本報告的提交要把 `## 現況` 的 `**現行 review**` 改成 review-438a19e.md。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
