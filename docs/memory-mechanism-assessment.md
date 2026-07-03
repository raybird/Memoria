# 評估：Memoria 記憶機制的優缺點

- 狀態：`assessment`（觀點紀錄，非承諾）
- 建立：2026-07-03
- 範圍：以「寫入 → 儲存 → 召回 → 治理」四階段,盤點目前記憶機制的強項與結構性弱點。
- 延伸設計：由本文的核心弱點(缺乏效用回饋)展開為 [RFC: Recall Utility Feedback Loop](RFC-utility-feedback.md)。

## 一句總評

Memoria 目前是一套**工程紀律紮實的「字面記憶基礎設施」**——存得可靠、找得可預測、忘得有規則、還能觀測。
但在「記憶的**智能**」上仍偏被動:能忠實存、按字面找、按時間忘,卻還不會**理解語意、從召回效用學習、消解矛盾**。
基礎設施約 8 分,記憶智能約 3 分;欠的不是工程債,而是**能力維度**。

## 優點

1. **分層乾淨:SQLite 是單一事實來源,markdown 是衍生視圖。**
   同時避開「純 markdown 記憶」不可查詢、與「純向量庫」不可讀/不可 diff 的兩個坑。記憶可查、可遷移、可版本控制。

2. **結構化事件模型(`DecisionMade` / `SkillLearned` / `ConversationTurn`)而非只存原始對話。**
   記憶有了語意類型,才談得上針對性召回與治理。多數 agent memory 方案止步於「把 transcript 倒進去」。

3. **`MemoriaResult<T>` envelope 帶 `evidence[]` / `confidence` / `latency_ms`。**
   每次召回都自帶證據與信心值,這是**可解釋性**,對下游 agent 做決策很關鍵。

4. **召回有 time-decay(halfLife 90 天)+ adaptive gate(`shouldSkipAdaptiveRecall`,CJK 加權)。**
   對「記憶新鮮度」與「不要用瑣碎 query 污染每個 prompt」都有正確直覺;CJK 加權 gate 顯示對真實(中文為主)場景的在意,而非跑分導向。

5. **向後相容的 migration 紀律(`initDatabase` 就地 patch、`schema_migrations` 冪等)。**
   記憶系統最致命的失敗是「升級後舊記憶讀不到」——這點守得很嚴,是長期演進的底氣。

6. **Adapter 分層讓多個 runtime 共用同一份記憶。**
   Cross-agent memory 才是真正的差異化,而非「某個 CLI 的插件」。

## 缺點 / 風險(依殺傷力排序)

1. **語意召回缺席是核心天花板。**
   現在是純字面(FTS5 trigram + LIKE fallback)。「換句話說」就召不回——同義詞、改述、**跨語言(中文問、英文存)** 全部 miss。
   Phase 0 已證實 `mcp-memory-libsql` 無 embedding,語意召回卡在 `blocked`(見 [RFC-semantic-recall.md](RFC-semantic-recall.md))。所有其他優化都撞這面牆。

2. **召回品質沒有真值回饋(no utility signal)。**
   telemetry 記了 `zeroHitRate` / `top_confidence`,但沒有「這次召回**到底有沒有幫上忙**」的訊號。`confidence` 是從 relevance 算出來的,不是從結果效用學來的——**系統無法自我改進召回**。
   這比第 1 點更長期:就算日後接了 embedding,沒有效用回饋也只是換一種盲猜。→ 本文延伸的 [RFC-utility-feedback.md](RFC-utility-feedback.md) 專治此項。

3. **`confidence` 有被過度信任的風險。**
   它現在等於字面 relevance(`bm25()` → relevance / `tokenCoverage`)。一個「字面高度重合但語意不相關」的命中會回報高 confidence,誤導下游 agent。字面系統的 confidence 天生有 calibration 問題,而 envelope 又鼓勵下游信任它。

4. **「遺忘」是粗粒度的時間裁剪。**
   prune 的 consolidate(90 天)/ stale(180 天)是純時間閾值,不看**重要性或存取頻率**。一個 180 天沒被碰、卻關鍵的架構決策,和一句閒聊面對同樣的裁剪風險。
   time-decay 只影響**排序**、不影響**保留**——缺一個 importance/access-weighted retention。

5. **無矛盾偵測。**
   記了兩個互斥的 Decision(先決定用 A、後改用 B),系統兩個都存、都可能被召回,卻沒有「B supersedes A」的關係建模。wiki 的 comparison/synthesis 是**編譯產物**,不是**召回當下**的矛盾消解。

6. **抽取依賴上游乖乖給結構。**
   `parseDecisionEvent` / `parseSkillEvent` 靠內容形狀判斷。若上游 agent 只吐自由文字,記憶就退化成 `ConversationTurn` 堆積,Decision/Skill 稀薄——**記憶品質被上游行為綁架**。

7. **衍生視圖可被手改 → 單一事實來源前提會裂。**
   markdown 是 SQLite 的衍生,但若被人手改,SQLite / markdown / FTS index 三者可能漂移。「single source of truth」在「人可編輯衍生檔」時不再成立。

8. **規模隱憂:tree recall 目前為 O(N) 掃描;`project` tag 是平字串,無記憶可見範圍/隔離模型。**
   現在不痛、量大會痛。

## 最深層的一個觀察

把上面收斂成一句:**「記憶基礎設施」(storage / governance / observability)做到 8 分,但「記憶智能」(semantic recall / utility feedback / conflict resolution / importance-based retention)還在 3 分。**
這與 backlog 對得上——語意召回被 `blocked`、retention/index 是漸進小修。工程沒欠債,欠的是能力維度。

## 建議的下一步(不被 blocked 卡住)

不急著等 embedding 解封(那受制於外部依賴),而是**先補「效用回饋」這條迴路**(對應缺點 2)。哪怕只是最粗的訊號——記錄「這次注入的記憶,下一輪對話有沒有被延續/引用」——它:

- 不需要 embedding,現在就能做;
- 能校準 `confidence`(直接改善缺點 3);
- 未來接上 embedding 時,是拿來評估「語意召回有沒有比字面好」的**唯一客觀標尺**。

沒有這條迴路,語意召回上線那天你會發現**沒辦法證明它更好**。這是投報率最高、且不被 blocked 卡住的下一步。
完整落地設計見 [RFC: Recall Utility Feedback Loop](RFC-utility-feedback.md)。
