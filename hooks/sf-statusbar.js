#!/usr/bin/env node
/**
 * ShipFast Statusbar — Claude Code statusLine command (v1.9.2+)
 *
 * Invoked every few seconds by Claude Code's statusLine mechanism.
 * Reads session JSON from stdin, outputs a single ANSI-colored line that
 * Claude Code renders in the UI chrome above the input prompt.
 *
 * Segments (in order):
 *   SF[⚡]              brand + auto-route badge (cyan / yellow)
 *   <model>            model display name (dim)
 *   !ctx               context-critical flag (red, only when >200K tokens)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTO_ROUTE_FLAG = path.join(os.homedir(), '.shipfast', 'auto-route.enabled');

// ANSI color helpers
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

function color(s, code) { return code + s + RESET; }

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
  const sep = color(' · ', GRAY);
  const parts = [];

  // Brand + badge. VS16 (U+FE0F) forces emoji presentation on the lightning
  // bolt — without it most terminal fonts render it text-style (small).
  const badge = autoOn ? color('SF', BOLD + CYAN) + color('\u26A1\uFE0F', BOLD + YELLOW)
                       : color('SF', BOLD + CYAN);
  parts.push(badge);

  // Model
  const model = data.model && (data.model.display_name || data.model.id);
  if (model) parts.push(color(String(model), DIM));

  // Hard context limit flag — Claude Code sets this at >200K tokens
  if (data.exceeds_200k_tokens) parts.push(color('!ctx', BOLD + RED));

  process.stdout.write(parts.join(sep));
}
