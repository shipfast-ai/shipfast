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
const { execFileSync: safeRun } = require('child_process');

const CWD = process.env.SHIPFAST_CWD || process.cwd();
const DB_PATH = path.join(CWD, '.shipfast', 'brain.db');

// ============================================================
// SQLite query helper
// ============================================================

function query(sql) {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    const result = safeRun('sqlite3', ['-json', DB_PATH, sql], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() ? JSON.parse(result) : [];
  } catch { return []; }
}

function run(sql) {
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    safeRun('sqlite3', [DB_PATH, sql], { stdio: ['pipe', 'pipe', 'pipe'] });
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

function queryLinked(sql) {
  // Query local brain first
  const local = query(sql);

  // Then query each linked repo's brain
  const linked = getLinkedPaths();
  const results = [...local];
  for (const repoPath of linked) {
    const linkedDb = path.join(repoPath, '.shipfast', 'brain.db');
    if (!fs.existsSync(linkedDb)) continue;
    try {
      const r = safeRun('sqlite3', ['-json', linkedDb, sql], {
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (r) {
        const parsed = JSON.parse(r);
        // Tag results with source repo
        const repoName = path.basename(repoPath);
        parsed.forEach(row => { row._repo = repoName; });
        results.push(...parsed);
      }
    } catch {}
  }
  return results;
}

function esc(s) {
  return s == null ? '' : String(s).replace(/'/g, "''");
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
        "UNION ALL SELECT 'hot_files', COUNT(*) FROM hot_files"
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
    description: 'Search the codebase knowledge graph for files, functions, types, or components by name. Searches local + all linked repos.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (file name, function name, type name)' },
        kind: { type: 'string', description: 'Filter by kind: file, function, type, class, component. Optional.', enum: ['file', 'function', 'type', 'class', 'component', ''] }
      },
      required: ['query']
    },
    handler({ query: q, kind }) {
      const kindFilter = kind ? `AND kind = '${esc(kind)}'` : '';
      return queryLinked(
        `SELECT kind, name, file_path, signature, line_start FROM nodes ` +
        `WHERE (name LIKE '%${esc(q)}%' OR file_path LIKE '%${esc(q)}%') ${kindFilter} ` +
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
      const where = pattern ? `AND file_path LIKE '%${esc(pattern)}%'` : '';
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
      const maxDepth = parseInt(depth) || 2;
      const results = { file, direction: d, inbound: [], outbound: [] };

      if (d === 'inbound' || d === 'both') {
        results.inbound = query(
          `SELECT REPLACE(source, 'file:', '') as from_file, kind FROM edges ` +
          `WHERE target LIKE '%${esc(file)}%' AND kind IN ('imports', 'calls', 'depends') LIMIT 20`
        );
      }
      if (d === 'outbound' || d === 'both') {
        results.outbound = query(
          `SELECT REPLACE(target, 'file:', '') as to_file, kind FROM edges ` +
          `WHERE source LIKE '%${esc(file)}%' AND kind IN ('imports', 'calls', 'depends') LIMIT 20`
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
        return query(
          `SELECT CASE WHEN source LIKE '%${esc(file)}%' THEN REPLACE(target,'file:','') ELSE REPLACE(source,'file:','') END as related, weight ` +
          `FROM edges WHERE kind = 'co_changes' AND (source LIKE '%${esc(file)}%' OR target LIKE '%${esc(file)}%') AND weight > ${w} ORDER BY weight DESC LIMIT 10`
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
      return query(
        `WITH RECURSIVE affected(id, d) AS (` +
        `  SELECT id, 0 FROM nodes WHERE file_path LIKE '%${esc(file)}%'` +
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
      return query(
        `SELECT a.*, f.role as folder_role FROM architecture a LEFT JOIN folders f ON a.folder = f.folder_path ` +
        `WHERE a.file_path LIKE '%${esc(file)}%' LIMIT 10`
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
      const current = query(`SELECT a.*, f.role as folder_role FROM architecture a LEFT JOIN folders f ON a.folder = f.folder_path WHERE a.file_path LIKE '%${esc(file)}%' LIMIT 1`);
      if (!current.length) return { error: 'File not found' };

      const upstream = query(
        `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
        `JOIN edges e ON ('file:' || a.file_path) = e.source ` +
        `WHERE e.target LIKE '%${esc(file)}%' AND e.kind = 'imports' ORDER BY a.layer ASC LIMIT 10`
      );
      const downstream = query(
        `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
        `JOIN edges e ON ('file:' || a.file_path) = e.target ` +
        `WHERE e.source LIKE '%${esc(file)}%' AND e.kind = 'imports' ORDER BY a.layer DESC LIMIT 10`
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
};

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

    try {
      const result = tool.handler(params.arguments || {});
      let text = JSON.stringify(result, null, 2);
      // Truncate large responses to prevent context flooding (50KB max)
      if (text.length > 50000) {
        text = text.slice(0, 50000) + '\n... [truncated — ' + text.length + ' chars total. Use more specific query.]';
      }
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text }] }
      });
    } catch (err) {
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true }
      });
    }
  }

  // Unknown method
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}
