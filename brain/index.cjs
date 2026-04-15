/**
 * ShipFast Brain — SQLite Knowledge Graph
 *
 * Replaces GSD's .planning/ markdown files with a queryable SQLite database.
 * Zero markdown ceremony. Compute context on-demand, never store what you can derive.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DB_NAME = '.shipfast/brain.db';

// ============================================================
// Database initialization
// ============================================================

function getBrainPath(cwd) {
  return path.join(cwd || process.cwd(), DB_NAME);
}

function ensureBrainDir(cwd) {
  const dir = path.join(cwd || process.cwd(), '.shipfast');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function initBrain(cwd) {
  ensureBrainDir(cwd);
  const dbPath = getBrainPath(cwd);
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  // Enable WAL mode for corruption protection (safe against interrupted writes)
  execFileSync('sqlite3', [dbPath], { input: 'PRAGMA journal_mode=WAL;\n' + schema, stdio: ['pipe', 'pipe', 'pipe'] });
  return dbPath;
}

function brainExists(cwd) {
  return fs.existsSync(getBrainPath(cwd));
}

// ============================================================
// Query helpers (all zero-LLM-cost)
// ============================================================

function query(cwd, sql) {
  const dbPath = getBrainPath(cwd);
  if (!fs.existsSync(dbPath)) return [];

  try {
    const result = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() ? JSON.parse(result) : [];
  } catch {
    return [];
  }
}

function run(cwd, sql) {
  const dbPath = getBrainPath(cwd);
  execFileSync('sqlite3', [dbPath, sql], { stdio: ['pipe', 'pipe', 'pipe'] });
}

// ============================================================
// Codebase graph operations
// ============================================================

function upsertNode(cwd, node) {
  const { id, kind, name, file_path, line_start, line_end, signature, hash, metadata } = node;
  const sql = `INSERT OR REPLACE INTO nodes (id, kind, name, file_path, line_start, line_end, signature, hash, metadata, updated_at)
    VALUES ('${esc(id)}', '${esc(kind)}', '${esc(name)}', '${esc(file_path || '')}', ${line_start || 'NULL'}, ${line_end || 'NULL'}, '${esc(signature || '')}', '${esc(hash || '')}', '${esc(JSON.stringify(metadata || {}))}', strftime('%s', 'now'))`;
  run(cwd, sql);
}

function addEdge(cwd, source, target, kind, weight = 1.0) {
  const sql = `INSERT OR REPLACE INTO edges (source, target, kind, weight) VALUES ('${esc(source)}', '${esc(target)}', '${esc(kind)}', ${weight})`;
  run(cwd, sql);
}

function getBlastRadius(cwd, filePaths, maxDepth = 3) {
  const fileList = filePaths.map(f => `'file:${esc(f)}'`).join(',');
  return query(cwd, `
    WITH RECURSIVE affected(id, depth) AS (
      SELECT id, 0 FROM nodes WHERE id IN (${fileList})
      UNION
      SELECT e.target, a.depth + 1 FROM edges e
      JOIN affected a ON e.source = a.id
      WHERE a.depth < ${maxDepth} AND e.kind IN ('imports', 'calls', 'depends')
    )
    SELECT DISTINCT n.file_path, n.name, n.signature, n.kind
    FROM nodes n JOIN affected a ON n.id = a.id
    WHERE n.signature IS NOT NULL AND n.signature != ''
    ORDER BY a.depth ASC
    LIMIT 30
  `);
}

function getSignaturesForFile(cwd, filePath) {
  return query(cwd, `
    SELECT name, kind, signature, line_start, line_end
    FROM nodes WHERE file_path = '${esc(filePath)}'
    AND kind IN ('function', 'class', 'type', 'component', 'export')
    ORDER BY line_start
  `);
}

function getStaleNodes(cwd) {
  return query(cwd, `SELECT id, file_path, hash FROM nodes WHERE kind = 'file'`);
}

// ============================================================
// Context operations (replaces STATE.md / REQUIREMENTS.md)
// ============================================================

function setContext(cwd, scope, key, value) {
  const val = typeof value === 'string' ? value : JSON.stringify(value);
  run(cwd, `INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at)
    VALUES ('${esc(scope)}:${esc(key)}', '${esc(scope)}', '${esc(key)}', '${esc(val)}',
    COALESCE((SELECT version FROM context WHERE id = '${esc(scope)}:${esc(key)}'), 0) + 1,
    strftime('%s', 'now'))`);
}

function getContext(cwd, scope, key) {
  const rows = query(cwd, `SELECT value FROM context WHERE scope = '${esc(scope)}' AND key = '${esc(key)}'`);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
}

function getAllContext(cwd, scope) {
  return query(cwd, `SELECT key, value FROM context WHERE scope = '${esc(scope)}'`);
}

// ============================================================
// Decision operations
// ============================================================

function addDecision(cwd, { question, decision, reasoning, phase, tags }) {
  run(cwd, `INSERT INTO decisions (question, decision, reasoning, phase, tags)
    VALUES ('${esc(question)}', '${esc(decision)}', '${esc(reasoning || '')}', '${esc(phase || '')}', '${esc(tags || '')}')`);
}

function getDecisions(cwd, phase) {
  const where = phase ? `WHERE phase = '${esc(phase)}'` : '';
  return query(cwd, `SELECT question, decision, reasoning, phase FROM decisions ${where} ORDER BY created_at DESC LIMIT 20`);
}

// ============================================================
// Task operations
// ============================================================

function addTask(cwd, task) {
  const { id, phase, description, plan_text } = task;
  run(cwd, `INSERT OR REPLACE INTO tasks (id, phase, description, plan_text, status)
    VALUES ('${esc(id)}', '${esc(phase || '')}', '${esc(description)}', '${esc(plan_text || '')}', 'pending')`);
}

function updateTask(cwd, id, updates) {
  const sets = Object.entries(updates)
    .map(([k, v]) => `${k} = '${esc(String(v))}'`)
    .join(', ');
  run(cwd, `UPDATE tasks SET ${sets} WHERE id = '${esc(id)}'`);
}

function getTasks(cwd, phase) {
  const where = phase ? `WHERE phase = '${esc(phase)}'` : '';
  return query(cwd, `SELECT * FROM tasks ${where} ORDER BY created_at`);
}

// ============================================================
// Learnings (self-improving memory)
// ============================================================

function addLearning(cwd, { pattern, problem, solution, domain, source }) {
  run(cwd, `INSERT INTO learnings (pattern, problem, solution, domain, source)
    VALUES ('${esc(pattern)}', '${esc(problem)}', '${esc(solution || '')}', '${esc(domain || '')}', '${esc(source || 'auto')}')`);
}

function findLearnings(cwd, domain, limit = 5) {
  return query(cwd, `SELECT id, pattern, problem, solution, confidence FROM learnings
    WHERE domain = '${esc(domain)}' AND confidence > 0.3
    ORDER BY confidence * (times_used + 1) DESC LIMIT ${limit}`);
}

function boostLearning(cwd, id) {
  run(cwd, `UPDATE learnings SET confidence = MIN(confidence + 0.1, 1.0), times_used = times_used + 1, last_used = strftime('%s', 'now') WHERE id = ${parseInt(id)}`);
}

function pruneOldLearnings(cwd, daysOld = 30) {
  run(cwd, `DELETE FROM learnings WHERE confidence < 0.3 AND times_used = 0 AND created_at < strftime('%s', 'now') - ${daysOld * 86400}`);
}

// ============================================================
// Checkpoints
// ============================================================

function createCheckpoint(cwd, id, description) {
  let gitRef = '';
  try {
    gitRef = execFileSync('git', ['stash', 'create'], { cwd, encoding: 'utf8' }).trim();
  } catch { /* no changes to stash */ }

  run(cwd, `INSERT OR REPLACE INTO checkpoints (id, git_ref, description)
    VALUES ('${esc(id)}', '${esc(gitRef)}', '${esc(description || '')}')`);
  return gitRef;
}

