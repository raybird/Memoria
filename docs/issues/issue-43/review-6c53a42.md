# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：0eb4e8dd108407456e7c5c91444dc738429aefc2
- Reviewed HEAD SHA：6c53a422b76c9e531540c5cea185f41e1973efc3
- Reviewed patch-id：f1af3671754c706113d7a339f1895fffa3ac7bd7
- 獨立 reviewer：Claude（獨立 reviewer subagent，未參與實作）
- 增量覆審：上一份報告 review-d3a8ea0.md，增量範圍 `d3a8ea0..6c53a42`；處理上一份 PASS 的建議（使用者選修正：NICE TO HAVE 1、2）

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
無。

## 已查核維度
- **增量覆審的前提**
  - HEAD 是 `6c53a42`，`git merge-base main HEAD` 仍是 `0eb4e8d`。
  - `git diff 0eb4e8d 6c53a42 | git patch-id --stable` 得到 `f1af3671754c706113d7a339f1895fffa3ac7bd7`。
  - 增量有兩個提交：`f02a0c7` 只保存 review-d3a8ea0.md 並更新 README 的記帳區段；`6c53a42` 只處理 TBD-9、TBD-10。兩個都沒有夾帶其他修改，所以照「只處理建議」的規則審查。
  - `git diff d3a8ea0 6c53a42 -- src` 沒有輸出，src 沒有變動。
  - 增量改動的檔案共三個：`docs/issues/issue-43/README.md` +7/−2、`docs/issues/issue-43/review-d3a8ea0.md` +70/−0、`scripts/test-memory-attributes.sh` +3/−1。
- **NICE TO HAVE 1（位置斷言補兩個案例，`scripts/test-memory-attributes.sh:409-411`）：已修好。**
  - 新增 `$'a​b\nc|U+200B at character 2'`（格式字元在控制字元之前）與 `$'git\U000E0001x|U+E0001 at character 4'`（astral 的 Cf）。
  - 用 `od` 確認 bash 在 UTF-8 locale 下產生的位元組正確：前者是 `61 e2 80 8b 62 0a 63`，後者是 `67 69 74 f3 a0 80 81 78`。`\u` 吃滿 4 位、`\U` 吃滿 8 位，後面的 `b` 與 `x` 不會被當成十六進位。
  - 原有三個案例和斷言沒有改動，只是加了一行註解並把迴圈拆成兩行；`bash -n` 通過。
  - 我在 HEAD 的 `git archive` 副本先跑 `pnpm run build`，再加上指定的 env 前綴跑 `bash scripts/test-memory-attributes.sh`，exit 0，結尾是 `[attributes] ✓ all checks passed`。
  - 變異測試一：把 `firstForbiddenIndex` 的 `Math.min(format, controlInRaw)` 改成 `Math.max`，重新 build 後 exit 1，停在 `✗ 錯誤沒有指出 U+200B at character 2`，實際訊息是 `found U+000A at character 4`。
  - 變異測試二：把 `raw.codePointAt(forbidden)` 改成 `raw.charCodeAt(forbidden)`，重新 build 後 exit 1，停在 `✗ 錯誤沒有指出 U+E0001 at character 4`，實際訊息是 `found U+DB40 at character 4`。
  - 還原後重新 build 再跑，exit 0。這些結果和 README 步驟 3 新增的「review-d3a8ea0 修正」證據一致。
- **NICE TO HAVE 2（步驟 2 補記 impact，`docs/issues/issue-43/README.md:65`）：已修好。**
  - 我用 GitNexus 跑了 `registerBriefCommand`、`registerWikiCommand` 的 upstream impact，兩個都是 LOW，d=1 都只有 `src/cli.ts` 的 `run`，和 README 寫的一致。
- **README 其他變動**
  - `grep -n '<' docs/issues/issue-43/README.md` 沒有輸出。
  - TBD-9、TBD-10 的狀態欄都是「已解決」，附上日期與使用者的選擇；TBD-10 的 AC 欄寫「無」，這是正確的，因為 impact 紀錄不對應任何 AC。
  - Timeline 新增兩列，日期是 2026-11-27。`## 現況` 的 `**現行 review**` 指向 review-d3a8ea0.md，這在本輪是正確的記帳；保存本報告後要改成 review-6c53a42.md。`**狀態**` 仍是「審查中」。
  - `## 驗收條件` 區塊和 `d3a8ea0` 完全相同。和 `0eb4e8d` 相比，只有 `**核准 commit**` 從 `待提交` 回填成 SHA，AC 文字沒有變。
  - 保存的 review-d3a8ea0.md 在 `f02a0c7` 與 `6c53a42` 之間沒有變動。
- **受影響之處**
  - 增量只改了測試與文件，沒有影響未改動的程式，也不影響上一份報告的其他結論。受影響的測試只有 `test-memory-attributes.sh`，已在 HEAD 重跑，結果見上。
  - 跑完後確認 `~/.memoria` 沒有在本輪之後被修改的檔案，repo 工作目錄也是乾淨的。
- 其餘沿用 review-d3a8ea0.md
- 豁免、待確認與限制：
  - 本輪沒有新增豁免或待確認事項。
  - 本輪沒有重跑 CI 的其他腳本：src 沒有變動，增量只動了 `test-memory-attributes.sh`。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
