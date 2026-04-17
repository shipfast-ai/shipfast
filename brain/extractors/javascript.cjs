/**
 * JavaScript / TypeScript extractor.
 * Handles: .js .jsx .ts .tsx .mjs .cjs
 *
 * Symbols emitted: function, type, class. Imports deduped per file.
 * Supports tsconfig.json / jsconfig.json path aliases.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

const EXT_CANDIDATES = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs',
];

const IMPORT_PATTERNS = [
  /import\s+(?:type\s+)?(?:\{[^}]+\}|\w+)\s+from\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /import\s+(?:type\s+)?\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g,
  /import\s+(?:type\s+)?\w+\s*,\s*\{[^}]+\}\s+from\s+['"]([^'"]+)['"]/g,
  /export\s+(?:type\s+)?\{[^}]+\}\s+from\s+['"]([^'"]+)['"]/g,
  /export\s+\*(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const FUNC_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))[^{]*/g,
  /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(\([^)]*\))\s*(?::\s*\S+\s*)?=>/g,
];

const TYPE_RE = /(?:export\s+)?(?:type|interface)\s+(\w+)(?:<[^>]+>)?\s*[={]/g;
const CLASS_RE = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;

// ---- tsconfig alias support ----

const _aliasCache = new Map();

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

function compileAliasPattern(key) {
  const star = key.indexOf('*');
  if (star === -1) {
    return new RegExp('^' + key.replace(/[.+?^${}()|[\]\\]/g, '\\$&') + '$');
  }
  const prefix = key.slice(0, star).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const suffix = key.slice(star + 1).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + prefix + '(.*)' + suffix + '$');
}

function loadConfig(cwd) {
  if (_aliasCache.has(cwd)) return _aliasCache.get(cwd);
  let aliases = null;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const full = path.join(cwd, name);
    if (!fs.existsSync(full)) continue;
    try {
      const raw = fs.readFileSync(full, 'utf8');
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { parsed = JSON.parse(stripJsonComments(raw)); }
      const opts = parsed && parsed.compilerOptions;
      if (!opts) continue;
      const baseUrl = opts.baseUrl || '.';
      const paths = opts.paths || {};
      const compiled = Object.entries(paths).map(([key, repls]) => ({
        pattern: compileAliasPattern(key),
        replacements: Array.isArray(repls) ? repls : [],
      }));
      aliases = { baseUrl, paths: compiled };
      break;
    } catch { /* bad config — skip */ }
  }
  _aliasCache.set(cwd, aliases);
  return aliases;
}

// ---- resolve import to a file on disk (best-effort) ----

function tryResolveFile(cwd, rel) {
  if (!cwd) return null;
  for (const ext of EXT_CANDIDATES) {
    const candidate = rel + ext;
    if (fs.existsSync(path.join(cwd, candidate))) return candidate.replace(/\\/g, '/');
  }
  return null;
}

function applyAlias(importPath, aliases, cwd) {
  if (!aliases || !aliases.paths.length) return null;
  for (const { pattern, replacements } of aliases.paths) {
    const m = importPath.match(pattern);
    if (!m) continue;
    const captured = m[1] != null ? m[1] : '';
    for (const repl of replacements) {
      const rel = path.join(aliases.baseUrl || '.', repl.replace(/\*/g, captured)).replace(/\\/g, '/');
      const resolved = tryResolveFile(cwd, rel);
      if (resolved) return resolved;
    }
    // Alias matched but no file on disk — still record first candidate
    return path.join(aliases.baseUrl || '.', replacements[0].replace(/\*/g, captured)).replace(/\\/g, '/');
  }
  return null;
}

function resolveImport(fromFile, importPath, ctx) {
  const cwd = ctx && ctx.cwd;
  const aliases = ctx && ctx.aliases;
  if (aliases && !importPath.startsWith('.')) {
    const aliased = applyAlias(importPath, aliases, cwd);
    if (aliased) return aliased;
  }
  const base = path.join(path.dirname(fromFile), importPath).replace(/\\/g, '/');
  const resolved = tryResolveFile(cwd, base);
  return resolved || base;
}

function isLocalImport(target) {
  return target.startsWith('.') || target.startsWith('@') || target.startsWith('~') || target.startsWith('#');
}

// ---- extraction ----

function extract(content, filePath, ctx) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  // Imports
  for (const pattern of IMPORT_PATTERNS) {
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(content)) !== null) {
      const target = m[1];
      if (!isLocalImport(target)) continue;
      const resolved = resolveImport(filePath, target, ctx);
      emit(`file:${filePath}`, `file:${resolved}`, 'imports');
    }
  }

  // Functions
  for (const pattern of FUNC_PATTERNS) {
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(content)) !== null) {
      const lineNum = content.slice(0, m.index).split('\n').length;
      const name = m[1];
      const params = m[2] || '';
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `fn:${filePath}:${name}`, kind: 'function', name,
        file_path: filePath, line_start: lineNum, line_end: endLine,
        signature: `${name}${params}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
      });
    }
  }

  // Types / interfaces
  TYPE_RE.lastIndex = 0;
  let mt;
  while ((mt = TYPE_RE.exec(content)) !== null) {
    const lineNum = content.slice(0, mt.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `type:${filePath}:${mt[1]}`, kind: 'type', name: mt[1],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `type ${mt[1]}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
  }

  // Classes
  CLASS_RE.lastIndex = 0;
  let mc;
  while ((mc = CLASS_RE.exec(content)) !== null) {
    const lineNum = content.slice(0, mc.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `class:${filePath}:${mc[1]}`, kind: 'class', name: mc[1],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `class ${mc[1]}${mc[2] ? ` extends ${mc[2]}` : ''}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
    if (mc[2]) {
      emit(`class:${filePath}:${mc[1]}`, `class:*:${mc[2]}`, 'extends');
    }
  }

  return { nodes, edges };
}

module.exports = {
  extensions: EXTENSIONS,
  extract,
  resolveImport,
  loadConfig,
  // exported for tests
  _internals: { stripJsonComments, compileAliasPattern, applyAlias },
};