function rollbackCheckpoint(cwd, id) {
  const rows = query(cwd, `SELECT git_ref FROM checkpoints WHERE id = '${esc(id)}'`);
  if (rows.length && rows[0].git_ref) {
    try {
      execFileSync('git', ['stash', 'apply', rows[0].git_ref], { cwd, stdio: 'pipe' });
    } catch { /* may conflict */ }
  }
  run(cwd, `DELETE FROM checkpoints WHERE id = '${esc(id)}'`);
}

// ============================================================
// Token budget
// ============================================================

function getTokenBudget(cwd) {
  const rows = query(cwd, `SELECT value FROM config WHERE key = 'token_budget'`);
  return rows.length ? parseInt(rows[0].value) : 100000;
}

function getTokensUsed(cwd, sessionId) {
  const rows = query(cwd, `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM token_usage WHERE session_id = '${esc(sessionId)}'`);
  return rows.length ? rows[0].total : 0;
}

function recordTokenUsage(cwd, { sessionId, agent, taskId, inputTokens, outputTokens, model }) {
  run(cwd, `INSERT INTO token_usage (session_id, agent, task_id, input_tokens, output_tokens, model)
    VALUES ('${esc(sessionId)}', '${esc(agent)}', '${esc(taskId || '')}', ${parseInt(inputTokens) || 0}, ${parseInt(outputTokens) || 0}, '${esc(model || '')}')`);
}

