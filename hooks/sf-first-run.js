#!/usr/bin/env node
/**
 * ShipFast First-Run Hook — PreToolUse
 *
 * FIX #3: Exits immediately for non-Skill tools (near-zero overhead).
 * Only injects brain indexing instruction when:
 * - Tool is Skill (sf-* command)
 * - brain.db doesn't exist for this repo
 * - This is a git repo
 *
 * After user runs `shipfast init`, brain.db exists and this becomes a no-op.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000); // consistent 10s timeout across all hooks
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);

    // FIX #3: Fast exit for non-Skill tools (99% of calls)
    if ((data.tool_name || '') !== 'Skill') process.exit(0);

    const cwd = data.cwd || process.cwd();

    // Already indexed — no-op
    if (fs.existsSync(path.join(cwd, '.shipfast', 'brain.db'))) process.exit(0);

    // Not a git repo — skip
    if (!fs.existsSync(path.join(cwd, '.git'))) process.exit(0);

    // Find indexer in global install locations
    const home = os.homedir();
    const indexer = [
      path.join(home, '.claude', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(home, '.cursor', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(home, '.gemini', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(home, '.codex', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(home, '.config', 'opencode', 'shipfast', 'brain', 'indexer.cjs'),
    ].find(p => fs.existsSync(p));

    if (!indexer) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'SHIPFAST: brain.db not found for this repo. ' +
          'Run this first to index the codebase:\n' +
          '```bash\nnode "' + indexer + '" "' + cwd + '"\n```\n' +
          'Then proceed with the command.'
      }
    }));
  } catch {
    process.exit(0);
  }
});
