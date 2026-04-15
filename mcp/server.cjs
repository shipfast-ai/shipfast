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

  brain_search: {
    description: 'Search the codebase knowledge graph for files, functions, types, or components by name.',
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
      return query(
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
  }
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
        serverInfo: { name: 'shipfast-brain', version: '0.5.0' }
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
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
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
