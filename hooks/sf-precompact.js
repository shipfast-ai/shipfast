#!/usr/bin/env node

/**
 * ShipFast PreCompact hook (Claude Code v2.1.105+).
 *
 * Fires right before Claude Code compacts the session. We use it to create
 * a brain checkpoint so multi-hour sessions can be rolled back to a known
 * pre-compaction state via `/sf-rollback`.
 *
 * NEVER returns exit code 2 — this hook is informational only; it must not
 * block compaction under any circumstance.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buf += chunk; });
process.stdin.on('end', () => {
  try { handle(JSON.parse(buf || '{}')); } catch { /* silent */ }
  process.exit(0);
});
setTimeout(() => { try { handle(JSON.parse(buf || '{}')); } catch {} process.exit(0); }, 200);

function handle(payload) {
  const cwd = payload.cwd || process.cwd();
  const dbPath = path.join(cwd, '.shipfast', 'brain.db');
  if (!fs.existsSync(dbPath)) return;

  // Resolve the brain module from any installed shipfast location or the
  // package source. We intentionally avoid a global shipfast import to stay
  // decoupled from how the user installed the package.
  const brain = loadBrain();
  if (!brain || typeof brain.createCheckpoint !== 'function') return;

  const id = 'auto-precompact-' + Date.now();
  try { brain.createCheckpoint(cwd, id, 'Pre-compaction auto-save'); }
  catch { /* silent — never blocks compaction */ }
}

function loadBrain() {
  const home = require('os').homedir();
  const candidates = [
    // Common installed locations
    path.join(home, '.claude', 'shipfast', 'brain', 'index.cjs'),
    path.join(home, '.config', 'opencode', 'shipfast', 'brain', 'index.cjs'),
    path.join(home, '.cursor', 'shipfast', 'brain', 'index.cjs'),
    // Source-package fallback (useful in dev)
    path.resolve(__dirname, '..', 'brain', 'index.cjs'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return require(p);
    } catch { /* try next */ }
  }
  return null;
}
