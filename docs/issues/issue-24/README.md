# Issue 24 - `release.sh publish` 在 npm registry 尚未更新時誤報發版失敗 (Small)

## 概述

`release.sh publish` 等 release workflow 跑完後，「Verify what actually shipped」第一步就是 `npm view @raybird.chen/memoria version`，與目標版本不同就 `die`。這個查詢回的是 `latest` dist-tag；npm publish 回報成功後，registry 要幾分鐘才更新（publish log 也寫 `Your package is being processed and may take a few minutes to become available`）。

2026-10-21 發 v1.30.0 時實際發生：workflow 的 `Publish to npm` 在 22:16:23Z 印出 `+ @raybird.chen/memoria@1.30.0`，腳本緊接著查到 `1.29.1`，以 `✗ npm reports 1.29.1, expected 1.30.0` 結束。發版本身已成功，排在後面的 GitHub Release 檢查與已發布 tarball 的 delivery parity 卻因此沒有執行，得手動補跑，並等到 registry 查得到 1.30.0。

修法：先跑不需要等待的兩項（GitHub Release、parity），最後才查 npm；查詢改用帶版本的 `@raybird.chen/memoria@<version>`，在上限時間內輪詢到出現為止。逾時仍查不到時才失敗，訊息說明 workflow 已發布、tag 不可重用，並給出之後自行確認的命令。

## 涉及檔案

- `scripts/release.sh` - Verify 段的順序與 npm 輪詢
- `RELEASE.md` - publish 守門表（npm 輪詢與逾時時的處置）
- `docs/HANDOVER.md` - §8 Release SOP 的守門敘述

## 驗收條件

1. **AC-1**：release workflow 成功後，publish 先完成 GitHub Release 與 parity 檢查，再以 `npm view @raybird.chen/memoria@<version> version` 輪詢（間隔與上限次數為腳本常數，預設 10 秒 × 30 次 = 5 分鐘）；查到目標版本即印出 `Released <tag>` 並以 0 結束。`latest` 仍是舊版不再造成失敗 — 檢查方式：PATH 前置假的 `npm`，前幾次回 E404、之後回目標版本；假的 `gh` 讓 Release 與 parity 通過；只執行 Verify 段，斷言 exit 0、輸出含等待次數與 `Released`
2. **AC-2**：上限內一直查不到時以非 0 結束，訊息說明 workflow 已成功發布、tag 不可重用，並列出確認用的 `npm view @raybird.chen/memoria@<version> version` — 檢查方式：同上，假 `npm` 一律 E404、上限調小，斷言非 0 與訊息內容
   - 失敗路徑：本條即失敗路徑

- **核准日期**: 2026-10-21
- **核准來源**: 使用者 2026-10-21 回覆「依照順序處理 1 2 3」，接受「先修好 `release.sh` 在 npm 剛發布時誤報版本的問題，再發 v1.30.1」。AC-1、AC-2 的具體行為（檢查順序、帶版本的查詢、5 分鐘上限、逾時訊息）由規劃推導，使用者 2026-10-21 回覆「照建議」核准（建議內容：先查 GitHub Release 與 parity、最後以帶版本的查詢輪詢 npm，10 秒 × 30 次、上限 5 分鐘，逾時才失敗並附確認命令）

## 風險與首要驗證

**風險**: Low — 只動發版腳本的最後一段，不影響已推送的 tag 與 workflow；改錯的後果是 Verify 誤報或漏報，可以手動補驗。腳本沒有自動測試，Verify 段的輪詢以假 `npm`／`gh` 的本機 harness 驗證；真正的證據是下一次發版（v1.30.1）不用人工介入就能跑完。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | AC-1、AC-2 的具體行為需使用者確認 | 已解決 | 2026-10-21 使用者回覆「照建議」，全部核准 |

## 實作與驗證步驟

