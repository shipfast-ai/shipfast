#!/usr/bin/env node
/**
 * ShipFast Router — UserPromptSubmit hook (v1.9.3)
 *
 * Runs on every user prompt in Claude Code / OpenCode. Two responsibilities,
 * independently gated:
 *
 *   1) Brain snapshot (always, when brain.db exists).
 *      Injects a compact view of this repo's brain.db — node/edge counts,
 *      hot files, recent decisions, learnings, session history, active
 *      findings — plus a list of `brain_*` MCP tools the model can use to
 *      trace the graph instead of cold-reading files.
 *
 *   2) Auto-route nudge (gated on ~/.shipfast/auto-route.enabled).
 *      Asks the model to invoke the `sf:do` skill for plain code tasks.
 *      Bypassed for: /slash commands, !raw escapes, questions, short acks.
 *      Toggle with /sf:enable or /sf:disable.
 *
 * additionalContext is how UserPromptSubmit hooks talk to the model. We
 * bundle both concerns into one string so the model sees the graph state
 * AND the routing hint at the same time.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROUTE_FLAG = path.join(os.homedir(), '.shipfast', 'auto-route.enabled');
const MAX_CTX_BYTES = 6000; // keep the injection well under 2k tokens

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  let data = {};
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const raw = (data.prompt || '').trim();
  const cwd = (data.cwd && fs.existsSync(data.cwd)) ? data.cwd : process.cwd();

  const autoRoute = fs.existsSync(ROUTE_FLAG);

  const routeContext = shouldRoute(raw, autoRoute) ? buildRouteContext(raw) : '';
  const brainContext = buildBrainContext(cwd);

  if (!routeContext && !brainContext) process.exit(0);

  const full = [brainContext, routeContext].filter(Boolean).join('\n\n');
  const truncated = full.length > MAX_CTX_BYTES
    ? full.slice(0, MAX_CTX_BYTES) + '\n…[brain snapshot truncated]'
    : full;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: truncated
    }
  }));
});

// ---- route nudge ----

function shouldRoute(raw, autoRoute) {
  if (!autoRoute) return false;
  if (!raw) return false;
  if (raw.startsWith('/')) return false;
  if (raw.startsWith('!')) return false;
  if (raw.startsWith('?')) return false;
  if (raw.endsWith('?'))   return false;
  if (raw.length < 4)      return false;
  return true;
}

function buildRouteContext(raw) {
  return (
    `[ShipFast auto-router] The user's request is a code task. ` +
    `Invoke the \`sf:do\` skill with this task instead of using Edit / Write / Bash directly. ` +
    `Disable with /sf:disable.`
  );
}

// ---- brain snapshot ----

function findBrainDb(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, '.shipfast', 'brain.db');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runSql(dbPath, sql) {
  try {
    const out = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe']
    });
    return out.trim() ? JSON.parse(out) : [];
  } catch { return []; }
}

function truncate(s, max) {
  if (!s) return '';
  s = String(s).replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Cache the expensive snapshot build for 30s keyed on brain.db mtime.
// Each sqlite3 subprocess takes ~10-20ms and we make ~7 queries per turn —
// the snapshot stays identical until someone re-indexes. Cache file lives in
// tmpdir so it survives across hook invocations without needing a long-lived
// process.
const CACHE_TTL_MS = 30_000;
function snapshotCachePath(dbPath) {
  return path.join(os.tmpdir(), 'sf-prompt-snapshot-' + Buffer.from(dbPath).toString('base64url') + '.txt');
}
function readCachedSnapshot(dbPath) {
  try {
    const cachePath = snapshotCachePath(dbPath);
    if (!fs.existsSync(cachePath)) return null;
    const dbStat = fs.statSync(dbPath);
    const cacheStat = fs.statSync(cachePath);
    const ageMs = Date.now() - cacheStat.mtimeMs;
    // Invalidate if brain.db was modified after the cache, or cache is stale.
    if (dbStat.mtimeMs > cacheStat.mtimeMs) return null;
    if (ageMs > CACHE_TTL_MS) return null;
    return fs.readFileSync(cachePath, 'utf8');
  } catch { return null; }
}
function writeCachedSnapshot(dbPath, content) {
  try { fs.writeFileSync(snapshotCachePath(dbPath), content); } catch { /* silent */ }
}

