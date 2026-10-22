# HTTP API 參考

[English](API.md) ｜ **繁體中文** · [README](../README.zh-TW.md)

最後驗證：2026-10-23，對照 v1.31.1 原始碼、CLI help 與文件檢查。

這是本地 HTTP 介面；啟動與背景服務設定見 [安裝指南](INSTALL.md)。

## 快速使用

```bash
memoria serve --port 3917
```

在另一個 terminal 檢查健康狀態並召回記憶：

```bash
curl -sf http://localhost:3917/v1/health
curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"SQLite migration","top_k":5,"project":"Memoria"}'
```

`POST /v1/remember` 接受完整 SessionData，範例見 [session.sample.json](../examples/session.sample.json)；單筆文字筆記可用 [CLI 的 remember](CLI.zh-TW.md)。

## 端點與回傳格式

啟動：`memoria serve` (port 3917，可用 `MEMORIA_PORT` 覆寫)

| Method | Path | 說明 |
|--------|------|------|
| `GET`  | `/v1/health` | 健康檢查 |
| `GET`  | `/v1/stats` | 統計 |
| `GET`  | `/v1/telemetry/recall` | Recall 路由遙測 + confidence×utility 校準（query: `window`, `limit`） |
| `GET`  | `/v1/brief` | 編譯 brief：結構化資料與已渲染 markdown（query: `project`, `days`, `top_k`）；不寫入 `BRIEF.md` |
| `POST` | `/v1/remember` | 寫入記憶 (body: SessionData; optional `scope`) |
| `POST` | `/v1/recall` | 檢索記憶 (body: `{query, top_k?, project?, scope?, mode?}`；`mode:'vector'` = 選用語意召回，需 `LIBSQL_URL` + `skills/memoria-vector`，不可用時降級字面召回) |
| `POST` | `/v1/recall/:id/outcome` | 回報召回效用 (body: `{signal, utility_score?, used?, hits?}`；UFL 寫回 + per-memory 歸因) |
| `POST` | `/v1/sources` | 匯入 markdown/text source |
| `GET`  | `/v1/sources` | 列出 raw sources |
| `POST` | `/v1/wiki/build` | 重建 compiled wiki special pages |
| `POST` | `/v1/wiki/file-query` | 將高價值 query 回寫成 wiki page |
| `POST` | `/v1/wiki/lint` | 執行 wiki governance lint |
| `GET`  | `/v1/sessions/:id/summary` | 會話摘要 |
| `POST` | `/v1/repos` | 註冊 git repository（唯讀觀察） |
| `GET`  | `/v1/repos` | 列出受觀察的 repositories |
| `GET`  | `/v1/repos/:ref/status` | Registry + 即時 git 狀態 |
| `POST` | `/v1/repos/:ref/sync` | 增量掃描（`{generate_summaries?, dry_run?, ...}`） |
| `POST` | `/v1/repos/:ref/summarize` | 摘要 branch/range/merge/tag |
| `GET`  | `/v1/repos/:ref/summaries/pending` | 等待 agent 增強的摘要請求 |
| `POST` | `/v1/repos/:ref/summaries/:summaryId` | Agent 摘要回寫 |
| `POST` | `/v1/repos/:ref/summaries/:summaryId/dismiss` | 略過一筆 pending 摘要（不自動促升；之後 `--submit` 或明確的 `--promote` 仍可讓它進 recall；已是 enriched 或已在 recall 時回 `409`） |
| `POST` | `/v1/repos/:ref/summaries/dismiss` | 依 `{types}` 批次略過 pending 摘要；已在 recall 的會跳過（`skipped_promoted`） |

所有回傳皆為 `MemoriaResult<T>` 信封格式（含 `evidence[]`、`confidence`、`latency_ms`）。

`confidence` 是 `0–1` **或 `null`**；recall 回傳另帶 `confidence_basis` 說明這個值從何而來：
`lexical_coverage`（查詢 token 在首位命中的覆蓋率）、`no_hits`（沒有任何命中，`confidence` 為 `0`）、
`unavailable`（首位命中僅來自語意索引，字面匹配品質無從衡量，`confidence` 為 `null`——意思是
「無法評估」，不是「匹配很差」）。只有 opt-in 的 vector route 會產生 `null`。
