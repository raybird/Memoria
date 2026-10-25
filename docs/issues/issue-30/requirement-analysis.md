# Issue 30 - 需求與現況分析

## 需求描述

使用者目前透過 CLI 和 agent 詢問記憶內容及健康狀態，希望能直接使用 UI 看記憶，並要求 UI/UX 達到專業商品品質。目標使用者是本機 Memoria 的擁有者，核心任務為找到一筆記憶、閱讀完整內容與理由、確認來源，再回到原本的瀏覽上下文。

先前對話提供兩個互動概念：「工作台」與「閱讀優先」。兩者均以範例內容展示，沒有正式資料 API，不能將 prototype 當成已完成的產品或使用者已選定的方向。工作台方向已由 README Q2 於 2026-10-25 核准。

## 現況分析

### 入口與發布

- `serve` 目前只啟動 HTTP JSON API；`startServer` 的 `listen` 沒有指定 host，因此新 UI 模式需明確決定本機監聽與來源邊界，不能假定印出 localhost 就等於僅接受本機連線。
- HTTP router 同時含讀取與寫入操作；「畫面沒有刪除按鈕」無法證明 viewer 的 HTTP 表面為唯讀。
- 發布透過 esbuild 產生 `dist/cli.mjs`。npm 與 release tar 有不同交付路徑，UI 若依賴原始碼相對檔案，容易出現 checkout 可執行而安裝後缺檔。

### 記憶實體與列表缺口

- `sessions` 儲存時間、project、scope、summary；`events` 儲存原始事件內容。`DecisionMade` 與 `SkillLearned` 是可讀取理由與技能模式的權威事件。
- `rememberNote` 產生合成 session 與一個事件。同時列出兩者會使使用者把同一則 note 誤認為兩則獨立記憶。
- `skills` 是從技能事件萃取的彙整資料，與原始 `SkillLearned` 事件不等價；首版建議以原始事件呈現技能內容與 session 來源，不將彙整技能數與事件數混算。
- `listRecentSessions` 僅提供最多 100 筆 recent session，缺少分頁、完整範圍與事件類型列表；不是瀏覽 API 的現成替代品。
- `querySessionSummary` 的決策只回傳 decision 與 impact，技能只回傳名稱與 category；沒有完整 rationale、pattern 與原始內容。

### 範圍與長期標記

- repository registry 名稱與記憶 `project` 是既有專案範圍依據。brief 把未註冊 project 視為環境共用；browse 與 search 的對外範圍仍需明確規格，不能讓不同頁面悄悄混用規則。
- marker 以原始 ref_id 綁定。常駐、已取代與敏感度不能因同一 session 有另一筆事件便任意互相繼承。
- 列表需保留未知 project、原始 ID 與已不存在的取代者資訊，避免 UI 美化時抹掉可追溯性。

### 搜尋與摘要

- recall 可用 keyword／tree／hybrid／vector；其結果 snippet 為截斷內容，UI 需另外取完整詳情。
- recall 會記錄 routing telemetry，因此不能讓每次列表渲染、hover 或開啟詳情都呼叫 recall。
- semantic-only hit 沒有 relevance，confidence 可為 null；這是無法以詞彙覆蓋量測，不是低可信度。UI 不顯示虛構的匹配正確率。
- 已有 brief API 同時提供結構化資料與 rendered markdown，且不寫 BRIEF.md。UI 應沿用結構化契約，避免複製其排名與範圍政策。
- `/v1/health` 為 DB／目錄檢查，不等同 CLI doctor 的完整 vector 診斷。首版不將其包裝成「所有記憶系統正常」，也不加入一鍵修復功能。

## 問題點總結

畫面本身不是最大缺口；真正需要補的是可分頁的 authoritative 資料契約、安全的本機入口，以及可恢復的瀏覽互動。功能可用與商品級體驗之間，還有長內容、混合語言、空白／錯誤狀態、焦點與回上一頁、主題與手機操作等可驗收責任。

## 目標與核准邊界

高階目標已由使用者指定；可觀察規格、首版範圍、資料分類與品質門檻依 README 的 SCN-001～SCN-013 與 Q1～Q3 核准。本文只記錄現況與需求理由，不建立第二份核准表或任務清單。

需求調查文件建立原因：現有資料實體、檢索副作用、完整詳情與監聽行為都需要讀程式碼才能確認，符合 Large 的 requirement-analysis 觸發條件。
