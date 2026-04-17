/**
 * Shared helpers for project-signal scanners.
 *
 * All parsers are defensive: bad/missing input returns {} or [] rather than throwing,
 * so a single malformed manifest doesn't break scanning of the rest of the repo.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function safeReadFile(fp) {
  try { return fs.readFileSync(fp, 'utf8'); } catch { return ''; }
}

function safeJsonParse(src) {
  if (!src) return null;
  try { return JSON.parse(src); } catch {}
  try { return JSON.parse(stripJsonComments(src)); } catch { return null; }
}

// Tolerant JSON-with-comments + trailing-commas stripper (tsconfig style).
function stripJsonComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = false, quote = '', esc = false;
  while (i < n) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      i++;
    } else if (c === '"' || c === "'") {
      inStr = true; quote = c; out += c; i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c; i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Minimal TOML parser — supports the subset we need for Cargo.toml, pyproject.toml:
 *   [section]
 *   [section.subsection]
 *   key = "string"
 *   key = "1.2.3"
 *   key = { version = "1", features = [...] }  -> returns { version: "1", features: [...] }
 *   key = 123
 *   key = true
 *   key = ["a", "b"]
 *
 * Unsupported: multi-line strings, multi-line arrays, array-of-tables [[foo]].
 * Returns {} on parse failure. A malformed line becomes a skipped line, not a thrown error.
 */
function parseTomlLite(src) {
  if (!src) return {};
  const out = {};
  const lines = src.split(/\r?\n/);
  let cursor = out;

  function setSection(keyPath) {
    const parts = keyPath.split('.').map(s => s.trim());
    let node = out;
    for (const p of parts) {
      if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) {
        node[p] = {};
      }
      node = node[p];
    }
    return node;
  }

  for (let raw of lines) {
    // strip comments
    let line = raw;
    let inStr = false, quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === quote) inStr = false;
      } else if (c === '"' || c === "'") {
        inStr = true; quote = c;
      } else if (c === '#') {
        line = line.slice(0, i);
        break;
      }
    }
    line = line.trim();
    if (!line) continue;

    // Section header
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) { cursor = setSection(sec[1]); continue; }

    // Array-of-tables [[foo]] — treat as regular section for simplicity
    const arrSec = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrSec) { cursor = setSection(arrSec[1]); continue; }

    // Key = Value
    const kv = line.match(/^([A-Za-z0-9_\-."]+)\s*=\s*(.+)$/);
    if (kv) {
      const key = kv[1].replace(/^"|"$/g, '');
      cursor[key] = parseTomlValue(kv[2].trim());
    }
  }
  return out;
}

function parseTomlValue(v) {
  if (!v) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelCsv(inner).map(parseTomlValue);
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    const obj = {};
    for (const part of splitTopLevelCsv(inner)) {
      const m = part.match(/^([A-Za-z0-9_\-]+)\s*=\s*(.+)$/);
      if (m) obj[m[1]] = parseTomlValue(m[2].trim());
    }
    return obj;
  }
  return v;
}

// Split a comma-separated list respecting nested [] {} and quoted strings.
function splitTopLevelCsv(s) {
  const out = [];
  let depth = 0, inStr = false, quote = '';
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      buf += c;
      if (c === '\\') { buf += s[++i] || ''; continue; }
      if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true; quote = c; buf += c;
    } else if (c === '[' || c === '{') { depth++; buf += c; }
    else if (c === ']' || c === '}') { depth--; buf += c; }
    else if (c === ',' && depth === 0) {
      out.push(buf.trim()); buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Very minimal YAML parser — handles the flat K/V + simple sequences we need
 * for pubspec.yaml and pnpm-workspace.yaml.
 *   key: value
 *   key:
 *     nested: value
 *   packages:
 *     - apps/*
 *     - packages/*
 *
 * Design: each stack frame represents "we are inside the block opened by key X
 * at indent N". Before writing the first child, we lazily decide whether the
 * block is an array (if first child is `- item`) or an object (if first child
 * is `key: value`).
 *
 * Returns {} on failure.
 */
function parseYamlLite(src) {
  if (!src) return {};
  const lines = src.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const root = {};
  // Stack frame: { indent, parentNode, parentKey, child }
  //   parentNode[parentKey] is what we're filling in.
  //   child is lazily created as {} or [] on first item.
  const stack = [{ indent: -1, parentNode: { __root: root }, parentKey: '__root', child: root }];

  function top() { return stack[stack.length - 1]; }

  function ensureChildObj() {
    const t = top();
    if (!t.child || Array.isArray(t.child)) {
      t.child = {};
      t.parentNode[t.parentKey] = t.child;
    }
  }

  function ensureChildArr() {
    const t = top();
    if (!Array.isArray(t.child)) {
      t.child = [];
      t.parentNode[t.parentKey] = t.child;
    }
  }

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indentMatch = line.match(/^(\s*)(.*)$/);
    const indent = indentMatch[1].length;
    const content = indentMatch[2];

    // Unwind to the frame whose indent is strictly less than this line's.
    while (stack.length > 1 && top().indent >= indent) stack.pop();

    // Array item inside current block
    if (content.startsWith('- ')) {
      ensureChildArr();
      const val = content.slice(2).trim();
      top().child.push(stripYamlString(val));
      continue;
    }

    const m = content.match(/^([A-Za-z0-9_\-.]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2];

    ensureChildObj();
    const parentChild = top().child;

    if (rest === '') {
      // Nested block — push new frame; don't pre-allocate.
      parentChild[key] = {};  // tentative; will become [] if array items follow
      stack.push({
        indent, parentNode: parentChild, parentKey: key, child: parentChild[key],
      });
    } else {
      parentChild[key] = stripYamlString(rest);
    }
  }
  return root;
}

function stripYamlString(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * Parse a .env-style file and return ONLY the keys (for .env.example style files
 * where values are placeholders). Never returns values.
 */
function parseEnvKeys(src) {
  if (!src) return [];
  const keys = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/**
 * Walk a repo looking for any file whose basename is in `targets`.
 * Respects a small skip list (node_modules, .git, build output dirs).
 * Returns absolute paths.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.shipfast', 'target', 'dist', 'build', 'out',
  '.next', '.nuxt', '.svelte-kit', '.output', '.venv', 'venv', '__pycache__',
  'vendor', 'Pods', 'DerivedData', '.gradle', '.idea', '.vscode',
]);

function findManifests(root, targets, maxFiles = 500, { suffix = null } = {}) {
  const wanted = new Set(targets);
  const out = [];
  function walk(dir, depth) {
    if (depth > 8 || out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        if (wanted.has(e.name) || (suffix && e.name.endsWith(suffix))) {
          out.push(full);
        }
      }
    }
  }
  walk(root, 0);
  return out;
}

module.exports = {
  safeReadFile,
  safeJsonParse,
  stripJsonComments,
  parseTomlLite,
  parseYamlLite,
  parseEnvKeys,
  findManifests,
};
