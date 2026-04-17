#!/usr/bin/env node

/**
 * ShipFast MCP Server — stdio transport
 *
 * Exposes brain.db as structured MCP tools.
 * Works with: Claude Code, Cursor, Windsurf, Codex, OpenCode, Gemini, etc.
 *
 * Tools:
 *   brain_stats       — node/edge/decision/learning counts
 *   brain_search      — search files/functions by name
 *   brain_files       — list indexed files
 *   brain_decisions   — list or add decisions
 *   brain_learnings   — list or add learnings
 *   brain_hot_files   — show most changed files
 *   brain_status      — full status summary
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync: safeExec } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const CWD = process.env.SHIPFAST_CWD || process.cwd();
const DB_PATH = path.join(CWD, '.shipfast', 'brain.db');

// ============================================================
// SQLite query helper
// ============================================================

function query(sql) {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    const result = safeExec('sqlite3', ['-json', DB_PATH, sql], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() ? JSON.parse(result) : [];
  } catch { return []; }
}

function run(sql) {
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    safeExec('sqlite3', [DB_PATH, sql], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch { return false; }
}

// Query linked repos (cross-repo search)
function getLinkedPaths() {
  try {
    const rows = query("SELECT value FROM config WHERE key = 'linked_repos'");
    if (rows.length && rows[0].value) return JSON.parse(rows[0].value);
  } catch {}
  return [];
}

async function queryLinked(sql) {
  const local = query(sql);
  const linked = getLinkedPaths();
  const dbs = linked
    .map(p => ({ db: path.join(p, '.shipfast', 'brain.db'), name: path.basename(p) }))
    .filter(x => fs.existsSync(x.db));
  if (!dbs.length) return local;

  const runs = dbs.map(({ db, name }) =>
    execFileAsync('sqlite3', ['-json', db, sql], { encoding: 'utf8' })
      .then(({ stdout }) => {
        const trimmed = (stdout || '').trim();
        if (!trimmed) return [];
        let parsed;
        try { parsed = JSON.parse(trimmed); }
        catch { return []; }
        parsed.forEach(row => { row._repo = name; });
        return parsed;
      })
      .catch(() => [])
  );

  const linkedResults = await Promise.all(runs);
  return [...local, ...linkedResults.flat()];
}

// Keep in sync with brain/index.cjs — MCP server runs as separate process
function esc(s) {
  return s == null ? '' : String(s).replace(/'/g, "''");
}

function escLike(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

// Citation verification (used by brain_findings.list_fresh)
// A citation is valid if the cited line range in the file still hashes to
// the stored hash. File not found OR hash mismatch → invalid.
const crypto = require('crypto');
function verifyCitation(c) {
  if (!c || !c.file || c.hash == null) return false;
  const abs = path.isAbsolute(c.file) ? c.file : path.join(CWD, c.file);
  if (!fs.existsSync(abs)) return false;
  let content;
  try { content = fs.readFileSync(abs, 'utf8'); } catch { return false; }
  const lines = content.split('\n');
  const start = Math.max(1, parseInt(c.line_start) || 1);
  const end = Math.min(lines.length, parseInt(c.line_end) || lines.length);
  if (start > lines.length) return false;
  const slice = lines.slice(start - 1, end).join('\n');
  const actual = crypto.createHash('sha256').update(slice).digest('hex').slice(0, 16);
  return actual === String(c.hash);
}

function validateSafeString(s, { maxLen = 200, field = 'input', allowEmpty = true } = {}) {
  if (s == null) {
    if (allowEmpty) return '';
    throw new Error(`${field} is required`);
  }
  if (typeof s !== 'string') throw new Error(`${field} must be a string, got ${typeof s}`);
  if (s.indexOf('\0') !== -1) throw new Error(`${field} contains NUL byte`);
  if (s.length > maxLen) throw new Error(`${field} exceeds max length ${maxLen}`);
  return s;
}

// Resolve a user-supplied file reference to exact node file_path(s).
// Accepts a full relative path OR just a basename; returns an array of
// candidates (empty if none, one if exact, multiple if ambiguous).
function resolveFilePath(input) {
  const s = validateSafeString(input, { field: 'file', maxLen: 400 });
  if (!s) return [];
  // If it looks like a full path, try exact match first.
  if (s.includes('/')) {
    const hit = query(`SELECT file_path FROM nodes WHERE kind = 'file' AND file_path = '${esc(s)}' LIMIT 1`);
    if (hit.length) return [hit[0].file_path];
    // Fall through — try basename match
  }
  // Basename or non-exact — match exact path, or a suffix like '/name'
  const like = escLike(s);
  const rows = query(
    `SELECT file_path FROM nodes WHERE kind = 'file' ` +
    `AND (file_path = '${esc(s)}' OR file_path LIKE '%/${like}' ESCAPE '\\') LIMIT 5`
  );
  return rows.map(r => r.file_path);
}

// ============================================================
// Tool implementations
// ============================================================

const TOOLS = {
  brain_stats: {
    description: 'Get brain.db statistics: node count, edge count, decisions, learnings, hot files, tasks.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      if (!fs.existsSync(DB_PATH)) return { error: 'brain.db not found. Run: shipfast init' };
      const rows = query(
        "SELECT 'nodes' as metric, COUNT(*) as count FROM nodes " +
        "UNION ALL SELECT 'edges', COUNT(*) FROM edges " +
        "UNION ALL SELECT 'decisions', COUNT(*) FROM decisions " +
        "UNION ALL SELECT 'learnings', COUNT(*) FROM learnings " +
        "UNION ALL SELECT 'tasks', COUNT(*) FROM tasks " +
        "UNION ALL SELECT 'checkpoints', COUNT(*) FROM checkpoints " +
        "UNION ALL SELECT 'hot_files', COUNT(*) FROM hot_files " +
        "UNION ALL SELECT 'seeds', COUNT(*) FROM seeds WHERE status = 'open'"
      );
      const stats = {};
      rows.forEach(r => stats[r.metric] = r.count);
      return stats;
    }
  },

  brain_linked: {
    description: 'Show linked repos and their brain.db status. Use shipfast link to connect repos for cross-repo search.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      const linked = getLinkedPaths();
      if (!linked.length) return { linked: [], message: 'No repos linked. Use: shipfast link ../other-repo' };
      return {
        linked: linked.map(p => ({
          path: p,
          name: path.basename(p),
          hasBrain: fs.existsSync(path.join(p, '.shipfast', 'brain.db'))
        }))
      };
    }
  },

  brain_search: {
    description: 'Search the codebase knowledge graph for files, functions, types, or classes by name. Searches local + all linked repos.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (file name, function name, type name)' },
        kind: { type: 'string', description: 'Filter by kind: file, function, type, class. Optional.', enum: ['file', 'function', 'type', 'class', ''] }
      },
      required: ['query']
    },
    handler({ query: q, kind }) {
      const safeQ = validateSafeString(q, { field: 'query', maxLen: 200 });
      const safeKind = validateSafeString(kind, { field: 'kind', maxLen: 40 });
      const kindFilter = safeKind ? `AND kind = '${esc(safeKind)}'` : '';
      return queryLinked(
        `SELECT kind, name, file_path, signature, line_start FROM nodes ` +
        `WHERE (name LIKE '%${escLike(safeQ)}%' ESCAPE '\\' OR file_path LIKE '%${escLike(safeQ)}%' ESCAPE '\\') ${kindFilter} ` +
        `ORDER BY kind, name LIMIT 30`
      );
    }
  },

  brain_files: {
    description: 'List indexed files in brain.db. Optionally filter by path pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Filter file paths containing this string. Optional.' }
      },
      required: []
    },
    handler({ pattern }) {
      const safe = validateSafeString(pattern, { field: 'pattern', maxLen: 200 });
      const where = safe ? `AND file_path LIKE '%${escLike(safe)}%' ESCAPE '\\'` : '';
      return query(
        `SELECT file_path, hash FROM nodes WHERE kind = 'file' ${where} ORDER BY file_path LIMIT 50`
      );
    }
  },

  brain_decisions: {
    description: 'List all decisions, or add a new decision. Decisions persist across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list or add', enum: ['list', 'add'] },
        question: { type: 'string', description: 'What was decided? (required for add)' },
        decision: { type: 'string', description: 'The choice made. (required for add)' },
        reasoning: { type: 'string', description: 'Why this choice? (optional)' },
        phase: { type: 'string', description: 'Which phase/task. (optional)' }
      },
      required: ['action']
    },
    handler({ action, question, decision, reasoning, phase }) {
      if (action === 'add') {
        if (!question || !decision) return { error: 'question and decision are required' };
        const ok = run(
          `INSERT INTO decisions (question, decision, reasoning, phase) ` +
          `VALUES ('${esc(question)}', '${esc(decision)}', '${esc(reasoning || '')}', '${esc(phase || '')}')`
        );
        return ok ? { status: 'recorded', question, decision } : { error: 'failed to insert' };
      }
      return query("SELECT id, question, decision, reasoning, phase, created_at FROM decisions ORDER BY created_at DESC LIMIT 20");
    }
  },

  brain_learnings: {
    description: 'List all learnings, or add a new learning. Learnings help ShipFast avoid past mistakes.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list or add', enum: ['list', 'add'] },
        pattern: { type: 'string', description: 'Short identifier e.g. "react-19-refs". (required for add)' },
        problem: { type: 'string', description: 'What went wrong. (required for add)' },
        solution: { type: 'string', description: 'What fixed it. (optional)' },
        domain: { type: 'string', description: 'Area: frontend, backend, database, auth, etc. (optional)' }
      },
      required: ['action']
    },
    handler({ action, pattern, problem, solution, domain }) {
      if (action === 'add') {
        if (!pattern || !problem) return { error: 'pattern and problem are required' };
        const ok = run(
          `INSERT INTO learnings (pattern, problem, solution, domain, source, confidence) ` +
          `VALUES ('${esc(pattern)}', '${esc(problem)}', '${esc(solution || '')}', '${esc(domain || '')}', 'user', 0.8)`
        );
        return ok ? { status: 'recorded', pattern, problem, solution } : { error: 'failed to insert' };
      }
      return query("SELECT id, pattern, problem, solution, domain, confidence, times_used FROM learnings ORDER BY confidence DESC LIMIT 20");
    }
  },

  brain_hot_files: {
    description: 'Show most frequently changed files based on git history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many files to show. Default: 15.' }
      },
      required: []
    },
    handler({ limit }) {
      return query(`SELECT file_path, change_count FROM hot_files ORDER BY change_count DESC LIMIT ${parseInt(limit) || 15}`);
    }
  },

  brain_status: {
    description: 'Full ShipFast status: brain stats, active tasks, recent tasks, checkpoints.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      if (!fs.existsSync(DB_PATH)) return { error: 'brain.db not found. Run: shipfast init' };

      const stats = TOOLS.brain_stats.handler();
      const active = query("SELECT id, description, status FROM tasks WHERE status IN ('running','pending') ORDER BY created_at DESC LIMIT 5");
      const recent = query("SELECT id, description, status, commit_sha FROM tasks WHERE status = 'passed' ORDER BY finished_at DESC LIMIT 5");
      const checkpoints = query("SELECT id, description FROM checkpoints ORDER BY created_at DESC LIMIT 5");

      return { stats, activeTasks: active, recentTasks: recent, checkpoints };
    }
  },

  brain_seeds: {
    description: 'List, add, promote, or dismiss forward ideas (seeds). Seeds capture improvement ideas surfaced during work for future milestones.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list, add, promote, or dismiss', enum: ['list', 'add', 'promote', 'dismiss'] },
        idea: { type: 'string', description: 'The idea text (required for add)' },
        source_task: { type: 'string', description: 'Which task surfaced this idea (optional)' },
        domain: { type: 'string', description: 'Domain: frontend, backend, database, auth, etc. (optional)' },
        priority: { type: 'string', description: 'someday, next, or urgent (optional, default: someday)', enum: ['someday', 'next', 'urgent'] },
        seed_id: { type: 'number', description: 'Seed ID (required for promote/dismiss)' },
        task_id: { type: 'string', description: 'Task ID to promote seed to (required for promote)' }
      },
      required: ['action']
    },
    handler({ action, idea, source_task, domain, priority, seed_id, task_id }) {
      if (action === 'add') {
        if (!idea) return { error: 'idea is required' };
        const ok = run(
          `INSERT INTO seeds (idea, source_task, domain, priority) ` +
          `VALUES ('${esc(idea)}', '${esc(source_task || '')}', '${esc(domain || '')}', '${esc(priority || 'someday')}')`
        );
        return ok ? { status: 'recorded', idea, domain, priority: priority || 'someday' } : { error: 'failed to insert' };
      }
      if (action === 'promote') {
        if (!seed_id || !task_id) return { error: 'seed_id and task_id are required' };
        const ok = run(`UPDATE seeds SET status = 'promoted', promoted_to = '${esc(task_id)}' WHERE id = ${parseInt(seed_id)}`);
        return ok ? { status: 'promoted', seed_id, task_id } : { error: 'failed to update' };
      }
      if (action === 'dismiss') {
        if (!seed_id) return { error: 'seed_id is required' };
        const ok = run(`UPDATE seeds SET status = 'dismissed' WHERE id = ${parseInt(seed_id)}`);
        return ok ? { status: 'dismissed', seed_id } : { error: 'failed to update' };
      }
      // list
      const filter = domain ? `AND domain = '${esc(domain)}'` : '';
      return query(`SELECT id, idea, source_task, domain, priority, status, created_at FROM seeds WHERE status = 'open' ${filter} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'next' THEN 1 ELSE 2 END, created_at DESC LIMIT 30`);
    }
  },

  // Feature #6: Graph traversal tools

  brain_graph_traverse: {
    description: 'Traverse the codebase dependency graph. Find what imports a file, what a file imports, or trace a call chain.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path to trace from' },
        direction: { type: 'string', description: 'inbound (who imports this) or outbound (what this imports) or both', enum: ['inbound', 'outbound', 'both'] },
        depth: { type: 'number', description: 'How many hops to traverse. Default 2.' }
      },
      required: ['file']
    },
    handler({ file, direction, depth }) {
      const d = direction || 'both';
      const candidates = resolveFilePath(file);
      if (!candidates.length) return { error: `No indexed file matches '${file}'`, file, direction: d };
      if (candidates.length > 1) return { error: 'Ambiguous file reference', candidates, file };
      const resolved = candidates[0];
      const results = { file: resolved, direction: d, inbound: [], outbound: [] };

      if (d === 'inbound' || d === 'both') {
        results.inbound = query(
          `SELECT REPLACE(source, 'file:', '') as from_file, kind FROM edges ` +
          `WHERE target = 'file:${esc(resolved)}' AND kind IN ('imports', 'calls', 'depends') LIMIT 20`
        );
      }
      if (d === 'outbound' || d === 'both') {
        results.outbound = query(
          `SELECT REPLACE(target, 'file:', '') as to_file, kind FROM edges ` +
          `WHERE source = 'file:${esc(resolved)}' AND kind IN ('imports', 'calls', 'depends') LIMIT 20`
        );
      }
      return results;
    }
  },

  brain_graph_cochanges: {
    description: 'Find files that frequently change together (co-change clusters from git history).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to find co-changes for. Optional — omit for top clusters.' },
        min_weight: { type: 'number', description: 'Minimum co-change score (0-1). Default 0.3.' }
      },
      required: []
    },
    handler({ file, min_weight }) {
      const w = min_weight || 0.3;
      if (file) {
        const candidates = resolveFilePath(file);
        if (!candidates.length) return { error: `No indexed file matches '${file}'`, file };
        if (candidates.length > 1) return { error: 'Ambiguous file reference', candidates, file };
        const resolved = candidates[0];
        const f = esc(resolved);
        return query(
          `SELECT CASE WHEN source = 'file:${f}' THEN REPLACE(target,'file:','') ELSE REPLACE(source,'file:','') END as related, weight ` +
          `FROM edges WHERE kind = 'co_changes' AND (source = 'file:${f}' OR target = 'file:${f}') AND weight > ${w} ORDER BY weight DESC LIMIT 10`
        );
      }
      return query(`SELECT REPLACE(source,'file:','') as file_a, REPLACE(target,'file:','') as file_b, weight FROM edges WHERE kind = 'co_changes' AND weight > ${w} ORDER BY weight DESC LIMIT 15`);
    }
  },

  brain_graph_blast_radius: {
    description: 'Get the blast radius of changing a file — all files that directly or transitively depend on it.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path to check blast radius for' },
        depth: { type: 'number', description: 'How many hops. Default 3.' }
      },
      required: ['file']
    },
    handler({ file, depth }) {
      const maxDepth = parseInt(depth) || 3;
      const candidates = resolveFilePath(file);
      if (!candidates.length) return { error: `No indexed file matches '${file}'`, file };
      if (candidates.length > 1) return { error: 'Ambiguous file reference', candidates, file };
      const resolved = candidates[0];
      return query(
        `WITH RECURSIVE affected(id, d) AS (` +
        `  SELECT id, 0 FROM nodes WHERE id = 'file:${esc(resolved)}'` +
        `  UNION ` +
        `  SELECT e.source, a.d + 1 FROM edges e JOIN affected a ON e.target = a.id` +
        `  WHERE a.d < ${maxDepth} AND e.kind IN ('imports', 'calls', 'depends')` +
        `) SELECT DISTINCT n.file_path, n.name, n.kind FROM nodes n JOIN affected a ON n.id = a.id WHERE n.kind = 'file' LIMIT 20`
      );
    }
  },

  // Architecture layer tools

  brain_arch_layers: {
    description: 'Get architecture layer summary — auto-derived from import graph. Layer 0 = entry points (nothing imports them), higher layers = deeper dependencies.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      return query(
        "SELECT layer, COUNT(*) as files, SUM(imports_count) as total_imports, SUM(imported_by_count) as total_consumers " +
        "FROM architecture GROUP BY layer ORDER BY layer"
      );
    }
  },

  brain_arch_folders: {
    description: 'Get folder roles — auto-detected from import patterns. Roles: entry (imports many, imported by none), shared (imported by many), consumer (imports many), leaf (imports nothing), foundation, middle, top.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      return query(
        "SELECT folder_path, file_count, total_imports, total_imported_by, avg_layer, role FROM folders ORDER BY avg_layer LIMIT 40"
      );
    }
  },

  brain_arch_file: {
    description: 'Get architecture layer, folder, and connection counts for a file.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'File path or partial match' } },
      required: ['file']
    },
    handler({ file }) {
      const candidates = resolveFilePath(file);
      if (!candidates.length) return { error: `No indexed file matches '${file}'`, file };
      if (candidates.length > 1) return { error: 'Ambiguous file reference', candidates, file };
      return query(
        `SELECT a.*, f.role as folder_role FROM architecture a LEFT JOIN folders f ON a.folder = f.folder_path ` +
        `WHERE a.file_path = '${esc(candidates[0])}' LIMIT 10`
      );
    }
  },

  brain_arch_data_flow: {
    description: 'Trace data flow for a file: upstream consumers (who imports this) and downstream dependencies (what this imports). Shows the complete import chain with layers.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'File path to trace' } },
      required: ['file']
    },
    handler({ file }) {
      const candidates = resolveFilePath(file);
      if (!candidates.length) return { error: `No indexed file matches '${file}'`, file };
      if (candidates.length > 1) return { error: 'Ambiguous file reference', candidates, file };
      const resolved = candidates[0];
      const f = esc(resolved);
      const current = query(`SELECT a.*, f.role as folder_role FROM architecture a LEFT JOIN folders f ON a.folder = f.folder_path WHERE a.file_path = '${f}' LIMIT 1`);
      if (!current.length) return { error: 'File not indexed by architecture layer' };

      const upstream = query(
        `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
        `JOIN edges e ON ('file:' || a.file_path) = e.source ` +
        `WHERE e.target = 'file:${f}' AND e.kind = 'imports' ORDER BY a.layer ASC LIMIT 10`
      );
      const downstream = query(
        `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
        `JOIN edges e ON ('file:' || a.file_path) = e.target ` +
        `WHERE e.source = 'file:${f}' AND e.kind = 'imports' ORDER BY a.layer DESC LIMIT 10`
      );
      return { file: current[0], upstream_consumers: upstream, downstream_dependencies: downstream };
    }
  },

  brain_arch_layer_files: {
    description: 'List all files at a specific architecture layer.',
    inputSchema: {
      type: 'object',
      properties: { layer: { type: 'number', description: 'Layer number' } },
      required: ['layer']
    },
    handler({ layer }) {
      return query(
        `SELECT file_path, folder, imports_count, imported_by_count FROM architecture ` +
        `WHERE layer = ${parseInt(layer)} ORDER BY imported_by_count DESC LIMIT 30`
      );
    }
  },

  brain_arch_most_connected: {
    description: 'Find the most connected files — highest total imports + consumers.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Default 15' } },
      required: []
    },
    handler({ limit }) {
      return query(
        `SELECT file_path, layer, folder, imports_count, imported_by_count, ` +
        `(imports_count + imported_by_count) as total FROM architecture ORDER BY total DESC LIMIT ${parseInt(limit) || 15}`
      );
    }
  },

  brain_tasks: {
    description: 'Full task CRUD. Actions: list (default filters out deleted), show, add, update, rename, edit_plan, soft_delete, restore.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list, show, add, update, rename, edit_plan, soft_delete, or restore', enum: ['list', 'show', 'add', 'update', 'rename', 'edit_plan', 'soft_delete', 'restore'] },
        status_filter: { type: 'string', description: 'Filter by status: pending, running, passed, failed, rolled_back, deleted (for list)' },
        phase: { type: 'string', description: 'Filter by phase (for list) or set phase (for add)' },
        id: { type: 'string', description: 'Task ID (required for show/update/rename/edit_plan/soft_delete/restore; optional for add)' },
        description: { type: 'string', description: 'Task description (for add/rename)' },
        plan_text: { type: 'string', description: 'Task plan details (for add/edit_plan)' },
        status: { type: 'string', description: 'New status (for update): pending, running, passed, failed, rolled_back, blocked, skipped, deleted' },
        commit_sha: { type: 'string', description: 'Commit SHA (for update on pass)' },
        error: { type: 'string', description: 'Error message (for update on fail)' },
        include_deleted: { type: 'boolean', description: 'Include soft-deleted tasks in list output. Default false.' },
        limit: { type: 'number', description: 'Max results (for list). Default 20.' }
      },
      required: ['action']
    },
    handler({ action, status_filter, phase, id, description, plan_text, status, commit_sha, error, include_deleted, limit }) {
      if (action === 'add') {
        if (!description) return { error: 'description is required' };
        const taskId = id || ('task:' + Date.now());
        const ok = run(
          `INSERT OR REPLACE INTO tasks (id, phase, description, plan_text, status) ` +
          `VALUES ('${esc(taskId)}', '${esc(phase || '')}', '${esc(description)}', '${esc(plan_text || '')}', 'pending')`
        );
        return ok ? { status: 'created', id: taskId } : { error: 'failed to insert' };
      }
      if (action === 'show') {
        if (!id) return { error: 'id is required for show' };
        const rows = query(`SELECT * FROM tasks WHERE id = '${esc(id)}'`);
        return rows.length ? rows[0] : { error: 'not found' };
      }
      if (action === 'rename') {
        if (!id || !description) return { error: 'id and description required for rename' };
        const ok = run(`UPDATE tasks SET description = '${esc(description)}' WHERE id = '${esc(id)}'`);
        return ok ? { status: 'renamed', id } : { error: 'failed to rename' };
      }
      if (action === 'edit_plan') {
        if (!id || plan_text === undefined) return { error: 'id and plan_text required for edit_plan' };
        const ok = run(`UPDATE tasks SET plan_text = '${esc(plan_text)}' WHERE id = '${esc(id)}'`);
        return ok ? { status: 'plan_updated', id } : { error: 'failed to edit plan' };
      }
      if (action === 'soft_delete') {
        if (!id) return { error: 'id required for soft_delete' };
        const ok = run(`UPDATE tasks SET status = 'deleted' WHERE id = '${esc(id)}'`);
        return ok ? { status: 'deleted', id } : { error: 'failed to delete' };
      }
      if (action === 'restore') {
        if (!id) return { error: 'id required for restore' };
        const ok = run(`UPDATE tasks SET status = 'pending' WHERE id = '${esc(id)}' AND status = 'deleted'`);
        return ok ? { status: 'restored', id } : { error: 'failed to restore' };
      }
      if (action === 'update') {
        if (!id) return { error: 'id is required for update' };
        const sets = [];
        if (status) sets.push(`status = '${esc(status)}'`);
        if (commit_sha) sets.push(`commit_sha = '${esc(commit_sha)}'`);
        if (error !== undefined) sets.push(`error = '${esc(error)}'`);
        if (status === 'running') sets.push(`started_at = strftime('%s', 'now')`);
        if (status === 'passed' || status === 'failed') sets.push(`finished_at = strftime('%s', 'now')`);
        if (sets.length === 0) return { error: 'nothing to update' };
        const ok = run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = '${esc(id)}'`);
        return ok ? { status: 'updated', id } : { error: 'failed to update' };
      }
      // list
      const conditions = [];
      if (status_filter) conditions.push(`status = '${esc(status_filter)}'`);
      else if (!include_deleted) conditions.push(`status != 'deleted'`);
      if (phase) conditions.push(`phase = '${esc(phase)}'`);
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      return query(`SELECT id, phase, description, status, commit_sha, error, tokens_used, attempts FROM tasks ${where} ORDER BY created_at DESC LIMIT ${parseInt(limit) || 20}`);
    }
  },

  brain_context: {
    description: 'Get or set scoped context (project, phase, worktree, session). Use this instead of raw sqlite3 for context management.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get, set, or list', enum: ['get', 'set', 'list'] },
        scope: { type: 'string', description: 'Scope: project, milestone, phase, task, worktree, session' },
        key: { type: 'string', description: 'Context key (required for get/set)' },
        value: { type: 'string', description: 'Value to store (required for set). JSON string for structured data.' }
      },
      required: ['action', 'scope']
    },
    handler({ action, scope, key, value }) {
      if (action === 'set') {
        if (!key || !value) return { error: 'key and value required for set' };
        const ok = run(
          `INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at) ` +
          `VALUES ('${esc(scope)}:${esc(key)}', '${esc(scope)}', '${esc(key)}', '${esc(value)}', ` +
          `COALESCE((SELECT version FROM context WHERE id = '${esc(scope)}:${esc(key)}'), 0) + 1, strftime('%s', 'now'))`
        );
        return ok ? { status: 'stored', scope, key } : { error: 'failed to store' };
      }
      if (action === 'get') {
        if (!key) return { error: 'key required for get' };
        const rows = query(`SELECT value, version FROM context WHERE scope = '${esc(scope)}' AND key = '${esc(key)}'`);
        return rows.length ? rows[0] : { value: null };
      }
      // list
      return query(`SELECT key, value FROM context WHERE scope = '${esc(scope)}' ORDER BY updated_at DESC LIMIT 20`);
    }
  },

  brain_sessions: {
    description: 'Record /sf:* skill invocations. Every skill calls start at the top and finish at every exit (including bail-outs and redirects). Use list/get to inspect recent runs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'start, finish, list, or get', enum: ['start', 'finish', 'list', 'get'] },
        run_id: { type: 'string', description: 'Session run id (required for start/finish/get). Generate at skill start: "run:<unix-ms>:<rand4>".' },
        command: { type: 'string', description: 'Skill name like "sf:do" (required for start)' },
        args: { type: 'string', description: 'Raw $ARGUMENTS passed to the skill (for start)' },
        branch: { type: 'string', description: 'Current git branch at invocation (for start)' },
        classification: { type: 'string', description: 'JSON string: {intent, complexity, subcommand, ...} (for start)' },
        outcome: { type: 'string', description: 'completed | redirected | bailed | errored (for finish)', enum: ['completed', 'redirected', 'bailed', 'errored'] },
        redirect_to: { type: 'string', description: 'Target skill when outcome=redirected (for finish)' },
        artifacts_written: { type: 'string', description: 'JSON array of artifact ids produced, e.g. [\"finding:..\",\"task:..\"] (for finish)' },
        command_filter: { type: 'string', description: 'Filter by command (for list)' },
        branch_filter: { type: 'string', description: 'Filter by branch (for list)' },
        limit: { type: 'number', description: 'Max results (for list). Default 20.' }
      },
      required: ['action']
    },
    handler({ action, run_id, command, args, branch, classification, outcome, redirect_to, artifacts_written, command_filter, branch_filter, limit }) {
      if (action === 'start') {
        if (!run_id || !command) return { error: 'run_id and command required for start' };
        const ok = run(
          `INSERT OR REPLACE INTO skill_sessions (run_id, command, args, branch, classification, started_at) ` +
          `VALUES ('${esc(run_id)}', '${esc(command)}', '${esc(args || '')}', '${esc(branch || '')}', '${esc(classification || '')}', strftime('%s','now'))`
        );
        return ok ? { status: 'started', run_id } : { error: 'failed to start session' };
      }
      if (action === 'finish') {
        if (!run_id) return { error: 'run_id required for finish' };
        const sets = [`finished_at = strftime('%s','now')`];
        if (outcome) sets.push(`outcome = '${esc(outcome)}'`);
        if (redirect_to !== undefined) sets.push(`redirect_to = '${esc(redirect_to)}'`);
        if (artifacts_written !== undefined) sets.push(`artifacts_written = '${esc(artifacts_written)}'`);
        const ok = run(`UPDATE skill_sessions SET ${sets.join(', ')} WHERE run_id = '${esc(run_id)}'`);
        return ok ? { status: 'finished', run_id } : { error: 'failed to finish session' };
      }
      if (action === 'get') {
        if (!run_id) return { error: 'run_id required for get' };
        const rows = query(`SELECT * FROM skill_sessions WHERE run_id = '${esc(run_id)}'`);
        return rows.length ? rows[0] : { error: 'not found' };
      }
      // list
      const conditions = [];
      if (command_filter) conditions.push(`command = '${esc(command_filter)}'`);
      if (branch_filter) conditions.push(`branch = '${esc(branch_filter)}'`);
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      return query(`SELECT run_id, command, args, branch, outcome, redirect_to, artifacts_written, started_at, finished_at FROM skill_sessions ${where} ORDER BY started_at DESC LIMIT ${parseInt(limit) || 20}`);
    }
  },

  brain_findings: {
    description: 'Per-branch Scout findings with per-citation validation. /sf:investigate stores findings; /sf:do uses list_fresh to reuse them without re-Scouting when the cited code is unchanged. Citations point at (file, line range, sha, hash) — each is verified independently against the current repo so partial reuse works.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'add, list_fresh, get, mark_stale, or clear_branch', enum: ['add', 'list_fresh', 'get', 'mark_stale', 'clear_branch'] },
        id: { type: 'string', description: 'Finding id (for get / mark_stale)' },
        branch: { type: 'string', description: 'Git branch name (for add / list_fresh / clear_branch)' },
        topic: { type: 'string', description: 'Topic label like "flow-map", "consumers", "risks" (for add)' },
        summary: { type: 'string', description: 'Short headline, 1-2 sentences (for add)' },
        body: { type: 'string', description: 'Full finding body, markdown (for add)' },
        citations: { type: 'string', description: 'JSON array of citations: [{file, line_start, line_end, sha, hash}] (for add)' },
        session_id: { type: 'string', description: 'Optional run_id of the session that produced this finding (for add)' }
      },
      required: ['action']
    },
    handler({ action, id, branch, topic, summary, body, citations, session_id }) {
      if (action === 'add') {
        if (!branch || !topic || !summary || !body || !citations) {
          return { error: 'branch, topic, summary, body, citations required for add' };
        }
        // Validate citations is JSON array
        try {
          const parsed = JSON.parse(citations);
          if (!Array.isArray(parsed)) return { error: 'citations must be a JSON array' };
        } catch { return { error: 'citations must be valid JSON' }; }
        const findingId = 'finding:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6);
        const ok = run(
          `INSERT INTO findings (id, branch, topic, summary, body, citations_json, status, session_id) ` +
          `VALUES ('${esc(findingId)}', '${esc(branch)}', '${esc(topic)}', '${esc(summary)}', '${esc(body)}', '${esc(citations)}', 'fresh', '${esc(session_id || '')}')`
        );
        return ok ? { status: 'added', id: findingId } : { error: 'failed to insert finding' };
      }
      if (action === 'get') {
        if (!id) return { error: 'id required for get' };
        const rows = query(`SELECT * FROM findings WHERE id = '${esc(id)}'`);
        return rows.length ? rows[0] : { error: 'not found' };
      }
      if (action === 'mark_stale') {
        if (!id) return { error: 'id required for mark_stale' };
        const ok = run(`UPDATE findings SET status = 'stale' WHERE id = '${esc(id)}'`);
        return ok ? { status: 'marked_stale', id } : { error: 'failed' };
      }
      if (action === 'clear_branch') {
        if (!branch) return { error: 'branch required for clear_branch' };
        const ok = run(`UPDATE findings SET status = 'stale' WHERE branch = '${esc(branch)}' AND status != 'stale'`);
        return ok ? { status: 'cleared', branch } : { error: 'failed' };
      }
      // list_fresh — citation-based verification against current repo
      if (!branch) return { error: 'branch required for list_fresh' };
      const rows = query(
        `SELECT id, branch, topic, summary, body, citations_json, status, session_id, created_at ` +
        `FROM findings WHERE branch = '${esc(branch)}' AND status != 'stale' ORDER BY created_at DESC`
      );
      const verified = [];
      for (const row of rows) {
        let citations;
        try { citations = JSON.parse(row.citations_json); } catch { citations = []; }
        let validCount = 0;
        const citationStatus = [];
        for (const c of citations) {
          const ok = verifyCitation(c);
          citationStatus.push({ ...c, valid: ok });
          if (ok) validCount++;
        }
        let newStatus = 'stale';
        if (validCount === citations.length && citations.length > 0) newStatus = 'fresh';
        else if (validCount > 0) newStatus = 'partial';
        // Record verification result
        run(`UPDATE findings SET status = '${newStatus}', last_verified_at = strftime('%s','now') WHERE id = '${esc(row.id)}'`);
        if (newStatus !== 'stale') {
          verified.push({
            id: row.id, topic: row.topic, summary: row.summary, body: row.body,
            status: newStatus, valid_citations: validCount, total_citations: citations.length,
            citations: citationStatus
          });
        }
      }
      return verified;
    }
  },

  brain_config: {
    description: 'Get or set config values (token budget, model tiers, default branch, post-ship hook, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get, set, or list', enum: ['get', 'set', 'list'] },
        key: { type: 'string', description: 'Config key (required for get/set)' },
        value: { type: 'string', description: 'Config value (required for set)' }
      },
      required: ['action']
    },
    handler({ action, key, value }) {
      if (action === 'set') {
        if (!key || value === undefined) return { error: 'key and value required' };
        const ok = run(`INSERT OR REPLACE INTO config (key, value) VALUES ('${esc(key)}', '${esc(value)}')`);
        return ok ? { status: 'set', key, value } : { error: 'failed to set' };
      }
      if (action === 'get') {
        if (!key) return { error: 'key required' };
        const rows = query(`SELECT value FROM config WHERE key = '${esc(key)}'`);
        return rows.length ? { key, value: rows[0].value } : { key, value: null };
      }
      // list
      return query("SELECT key, value FROM config ORDER BY key");
    }
  },

  brain_stack: {
    description: 'Compact project-stack summary: framework, runtime, package manager, test framework, ORM, monorepo tool. Reads derived signals from brain.db.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      const rows = query(`SELECT key, value FROM context WHERE scope = 'project'`);
      const out = {};
      for (const r of rows) {
        try { out[r.key] = JSON.parse(r.value); }
        catch { out[r.key] = r.value; }
      }
      return out;
    }
  },

  brain_deps: {
    description: 'List project dependencies from manifest files (package.json, Cargo.toml, go.mod, pyproject.toml, etc.). Filter by ecosystem, name (partial match), or kind.',
    inputSchema: {
      type: 'object',
      properties: {
        ecosystem: { type: 'string', description: 'npm, cargo, pypi, go, rubygems, composer, pubspec, nuget, hex', enum: ['npm','cargo','pypi','go','rubygems','composer','pubspec','nuget','hex',''] },
        name:      { type: 'string', description: 'Partial name match (e.g. "react" matches @types/react too)' },
        kind:      { type: 'string', description: 'runtime, dev, peer, optional', enum: ['runtime','dev','peer','optional',''] },
        limit:     { type: 'number', description: 'Max results (default 100, max 500)' },
      },
      required: [],
    },
    handler({ ecosystem, name, kind, limit }) {
      const safeEco  = validateSafeString(ecosystem, { field: 'ecosystem', maxLen: 40 });
      const safeName = validateSafeString(name,      { field: 'name',      maxLen: 100 });
      const safeKind = validateSafeString(kind,      { field: 'kind',      maxLen: 40 });
      const where = [];
      if (safeEco)  where.push(`ecosystem = '${esc(safeEco)}'`);
      if (safeKind) where.push(`kind = '${esc(safeKind)}'`);
      if (safeName) where.push(`name LIKE '%${escLike(safeName)}%' ESCAPE '\\'`);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const lim = Math.max(1, Math.min(500, parseInt(limit) || 100));
      return query(`SELECT manifest_path, ecosystem, name, version, kind FROM dependencies ${clause} ORDER BY ecosystem, name LIMIT ${lim}`);
    }
  },

  brain_scripts: {
    description: 'List build/test/dev scripts from package.json / pyproject.toml / composer.json. Use this before suggesting a command — e.g. run the project\'s actual test script rather than a generic "npm test".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact script name (e.g. "test", "build", "dev")' },
      },
      required: [],
    },
    handler({ name }) {
      const safeName = validateSafeString(name, { field: 'name', maxLen: 100 });
      const where = safeName ? `WHERE name = '${esc(safeName)}'` : '';
      return query(`SELECT manifest_path, name, command, source FROM scripts ${where} ORDER BY manifest_path, name LIMIT 100`);
    }
  },

  brain_env_vars: {
    description: 'List environment variable NAMES expected by the project (from .env.example / .env.sample). Values are NEVER stored or returned.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler() {
      const rows = query(`SELECT value FROM context WHERE scope = 'project' AND key = 'env_vars'`);
      if (!rows.length) return { env_vars: [] };
      try { return { env_vars: JSON.parse(rows[0].value) }; }
      catch { return { env_vars: [] }; }
    }
  },

  brain_model_outcome: {
    description: 'Record model performance outcome for the feedback loop. Tracks success/failure per agent+model+domain.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name: scout, architect, builder, critic, scribe' },
        model: { type: 'string', description: 'Model used: haiku, sonnet, opus' },
        domain: { type: 'string', description: 'Domain: auth, ui, database, etc.' },
        task_id: { type: 'string', description: 'Task ID' },
        outcome: { type: 'string', description: 'success, failure, or retry', enum: ['success', 'failure', 'retry'] }
      },
      required: ['agent', 'model', 'outcome']
    },
    handler({ agent, model, domain, task_id, outcome }) {
      const ok = run(
        `INSERT INTO model_performance (agent, model, domain, task_id, outcome) ` +
        `VALUES ('${esc(agent)}', '${esc(model)}', '${esc(domain || '')}', '${esc(task_id || '')}', '${esc(outcome)}')`
      );
      return ok ? { status: 'recorded', agent, model, outcome } : { error: 'failed to record' };
    }
  },
};

// Export handlers for unit tests. Stdio startup only runs when invoked directly.
if (require.main !== module) {
  module.exports = { TOOLS, verifyCitation, esc, query, run };
  return;
}

// ============================================================
// MCP Protocol (JSON-RPC over stdio)
// ============================================================

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;

  // MCP uses Content-Length header framing
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

    const contentLength = parseInt(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      const msg = JSON.parse(body);
      handleMessage(msg);
    } catch {}
  }
});

function send(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'shipfast-brain', version: '1.0.0' }
      }
    });
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    const tools = Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
    return send({ jsonrpc: '2.0', id, result: { tools } });
  }

  if (method === 'tools/call') {
    const toolName = params.name;
    const tool = TOOLS[toolName];
    if (!tool) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Unknown tool: ' + toolName }], isError: true } });
    }

    // Handlers may be async — await the result before serializing.
    Promise.resolve()
      .then(() => tool.handler(params.arguments || {}))
      .then((result) => {
        let text = JSON.stringify(result, null, 2);
        if (text.length > 50000) {
          text = text.slice(0, 50000) + '\n... [truncated — ' + text.length + ' chars total. Use more specific query.]';
        }
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      })
      .catch((err) => {
        send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true }
        });
      });
    return;
  }

  // Unknown method
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}