function getTokensByAgent(cwd, sessionId) {
  return query(cwd, `SELECT agent, SUM(input_tokens + output_tokens) as total FROM token_usage WHERE session_id = '${esc(sessionId)}' GROUP BY agent`);
}

// ============================================================
// Hot files (git-derived)
// ============================================================

function updateHotFiles(cwd, limit = 100) {
  try {
    const log = execFileSync('git', ['log', '--name-only', '--pretty=', `-${limit}`], { cwd, encoding: 'utf8' });
    const counts = {};
    log.split('\n').filter(Boolean).forEach(f => { counts[f] = (counts[f] || 0) + 1; });

    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .forEach(([fp, count]) => {
        run(cwd, `INSERT OR REPLACE INTO hot_files (file_path, change_count, last_changed) VALUES ('${esc(fp)}', ${count}, strftime('%s', 'now'))`);
      });
  } catch { /* not a git repo */ }
}

function getHotFiles(cwd, limit = 20) {
  return query(cwd, `SELECT file_path, change_count FROM hot_files ORDER BY change_count DESC LIMIT ${limit}`);
}

// ============================================================
// Config
// ============================================================

function getConfig(cwd, key) {
  const rows = query(cwd, `SELECT value FROM config WHERE key = '${esc(key)}'`);
  return rows.length ? rows[0].value : null;
}

function setConfig(cwd, key, value) {
  run(cwd, `INSERT OR REPLACE INTO config (key, value) VALUES ('${esc(key)}', '${esc(String(value))}')`);
}

// ============================================================
// Context builder for agents (the key token-saving function)
// ============================================================

