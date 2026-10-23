# Issue 28 - 需求與現況分析

## 需求描述

使用者要求將 2026-10-23 全域安裝與向量啟用所暴露的操作成本，整理成完整改善 issue。需求不是再提供一份更長的安裝指令，而是將既有能力編排成一般使用者可完成、agent 也能確定使用正確資料根的安裝流程。

目標與提議驗收以 [README](./README.md) 為準；本檔只說明現況與需求來源，不維護第二份範圍或工作清單。

## 現況分析

分析基線：v1.31.2，提交 `50c2eb7`；最後查核 2026-10-23。

| 現有入口 | 已有能力 | 尚未整合之處 |
| --- | --- | --- |
| `src/cli/commands/setup.ts` 的 `registerSetupCommand` | preflight、init、verify、skill、可選 host 部署／vector-deps／serve，支援 JSON Lines | 沒有問答或安裝選擇保存；`--vector` 只安裝與暖機，setup 不 ingest、不產生 brief、不編接規範檔 |
| `src/core/paths.ts` 的 `resolveMemoriaHomeInfo` | 環境優先，接著 cwd 的 `.memory`／`knowledge`，再找 cwd/memoria，最後 runtime fallback | 沒有保存的使用者全域預設；setup 自己的 fallback 是 cwd/memoria，與一般命令不同 |
| `src/cli.ts` 的 `run` | 啟動時先解析 paths，再建立 MemoriaCore 與註冊命令 | setup 內部選擇不能自然成為下一個 CLI 程序的預設；新增持久設定需處理啟動順序 |
| `src/cli/runtime.ts` | 資料根部署副本、`DATA_ROOT`、launcher；host 目前有 Claude Code，手寫 skill 衝突先阻擋，部署副本覆蓋前備份 | Codex 的使用者 skill 發現位置沒有對應 setup 選項；沒有多 host 變更計畫與規範接線 |
| `installVectorDeps` 與 `skills/memoria-vector/deps.mjs` | 依鎖檔 hash 放使用者快取、完整安裝標記、模型下載與暖機；保留 sibling 優先 | 需要單獨設定 LIBSQL_URL、確保 provider 正確與 corpus 進入向量庫 |
| `src/cli/commands/doctor.ts` | enabled、helper、embedder、coverage 與可執行 ingest 修法 | `ok=true` 在未啟用語意時也成立；目前不是完整 setup 的完成契約；覆蓋率未知與完整覆蓋需區分 |
| `src/cli/commands/brief.ts` | 產生全域／專案 brief，印出共用 AGENTS 指令與 Claude imports | 只有提示，使用者仍須編輯載入端；setup 沒有產生或驗證它 |
| deployed skill | 透過 DATA_ROOT 找記憶、以 vector 查詢、回饋、doctor 後補索引、重建 brief | host 發現與環境有效值需先接好，技能本身不能替未完成的安裝補出設定 |

GitNexus 唯讀 context 已確認：setup 由 CLI run 呼叫；路徑解析也參與 doctor、serve、service 流程。這只是邊界探索，不代替未來修改 symbol 前的 impact analysis。

## 本次實機流程暴露的缺口

以下是同日已發生的操作，使用泛化的 `~/.local/share/memoria` 表示共用資料位置，不在版控文件包含使用者帳號或其他專案資訊。

1. 全域 runtime 升級後，仍需確認資料根：shell 未設 MEMORIA_HOME，既有專案內只有一份早期資料庫，不能直接假定應將它當作全域記憶。
2. setup 帶明確資料根與 Claude host，另建立 Codex 可發現的 skill 連結；兩者的 DATA_ROOT 與 launcher 都需驗證。
3. 人工備份並修改共用 AGENTS 與 Claude imports，另產生 brief；之後再補 Bash 環境設定，讓新終端與 agent 程序沿用。
4. 後續選擇語意召回，再執行 setup --vector；首次模型與依賴安裝、暖機成功，但尚不能宣稱 corpus 已可召回。
5. 設置本地 LIBSQL_URL、local provider 與 sync 的 vector 開關；doctor 首次顯示 `embedded=0 expected=5 missing=5`。
6. 手動執行 doctor 的 bridge／ingest 命令後，變成 `embedded=5 expected=5 missing=0`。
7. 英文改述成功召回中文資料根決策，實際結果為 `route_mode=vector`、`fallback_used=false`，延遲約 2.4 秒；這是本機可行性證據，非新 setup 的驗收結果，也不是效能承諾。

目前資料庫僅一則 atomic note 對應的記憶實體；5 個 vector entities 不等於 5 則使用者筆記。既有專案內早期資料保留，沒有因全域設定而搬移。

## 問題點總結

- 安裝狀態散在 runtime、資料根、使用者環境、host skill、規範、brief 與向量庫，沒有單一可理解的完成結果。
- 使用者必須知道內部術語與依賴順序；少一步時，recall 仍可能以 lexical 回答，掩蓋語意未啟用。
- 依賴 cwd 或 shell export 會造成不同程序使用不同資料根；GUI 啟動的 agent 更不一定繼承新 shell 環境。
- 多個 host 與使用者檔案擴大覆蓋風險；不能把本次人工修改直接複製為無條件的安裝器行為。
- 單看模型存在、ingest 的 ok、doctor 的基本健康或 CLI exit 0，都不足以證明所選整合可用。

## 目標與成功界線

新流程的使用者決策是「用在哪個範圍、哪些 agent、是否要本地語意」，不是「該如何組合十多個命令」。對應成功界線由 README 的 SCN-001～014 定義：新程序設定一致、host 可發現、安全重跑、語意路由實測，以及可區分的部分失敗。

本次不將資料搬遷、背景自動化或預設 recall 模式改為 vector 擴張進來。向量庫後續增長的維護仍使用現有 skill／doctor 流程；完整改善的第一個邊界是 setup 結束時確實可用。
