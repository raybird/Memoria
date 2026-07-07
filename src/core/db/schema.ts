import Database from 'better-sqlite3'

type Migration = {
    id: number
    name: string
    up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
    {
        id: 1,
        name: 'sessions_add_scope',
        up: (db) => {
            const cols = new Set((db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((r) => r.name))
            if (!cols.has('scope')) {
                db.exec(`ALTER TABLE sessions ADD COLUMN scope TEXT`)
                db.exec(`UPDATE sessions SET scope = CASE WHEN project IS NOT NULL AND TRIM(project) <> '' THEN 'project:' || project ELSE 'global' END WHERE scope IS NULL OR TRIM(scope) = ''`)
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_scope_timestamp ON sessions(scope, timestamp)`)
        }
    },
    {
        id: 2,
        name: 'memory_nodes_add_scope',
        up: (db) => {
            const cols = new Set((db.prepare('PRAGMA table_info(memory_nodes)').all() as { name: string }[]).map((r) => r.name))
            if (!cols.has('scope')) {
                db.exec(`ALTER TABLE memory_nodes ADD COLUMN scope TEXT`)
                db.exec(`UPDATE memory_nodes SET scope = CASE WHEN project IS NOT NULL AND TRIM(project) <> '' THEN 'project:' || project ELSE 'global' END WHERE scope IS NULL OR TRIM(scope) = ''`)
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope_level ON memory_nodes(scope, level)`)
        }
    },
    {
        id: 3,
        name: 'wiki_lint_findings_add_run_id',
        up: (db) => {
            const cols = new Set((db.prepare('PRAGMA table_info(wiki_lint_findings)').all() as { name: string }[]).map((r) => r.name))
            if (!cols.has('run_id')) {
                db.exec(`ALTER TABLE wiki_lint_findings ADD COLUMN run_id TEXT`)
            }
        }
    },
    {
        id: 4,
        name: 'recall_fts5_index',
        up: (db) => {
            // Full-text index over the keyword-recall corpus (session summaries + Decision/Skill
            // events). Uses the trigram tokenizer for mixed English/CJK substring matching; bm25()
            // ranks hits. recallKeyword falls back to LIKE for sub-trigram (1-2 char) queries and
            // when FTS returns nothing, so short/CJK terms never regress. Triggers keep the index
            // in sync so TS write paths stay untouched.
            db.exec(`
              CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(
                kind UNINDEXED,
                ref_id UNINDEXED,
                session_id UNINDEXED,
                body,
                tokenize='trigram'
              );

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_sessions_ai
              AFTER INSERT ON sessions BEGIN
                INSERT INTO recall_fts(kind, ref_id, session_id, body)
                VALUES ('session', new.id, new.id, COALESCE(new.summary, '') || ' ' || COALESCE(new.project, ''));
              END;

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_sessions_au
              AFTER UPDATE ON sessions BEGIN
                DELETE FROM recall_fts WHERE kind = 'session' AND ref_id = old.id;
                INSERT INTO recall_fts(kind, ref_id, session_id, body)
                VALUES ('session', new.id, new.id, COALESCE(new.summary, '') || ' ' || COALESCE(new.project, ''));
              END;

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_sessions_ad
              AFTER DELETE ON sessions BEGIN
                DELETE FROM recall_fts WHERE kind = 'session' AND ref_id = old.id;
              END;

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_events_ai
              AFTER INSERT ON events WHEN new.event_type IN ('DecisionMade', 'SkillLearned') BEGIN
                INSERT INTO recall_fts(kind, ref_id, session_id, body)
                VALUES (
                  CASE new.event_type WHEN 'DecisionMade' THEN 'decision' ELSE 'skill' END,
                  new.id, new.session_id, COALESCE(new.content, '')
                );
              END;

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_events_au
              AFTER UPDATE ON events BEGIN
                DELETE FROM recall_fts WHERE kind IN ('decision', 'skill') AND ref_id = old.id;
                INSERT INTO recall_fts(kind, ref_id, session_id, body)
                SELECT CASE event_type WHEN 'DecisionMade' THEN 'decision' ELSE 'skill' END,
                       id, session_id, COALESCE(content, '')
                FROM events
                WHERE id = new.id AND event_type IN ('DecisionMade', 'SkillLearned');
              END;

              CREATE TRIGGER IF NOT EXISTS trg_recall_fts_events_ad
              AFTER DELETE ON events BEGIN
                DELETE FROM recall_fts WHERE kind IN ('decision', 'skill') AND ref_id = old.id;
              END;
            `)

            // Backfill existing rows once. Empty on a fresh DB; triggers maintain it afterwards.
            db.exec(`
              INSERT INTO recall_fts(kind, ref_id, session_id, body)
              SELECT 'session', id, id, COALESCE(summary, '') || ' ' || COALESCE(project, '')
              FROM sessions;

              INSERT INTO recall_fts(kind, ref_id, session_id, body)
              SELECT CASE event_type WHEN 'DecisionMade' THEN 'decision' ELSE 'skill' END,
                     id, session_id, COALESCE(content, '')
              FROM events
              WHERE event_type IN ('DecisionMade', 'SkillLearned');
            `)
        }
    },
    {
        id: 5,
        name: 'recall_telemetry_add_query_metrics',
        up: (db) => {
            // Enrich recall telemetry with per-query observability: a privacy-preserving query hash,
            // query token count, and the calibrated top confidence. Enables zero-hit-rate and
            // recall-quality metrics without storing raw query text.
            const cols = new Set((db.prepare('PRAGMA table_info(recall_telemetry)').all() as { name: string }[]).map((r) => r.name))
            if (!cols.has('query_hash')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN query_hash TEXT`)
            if (!cols.has('token_count')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN token_count INTEGER`)
            if (!cols.has('top_confidence')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN top_confidence REAL`)
        }
    },
    {
        id: 6,
        name: 'recall_telemetry_add_utility',
        up: (db) => {
            // Utility feedback loop (docs/RFC-utility-feedback.md): store the observed lexical-reuse
            // utility of a recall, its signal source, and when it was written back. Enables confidence
            // calibration without storing raw turn text.
            const cols = new Set((db.prepare('PRAGMA table_info(recall_telemetry)').all() as { name: string }[]).map((r) => r.name))
            if (!cols.has('utility_score')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN utility_score REAL`)
            if (!cols.has('outcome_kind')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN outcome_kind TEXT`)
            if (!cols.has('observed_at')) db.exec(`ALTER TABLE recall_telemetry ADD COLUMN observed_at DATETIME`)
        }
    },
    {
        id: 7,
        name: 'memory_utility_per_ref',
        up: (db) => {
            // UFL Phase 3 (docs/RFC-utility-feedback.md §10): per-memory utility accumulation. Each
            // recall outcome attributes an observed utility to the individual hits it surfaced; this
            // table aggregates them per ref_id (the RecallHit.id: a session or event id). recall
            // ranking down-weights persistently-low-utility memories; prune retention spares
            // high-utility ones. Empty until outcomes with per-hit attribution arrive, so ranking and
            // prune stay byte-identical to pre-Phase-3 behaviour on any DB with no observations.
            db.exec(`
              CREATE TABLE IF NOT EXISTS memory_utility (
                ref_id TEXT PRIMARY KEY,
                observations INTEGER NOT NULL DEFAULT 0,
                utility_sum REAL NOT NULL DEFAULT 0,
                last_outcome_at DATETIME
              );
            `)
        }
    }
]

function runMigrations(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    const applied = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id))
    const insertStmt = db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)')
    for (const migration of MIGRATIONS) {
        if (applied.has(migration.id)) continue
        db.transaction(() => {
            migration.up(db)
            insertStmt.run(migration.id, migration.name)
        })()
    }
}

export function initDatabase(dbPath: string): void {
    const db = new Database(dbPath)
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        timestamp DATETIME,
        project TEXT,
        scope TEXT,
        event_count INTEGER,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp DATETIME,
        event_type TEXT,
        content TEXT,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        created_date DATETIME,
        success_rate REAL,
        use_count INTEGER,
        filepath TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        project TEXT,
        scope TEXT,
        title TEXT,
        summary TEXT,
        level INTEGER,
        path_key TEXT,
        created_at DATETIME,
        updated_at DATETIME,
        last_synced_at DATETIME,
        FOREIGN KEY (parent_id) REFERENCES memory_nodes(id)
      );

      CREATE TABLE IF NOT EXISTS memory_node_sources (
        node_id TEXT,
        session_id TEXT,
        created_at DATETIME,
        PRIMARY KEY (node_id, session_id),
        FOREIGN KEY (node_id) REFERENCES memory_nodes(id),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS memory_sync_state (
        target TEXT PRIMARY KEY,
        cursor_updated_at DATETIME,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS recall_telemetry (
        id TEXT PRIMARY KEY,
        route_mode TEXT,
        fallback_used INTEGER,
        hit_count INTEGER,
        latency_ms INTEGER,
        created_at DATETIME,
        query_hash TEXT,
        token_count INTEGER,
        top_confidence REAL,
        utility_score REAL,
        outcome_kind TEXT,
        observed_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS memory_utility (
        ref_id TEXT PRIMARY KEY,
        observations INTEGER NOT NULL DEFAULT 0,
        utility_sum REAL NOT NULL DEFAULT 0,
        last_outcome_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        type TEXT,
        scope TEXT,
        title TEXT,
        origin_path TEXT,
        origin_url TEXT,
        checksum TEXT,
        created_at DATETIME,
        imported_at DATETIME,
        status TEXT,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT,
        page_type TEXT,
        scope TEXT,
        summary TEXT,
        filepath TEXT,
        status TEXT,
        confidence REAL,
        last_built_at DATETIME,
        last_reviewed_at DATETIME,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS wiki_page_sources (
        page_id TEXT,
        source_id TEXT,
        relation_type TEXT,
        created_at DATETIME,
        PRIMARY KEY (page_id, source_id),
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (source_id) REFERENCES sources(id)
      );

      CREATE TABLE IF NOT EXISTS wiki_page_links (
        from_page_id TEXT,
        to_page_id TEXT,
        link_type TEXT,
        created_at DATETIME,
        PRIMARY KEY (from_page_id, to_page_id),
        FOREIGN KEY (from_page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (to_page_id) REFERENCES wiki_pages(id)
      );

      CREATE TABLE IF NOT EXISTS wiki_lint_runs (
        id TEXT PRIMARY KEY,
        status TEXT,
        summary TEXT,
        created_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS wiki_lint_findings (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        finding_type TEXT,
        severity TEXT,
        page_id TEXT,
        related_page_id TEXT,
        source_id TEXT,
        status TEXT,
        summary TEXT,
        details TEXT,
        created_at DATETIME,
        resolved_at DATETIME,
        FOREIGN KEY (run_id) REFERENCES wiki_lint_runs(id),
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (related_page_id) REFERENCES wiki_pages(id),
        FOREIGN KEY (source_id) REFERENCES sources(id)
      );

      CREATE TABLE IF NOT EXISTS wiki_query_artifacts (
        id TEXT PRIMARY KEY,
        query TEXT,
        kind TEXT,
        page_id TEXT,
        created_at DATETIME,
        metadata TEXT,
        FOREIGN KEY (page_id) REFERENCES wiki_pages(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_timestamp
      ON sessions(timestamp);

      CREATE INDEX IF NOT EXISTS idx_sessions_project_timestamp
      ON sessions(project, timestamp);

      CREATE INDEX IF NOT EXISTS idx_events_event_type
      ON events(event_type);

      CREATE INDEX IF NOT EXISTS idx_events_session_event_time
      ON events(session_id, event_type, timestamp);

      CREATE INDEX IF NOT EXISTS idx_skills_category_created
      ON skills(category, created_date);

      CREATE INDEX IF NOT EXISTS idx_memory_nodes_parent
      ON memory_nodes(parent_id);

      CREATE INDEX IF NOT EXISTS idx_memory_nodes_project_level
      ON memory_nodes(project, level);

      CREATE INDEX IF NOT EXISTS idx_memory_nodes_updated
      ON memory_nodes(updated_at);

      CREATE INDEX IF NOT EXISTS idx_memory_node_sources_session
      ON memory_node_sources(session_id);

      CREATE INDEX IF NOT EXISTS idx_recall_telemetry_created
      ON recall_telemetry(created_at);

      CREATE INDEX IF NOT EXISTS idx_recall_telemetry_route
      ON recall_telemetry(route_mode, created_at);

      CREATE INDEX IF NOT EXISTS idx_sources_type_imported_at
      ON sources(type, imported_at);

      CREATE INDEX IF NOT EXISTS idx_sources_scope_imported_at
      ON sources(scope, imported_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_pages_page_type_scope
      ON wiki_pages(page_type, scope);

      CREATE INDEX IF NOT EXISTS idx_wiki_pages_status
      ON wiki_pages(status, last_built_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_page_sources_source_id
      ON wiki_page_sources(source_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_page_links_from
      ON wiki_page_links(from_page_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_lint_findings_status_severity_created
      ON wiki_lint_findings(status, severity, created_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_lint_findings_run
      ON wiki_lint_findings(run_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_wiki_query_artifacts_kind_created
      ON wiki_query_artifacts(kind, created_at);
    `)

        runMigrations(db)
    } finally {
        db.close()
    }
}
