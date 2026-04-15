-- ShipFast Brain Schema v1
-- Single SQLite database replaces all .planning/ markdown files

-- ============================================================
-- CODEBASE GRAPH (auto-indexed via AST parsing)
-- ============================================================

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,       -- 'file:src/auth.ts', 'fn:validateToken', 'type:User'
  kind        TEXT NOT NULL,          -- file | function | type | component | route | class | variable | export
  name        TEXT NOT NULL,          -- human-readable name
  file_path   TEXT,                   -- relative file path
  line_start  INTEGER,
  line_end    INTEGER,
  signature   TEXT,                   -- function signature / type definition (compact)
  hash        TEXT,                   -- content hash for staleness detection
  metadata    TEXT,                   -- JSON blob for extras (params, return type, etc.)
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

CREATE TABLE IF NOT EXISTS edges (
  source  TEXT NOT NULL,
  target  TEXT NOT NULL,
  kind    TEXT NOT NULL,               -- imports | calls | implements | depends | mutates | exports | extends
  weight  REAL DEFAULT 1.0,
  PRIMARY KEY (source, target, kind),
  FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);

-- ============================================================
-- CONTEXT (compressed, scoped — replaces STATE.md, REQUIREMENTS.md, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS context (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,           -- 'project' | 'milestone' | 'phase' | 'task'
  key         TEXT NOT NULL,           -- 'requirements' | 'decisions' | 'blockers' | 'tech_stack' | 'conventions'
  value       TEXT NOT NULL,           -- JSON, each entry kept under 500 tokens
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(scope, key)
);

CREATE INDEX IF NOT EXISTS idx_context_scope ON context(scope);

-- ============================================================
-- DECISIONS (replaces decision sections in STATE.md)
-- ============================================================

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,            -- "Which auth library?"
  decision    TEXT NOT NULL,            -- "jose — Edge+Node support, good TS types"
  reasoning   TEXT,                     -- compact, 1-2 sentences max
  phase       TEXT,                     -- which phase this relates to
  tags        TEXT,                     -- comma-separated tags for search
  reversible  INTEGER DEFAULT 1,       -- 0 = irreversible (DB migrations, etc.)
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_decisions_phase ON decisions(phase);

-- ============================================================
-- TASKS (replaces PLAN.md files + VERIFICATION.md)
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,         -- uuid or phase:task_num
  phase       TEXT,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | running | passed | failed | skipped | rolled_back
  plan_text   TEXT,                     -- the plan/instructions for this task (compact)
  commit_sha  TEXT,                     -- git commit after success
  error       TEXT,                     -- error message if failed
  tokens_used INTEGER DEFAULT 0,       -- track per-task token cost
  duration_ms INTEGER DEFAULT 0,
  attempts    INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  started_at  INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ============================================================
-- LEARNINGS (self-improving — gets smarter over time)
-- ============================================================

CREATE TABLE IF NOT EXISTS learnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,            -- "react-19-ref-callback", "prisma-migration-order"
  problem     TEXT NOT NULL,            -- what went wrong
  solution    TEXT,                     -- what fixed it (null if unsolved)
  domain      TEXT,                     -- "auth", "database", "ui", etc.
  confidence  REAL DEFAULT 0.5,        -- 0.0-1.0, increases each time it helps
  times_used  INTEGER DEFAULT 0,
  source      TEXT,                     -- 'auto' | 'user' | 'failure_recovery'
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_used   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_learnings_pattern ON learnings(pattern);
CREATE INDEX IF NOT EXISTS idx_learnings_domain ON learnings(domain);
CREATE INDEX IF NOT EXISTS idx_learnings_confidence ON learnings(confidence);

-- ============================================================
-- CHECKPOINTS (snapshot/rollback support)
-- ============================================================

CREATE TABLE IF NOT EXISTS checkpoints (
  id          TEXT PRIMARY KEY,         -- task_id or manual label
  git_ref     TEXT,                     -- git stash ref or commit sha
  brain_state TEXT,                     -- JSON snapshot of relevant brain state
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- ============================================================
-- TOKEN BUDGET (track spending per session/agent)
-- ============================================================

CREATE TABLE IF NOT EXISTS token_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  agent       TEXT NOT NULL,            -- scout | architect | builder | critic | scribe
  task_id     TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  model       TEXT,                     -- which model tier was used
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tokens_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_tokens_agent ON token_usage(agent);

-- ============================================================
-- HOT FILES (git-derived, auto-updated)
-- ============================================================

CREATE TABLE IF NOT EXISTS hot_files (
  file_path    TEXT PRIMARY KEY,
  change_count INTEGER DEFAULT 1,      -- how many times changed in recent history
  last_changed INTEGER
);

-- ============================================================
-- CONFIG (replaces config.json in .planning/)
-- ============================================================

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default config
INSERT OR IGNORE INTO config (key, value) VALUES
  ('token_budget', '100000'),
  ('model_tier_scout', 'haiku'),
  ('model_tier_architect', 'sonnet'),
  ('model_tier_builder', 'sonnet'),
  ('model_tier_critic', 'haiku'),
  ('model_tier_scribe', 'haiku'),
  ('auto_checkpoint', 'true'),
  ('auto_learn', 'true'),
  ('context_warning_pct', '35'),
  ('context_critical_pct', '25');

-- ============================================================
-- REQUIREMENTS (REQ-ID tracing for multi-phase projects)
-- ============================================================

CREATE TABLE IF NOT EXISTS requirements (
  id          TEXT PRIMARY KEY,         -- REQ-ID: AUTH-01, PAY-03, UI-12
  category    TEXT NOT NULL,            -- auth, payment, ui, data, api, etc.
  description TEXT NOT NULL,
  priority    TEXT DEFAULT 'v1',        -- v1 | v2 | out_of_scope
  phase       TEXT,                     -- which phase this maps to
  status      TEXT DEFAULT 'pending',   -- pending | in_progress | done | deferred
  verified    INTEGER DEFAULT 0,        -- 0 = not verified, 1 = verified
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_req_category ON requirements(category);
CREATE INDEX IF NOT EXISTS idx_req_phase ON requirements(phase);
CREATE INDEX IF NOT EXISTS idx_req_status ON requirements(status);

-- ============================================================
-- MIGRATIONS TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS _migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO _migrations (version, name) VALUES (1, 'initial_schema');
