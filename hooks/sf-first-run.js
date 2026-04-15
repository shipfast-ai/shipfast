#!/usr/bin/env node
/**
 * ShipFast First-Run Hook — PreToolUse
 *
 * Detects when brain.db doesn't exist in the current repo.
 * Injects a message telling the agent to run the indexer first.
 * Only fires once per repo — after indexing, brain.db exists and this becomes a no-op.
 */

const fs = require('fs');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const cwd = data.cwd || process.cwd();

    // Only trigger for sf-* skill invocations
    const toolName = data.tool_name || '';
    if (toolName !== 'Skill') {
      process.exit(0);
    }

    // Check if brain.db exists
    const brainPath = path.join(cwd, '.shipfast', 'brain.db');
    if (fs.existsSync(brainPath)) {
      process.exit(0); // already trained, no-op
    }

    // Check if this is a git repo
    if (!fs.existsSync(path.join(cwd, '.git'))) {
      process.exit(0); // not a repo, skip
    }

    // Find the indexer
    const possiblePaths = [
      path.join(cwd, '.claude', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(cwd, '.cursor', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(cwd, '.gemini', 'shipfast', 'brain', 'indexer.cjs'),
      path.join(require('os').homedir(), '.claude', 'shipfast', 'brain', 'indexer.cjs'),
    ];

    const indexerPath = possiblePaths.find(p => fs.existsSync(p));
    if (!indexerPath) {
      process.exit(0); // can't find indexer
    }

    // Inject training instruction
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'SHIPFAST FIRST RUN: brain.db not found for this repo. ' +
          'Before proceeding with the task, run the indexer to train the brain:\n' +
          '```bash\nnode "' + indexerPath + '" "' + cwd + '"\n```\n' +
          'This indexes the codebase (~1 second) and creates .shipfast/brain.db. ' +
          'Also add ".shipfast/" to .gitignore if not already there. ' +
          'After indexing, proceed with the user\'s command normally.'
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.exit(0);
  }
});
