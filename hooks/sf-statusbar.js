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
 *   NN% left           context remaining percentage (green / yellow / red)
 *   $<cost>            session cost (yellow)
 *   !ctx               context-critical flag (red, only when >200K tokens)
 *
 * Context usage comes from the tmp metrics file written by
 * hooks/sf-statusline.js on every Notification event (total_tokens_in,
 * max_context_tokens). Falls back silently if the file is missing.
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
const GREEN = '\x1b[32m';
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

function readContextMetrics(sessionId) {
  if (!sessionId) return null;
  const metricsPath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  if (!fs.existsSync(metricsPath)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    const remaining = typeof m.remaining_percentage === 'number' ? m.remaining_percentage : null;
    return remaining != null ? { remaining } : null;
  } catch { return null; }
}

function contextColor(pct) {
  if (pct >= 50) return GREEN;
  if (pct >= 25) return YELLOW;
  return RED;
}

function render(data) {
  const autoOn = fs.existsSync(AUTO_ROUTE_FLAG);
  const sep = color(' · ', GRAY);
  const parts = [];

  // Brand + badge
  const badge = autoOn ? color('SF', BOLD + CYAN) + color('\u26A1', BOLD + YELLOW)
                       : color('SF', BOLD + CYAN);
  parts.push(badge);

  // Model
  const model = data.model && (data.model.display_name || data.model.id);
  if (model) parts.push(color(String(model), DIM));

  // Context remaining (read from tmp metrics file written by sf-statusline.js)
  const ctx = readContextMetrics(data.session_id);
  if (ctx) {
    const pct = Math.max(0, Math.min(100, Math.round(ctx.remaining)));
    parts.push(color(`${pct}% left`, contextColor(pct)));
  }

  // Session cost
  const cost = data.cost && data.cost.total_cost_usd;
  if (typeof cost === 'number' && cost > 0) {
    parts.push(color('$' + cost.toFixed(2), YELLOW));
  }

  // Hard context limit flag — Claude Code sets this at >200K tokens
  if (data.exceeds_200k_tokens) parts.push(color('!ctx', BOLD + RED));

  process.stdout.write(parts.join(sep));
}