function buildAgentContext(cwd, { agent, taskDescription, affectedFiles, phase, domain }) {
  const parts = [];

  // 1. Relevant decisions (compact — ~40 tokens each)
  const decisions = phase ? getDecisions(cwd, phase) : getDecisions(cwd);
  if (decisions.length) {
    parts.push('<decisions>\n' + decisions.slice(0, 5).map(d => `Q: ${d.question} -> ${d.decision}`).join('\n') + '\n</decisions>');
  }

  // 2. Blast radius signatures (not full files — ~20 tokens each)
  if (affectedFiles && affectedFiles.length) {
    const blast = getBlastRadius(cwd, affectedFiles);
    if (blast.length) {
      parts.push('<related_code>\n' + blast.map(n => `${n.file_path}:${n.name} -- ${n.signature}`).join('\n') + '\n</related_code>');
    }
  }

  // 3. Relevant learnings (avoid past mistakes)
  if (domain) {
    const learnings = findLearnings(cwd, domain);
    if (learnings.length) {
      parts.push('<learnings>\n' + learnings.map(l => `Warning ${l.pattern}: ${l.solution || l.problem}`).join('\n') + '\n</learnings>');
    }
  }

  // 4. Project context (requirements, conventions)
  const conventions = getContext(cwd, 'project', 'conventions');
  if (conventions) {
    parts.push(`<conventions>\n${typeof conventions === 'string' ? conventions : JSON.stringify(conventions)}\n</conventions>`);
  }

  // 5. Token budget awareness
  const sessionId = process.env.SF_SESSION_ID || 'default';
  const budget = getTokenBudget(cwd);
  const used = getTokensUsed(cwd, sessionId);
  const remaining = budget - used;
  parts.push(`<budget>Tokens: ${used}/${budget} used (${remaining} remaining)</budget>`);

  return parts.join('\n\n');
}

// ============================================================
// Utils
// ============================================================

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/'/g, "''");
}

module.exports = {
  getBrainPath,
  initBrain,
  brainExists,
  query,
  run,
  upsertNode,
  addEdge,
  getBlastRadius,
  getSignaturesForFile,
  getStaleNodes,
  setContext,
  getContext,
  getAllContext,
  addDecision,
  getDecisions,
  addTask,
  updateTask,
  getTasks,
  addLearning,
  findLearnings,
  boostLearning,
  pruneOldLearnings,
  createCheckpoint,
  rollbackCheckpoint,
  getTokenBudget,
  getTokensUsed,
  recordTokenUsage,
  getTokensByAgent,
  updateHotFiles,
  getHotFiles,
  getConfig,
  setConfig,
  buildAgentContext,
  esc,
  // Requirements
  addRequirement,
  getRequirements,
  updateRequirement,
  getRequirementCoverage
};

// ============================================================
// Requirements (REQ-ID tracing)
// ============================================================

function addRequirement(cwd, { id, category, description, priority, phase }) {
  run(cwd, `INSERT OR REPLACE INTO requirements (id, category, description, priority, phase)
    VALUES ('${esc(id)}', '${esc(category)}', '${esc(description)}', '${esc(priority || 'v1')}', '${esc(phase || '')}')`);
}

function getRequirements(cwd, opts = {}) {
  const conditions = [];
  if (opts.phase) conditions.push(`phase = '${esc(opts.phase)}'`);
  if (opts.category) conditions.push(`category = '${esc(opts.category)}'`);
  if (opts.status) conditions.push(`status = '${esc(opts.status)}'`);
  if (opts.priority) conditions.push(`priority = '${esc(opts.priority)}'`);
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return query(cwd, `SELECT * FROM requirements ${where} ORDER BY category, id`);
}

function updateRequirement(cwd, id, updates) {
  const sets = Object.entries(updates).map(([k, v]) => `${k} = '${esc(String(v))}'`).join(', ');
  run(cwd, `UPDATE requirements SET ${sets} WHERE id = '${esc(id)}'`);
}

function getRequirementCoverage(cwd) {
  const total = query(cwd, "SELECT COUNT(*) as c FROM requirements WHERE priority = 'v1'");
  const mapped = query(cwd, "SELECT COUNT(*) as c FROM requirements WHERE priority = 'v1' AND phase IS NOT NULL AND phase != ''");
  const done = query(cwd, "SELECT COUNT(*) as c FROM requirements WHERE priority = 'v1' AND status = 'done'");
  const verified = query(cwd, "SELECT COUNT(*) as c FROM requirements WHERE priority = 'v1' AND verified = 1");
  return {
    total: total[0] ? total[0].c : 0,
    mapped: mapped[0] ? mapped[0].c : 0,
    done: done[0] ? done[0].c : 0,
    verified: verified[0] ? verified[0].c : 0
  };
}