function buildBrainContext(cwd) {
  const db = findBrainDb(cwd);
  if (!db) return '';

  // Fast path: reuse a recent snapshot if brain.db hasn't changed.
  const cached = readCachedSnapshot(db);
  if (cached != null) return cached;

  const [{ n: nodeCount = 0 } = {}] = runSql(db, 'SELECT COUNT(*) as n FROM nodes');
  if (!nodeCount) return ''; // brain.db exists but is empty

  const [{ n: edgeCount = 0 } = {}] = runSql(db, 'SELECT COUNT(*) as n FROM edges');
  const [{ n: decisionCount = 0 } = {}] = runSql(db, 'SELECT COUNT(*) as n FROM decisions');
  const [{ n: learningCount = 0 } = {}] = runSql(db, 'SELECT COUNT(*) as n FROM learnings');

  const hotFiles = runSql(db, 'SELECT file_path FROM hot_files ORDER BY change_count DESC LIMIT 5');
  const decisions = runSql(db, 'SELECT question, decision FROM decisions ORDER BY created_at DESC LIMIT 3');
  const learnings = runSql(db, "SELECT pattern, solution FROM learnings WHERE confidence >= 0.7 ORDER BY last_used DESC LIMIT 3");
  const sessions = runSql(db, 'SELECT command, args, branch, outcome FROM skill_sessions ORDER BY started_at DESC LIMIT 3');
  const finding  = runSql(db, "SELECT topic, summary, branch FROM findings WHERE status IN ('fresh','partial') ORDER BY created_at DESC LIMIT 1");

  const lines = [];
  lines.push(`[ShipFast brain.db — ${nodeCount} nodes · ${edgeCount} edges · ${decisionCount} decisions · ${learningCount} learnings]`);

  if (hotFiles.length) {
    lines.push(`Hot files: ${hotFiles.map(r => r.file_path).join(', ')}`);
  }
  if (decisions.length) {
    lines.push('Recent decisions:');
    for (const d of decisions) lines.push(`  · ${truncate(d.question, 60)} → ${truncate(d.decision, 60)}`);
  }
  if (learnings.length) {
    lines.push('Proven learnings:');
    for (const l of learnings) lines.push(`  · ${truncate(l.pattern, 40)}: ${truncate(l.solution || '(unsolved)', 80)}`);
  }
  if (sessions.length) {
    lines.push('Recent runs:');
    for (const s of sessions) {
      lines.push(`  · ${s.command} "${truncate(s.args || '', 40)}" on ${s.branch || '?'} (${s.outcome || 'running'})`);
    }
  }
  if (finding.length) {
    const f = finding[0];
    lines.push(`Active finding: ${f.topic} — ${truncate(f.summary, 80)} (branch ${f.branch})`);
  }

  lines.push('');
  lines.push('Brain MCP tools available:');
  lines.push('  brain_search(query)              — find nodes by name/pattern');
  lines.push('  brain_impact(node, direction)    — walk edges; trace consumers (upstream) or deps (downstream)');
  lines.push('  brain_files(filter)              — list indexed files');
  lines.push('  brain_decisions, brain_learnings, brain_findings, brain_hot_files');
  lines.push('  brain_tasks, brain_sessions, brain_context');
  lines.push('');
  lines.push('Edges table tracks: imports · calls · implements · depends · mutates · exports · extends · co_changes.');
  lines.push('Before reading files cold: query the graph first. To answer "what breaks if I change X?" or "what depends on X?", use brain_impact instead of cold reads.');

  const content = lines.join('\n');
  writeCachedSnapshot(db, content);
  return content;
}
