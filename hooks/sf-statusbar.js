#!/usr/bin/env node
/**
 * ShipFast Statusbar — Claude Code statusLine command (v1.9.2)
 *
 * Invoked every few seconds by Claude Code's statusLine mechanism.
 * Reads session JSON from stdin, outputs a single plain-text line to stdout
 * that Claude Code renders in the UI chrome above the input prompt.
 *
 * Registered as top-level `statusLine` in settings.json (NOT under hooks).
 * See bin/install.js writeSettings().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTO_ROUTE_FLAG = path.join(os.homedir(), '.shipfast', 'auto-route.enabled');

let input = '';
const timeout = setTimeout(() => { render({}); process.exit(0); }, 2000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  let data = {};
  try { data = JSON.parse(input); } catch {}
  render(data);
});

function render(data) {
  const autoOn = fs.existsSync(AUTO_ROUTE_FLAG);
  const prefix = autoOn ? 'SF\u26A1' : 'SF';

  const parts = [prefix];

  // Model display name — Claude Code passes model.display_name.
  const model = data.model && (data.model.display_name || data.model.id);
  if (model) parts.push(String(model));

  // Session cost if available (total_cost_usd is emitted on statusLine input).
  const cost = data.cost && data.cost.total_cost_usd;
  if (typeof cost === 'number' && cost > 0) {
    parts.push('$' + cost.toFixed(2));
  }

  // Context pressure flag (Claude Code passes exceeds_200k_tokens).
  if (data.exceeds_200k_tokens) parts.push('!ctx');

  process.stdout.write(parts.join(' \u00B7 '));
}
