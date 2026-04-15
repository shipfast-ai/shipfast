#!/usr/bin/env node
/**
 * ShipFast Statusline — Notification hook
 *
 * Displays token budget and brain stats in the Claude Code status line.
 * Writes metrics to temp file for the context monitor to read.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;

    if (!sessionId || /[/\\]|\.\./.test(sessionId)) {
      process.exit(0);
    }

    // Extract context metrics from the notification data
    const totalTokens = data.total_tokens_in || 0;
    const maxTokens = data.max_context_tokens || 200000;
    const usedPct = Math.round((totalTokens / maxTokens) * 100);
    const remainingPct = 100 - usedPct;

    // Write metrics for context monitor
    const tmpDir = os.tmpdir();
    const metricsPath = path.join(tmpDir, `claude-ctx-${sessionId}.json`);
    fs.writeFileSync(metricsPath, JSON.stringify({
      used_pct: usedPct,
      remaining_percentage: remainingPct,
      timestamp: Math.floor(Date.now() / 1000)
    }));

    // Build status line
    const bar = buildBar(usedPct);
    const statusLine = `SF ${bar} ${usedPct}%`;

    const output = {
      hookSpecificOutput: {
        hookEventName: 'Notification',
        statustool: { title: statusLine }
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch {
    process.exit(0);
  }
});

function buildBar(pct) {
  const width = 10;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
}