1. ✅ **AC-1、AC-2：Verify 段改為先查 GitHub、後輪詢 npm** — 驗證方式：以假 `npm`／`gh` 的 harness 依序取得紅燈（現行腳本在第一次查詢就失敗）與綠燈；`bash -n scripts/release.sh`
   - 完成證據（2026-10-21）：
     - 先做純重構：把 Verify 段原樣搬進 `verify_shipped <version> <tag>`，腳本尾端加 source guard（被 source 時只定義函式、不執行 `case`）。直接執行的行為不變：`bash scripts/release.sh` 照樣印 `✗ usage: …`。
     - harness（附在下方）：假的 `npm` 只接管 `view`，`view <pkg> version` 回舊的 `latest`（1.29.1），`view <pkg>@<v> version` 在前 N 次回 E404；其他子命令（parity 用的 `npm pack --dry-run`）交給真的 npm。假的 `gh` 讓 `release view` 成功，`release download` 複製本機 `release:package` 產出的 `dist/release/memoria-linux-x64-v1.30.0.tar.gz`。以 `NPM_POLL_INTERVAL=0` 只跑 `verify_shipped 1.30.0 v1.30.0`。
     - 紅燈（重構後、修正前）：AC-1 情境（第 4 次才查得到）→ `✗ npm reports 1.29.1, expected 1.30.0`，rc=1，npm 只被呼叫 1 次，排在後面的 GitHub Release 與 parity 都沒跑——與 v1.30.0 發版當下的訊息相同。AC-2 情境同樣在第一次查詢就失敗，訊息不含確認命令。
     - 綠燈：
       - AC-1：先 `Delivery parity check passed`，再 `── Wait for npm to serve 1.30.0 ──`、`✓ npm serves 1.30.0 (attempt 4)`、`── Released v1.30.0 ──`，rc=0，npm 呼叫 4 次。
       - AC-2（`NPM_POLL_ATTEMPTS=4`、一律 E404）：parity 通過後 `✗ npm does not serve 1.30.0 after 0s.`，接著說明 workflow 已發布、GitHub Release 與 parity 已通過、`the public tag v1.30.0 must NOT be reused`，並列出 `npm view @raybird.chen/memoria@1.30.0 version`；rc=1，呼叫 4 次。
       - 版本一開始就查得到：`attempt 1`，rc=0。
     - 其他檢查：`bash -n scripts/release.sh` 通過；`pnpm run release:docs-check` 通過；`pnpm run check` 無錯。CI 不執行 `release.sh`，本變更也沒動到 CI 會跑的檔案，所以沒有重跑 CI 全套。
     - 常青文件：RELEASE.md 守門表新增一列、HANDOVER §8 Release SOP 補上 npm 輪詢、`release.sh` 開頭的守門清單補一項。
     - GitNexus：bash 不在索引內（`cmd_publish` 查無此 symbol）；grep 確認 `cmd_publish` 只由 `package.json` 的 `release:publish` 呼叫，`verify_shipped` 只由 `cmd_publish` 呼叫。
     - 精煉：code-simplify no-op。輪詢迴圈沿用既有 `RUN_POLL_*` 的寫法，沒有可再收斂的重複。
     - harness 過程中自身的錯誤照實記錄：假 `npm` 的 glob 一開始寫錯，scoped 套件名本身以 `@` 開頭，修正前讓兩種查詢分不開。上面的紅綠燈都是修正後的結果，紅燈判讀不受影響，因為 `latest` 查詢在兩版 glob 下都落到回 1.29.1 的分支。

     <details><summary>harness 原文</summary>

     `bin/npm`：

     ```bash
#!/usr/bin/env bash
# fake npm: `view <pkg> version` -> stale latest; `view <pkg>@<v> version` -> E404 until FAKE_NPM_READY_AFTER calls
[ "$1" = view ] || exec "$REAL_NPM" "$@"
n=$(( $(cat "$FAKE_STATE/npm-calls" 2>/dev/null || echo 0) + 1 )); echo $n > "$FAKE_STATE/npm-calls"
case "$2" in
  ?*@*) if [ "$n" -gt "${FAKE_NPM_READY_AFTER:-999}" ]; then echo "${2##*@}"; else echo "npm error code E404" >&2; exit 1; fi ;;
  *) echo "1.29.1" ;;
esac
     ```

     `bin/gh`：

     ```bash
#!/usr/bin/env bash
# fake gh: release view / download succeed; download copies the locally packaged artifact
[ "$1 $2" = "release view" ] && { case "$*" in *--json*) echo "https://example.invalid/releases/$3";; esac; exit 0; }
if [ "$1 $2" = "release download" ]; then
  dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done
  cp "$FAKE_ARTIFACT" "$dir/"; exit 0
fi
echo "fake gh: unexpected $*" >&2; exit 2
     ```

     `run.sh`：

     ```bash
#!/usr/bin/env bash
# usage: run.sh <repo> <ready_after> [attempts]  -> runs verify_shipped 1.30.0 v1.30.0 with fakes
set -u
REPO="$1"; export FAKE_NPM_READY_AFTER="$2"; ATT="${3:-}"
export REAL_NPM="$(command -v npm)"; export FAKE_STATE="$(mktemp -d)"; export FAKE_ARTIFACT="$REPO/dist/release/memoria-linux-x64-v1.30.0.tar.gz"
env PATH="$(dirname "$0")/bin:$PATH" NPM_POLL_INTERVAL=0 ${ATT:+NPM_POLL_ATTEMPTS=$ATT} \
  bash -c 'source "$1/scripts/release.sh"; verify_shipped 1.30.0 v1.30.0' _ "$REPO"
rc=$?; echo "rc=$rc npm_calls=$(cat "$FAKE_STATE/npm-calls" 2>/dev/null)"; rm -rf "$FAKE_STATE"; exit $rc
     ```

     </details>
2. ⏳ **實際發版觀察**（相依：步驟 1 合併進 main）— 驗證方式：v1.30.1 的 `release:publish` 不用人工補驗就跑到 `Released`，輸出記錄 npm 輪詢的等待次數
   - 完成證據：（發版時回寫）

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-21 | 建立 | - |
| 2026-10-21 | AC-1、AC-2 核准（「照建議」） | - |

---
**建立日期**: 2026-10-21  
**分級**: Small  
**風險**: Low\
**狀態**: 待審查
