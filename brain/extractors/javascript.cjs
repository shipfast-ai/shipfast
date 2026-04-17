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
const CLASS_RE = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+?))?\s*\{/g;

// Import patterns that also capture the imported NAMES (not just the module path).
// Used to build a local map { importedName → resolvedTargetFile } so that calls
// to imported symbols become cross-file `calls` edges.
const NAMED_IMPORT_RE     = /import\s+(?:(?:[A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
const DEFAULT_IMPORT_RE   = /import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[^}]+\})?\s+from\s+['"]([^'"]+)['"]/g;
const CJS_DESTRUCTURE_RE  = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const CJS_DEFAULT_RE      = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// `export` detection — any of:
//   export function Foo / export class Foo / export const Foo / export type Foo
//   export default function Foo / export default class Foo
//   module.exports = Foo  |  module.exports.Foo = …
//   export { Foo, Bar as Baz }
const EXPORT_NAMED_RE = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
const EXPORT_CJS_RE = /\bmodule\.exports(?:\.(\w+))?\s*=/g;
const EXPORT_BLOCK_RE = /\bexport\s*\{([^}]+)\}/g;

// `calls` detection — any identifier followed by `(` that isn't a
// control-flow keyword or declaration. Scoped to same-file only for safety.
const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const NON_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'new', 'throw', 'await', 'yield', 'delete', 'void', 'in', 'of', 'as',
  'function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var',
  'import', 'export', 'from', 'require', 'async', 'default', 'do', 'else',
  'try', 'finally', 'break', 'continue', 'case', 'with', 'this', 'super',
  'true', 'false', 'null', 'undefined'
]);

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

  // Imports (file-level edges)
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

  // Build a symbol table for cross-file call resolution:
  //   importedSymbols[name] = resolved target file path (relative)
  // Only tracks local imports (./foo, @/foo, ~/foo, #/foo). NPM packages
  // are intentionally skipped — they aren't in the graph anyway.
  const importedSymbols = {};
  function addSym(name, mod) {
    if (!name || !mod || !isLocalImport(mod)) return;
    const resolved = resolveImport(filePath, mod, ctx);
    if (resolved) importedSymbols[name] = resolved;
  }
  NAMED_IMPORT_RE.lastIndex = 0;
  let mi;
  while ((mi = NAMED_IMPORT_RE.exec(content)) !== null) {
    for (const part of mi[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      // `Orig as Alias` → importedSymbols has { Alias: mod } (alias is what the caller will use)
      const [, , alias] = p.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/) || [];
      const bare = p.match(/^([A-Za-z_$][\w$]*)$/);
      addSym(alias || (bare && bare[1]), mi[2]);
    }
  }
  DEFAULT_IMPORT_RE.lastIndex = 0;
  while ((mi = DEFAULT_IMPORT_RE.exec(content)) !== null) addSym(mi[1], mi[2]);
  CJS_DESTRUCTURE_RE.lastIndex = 0;
  while ((mi = CJS_DESTRUCTURE_RE.exec(content)) !== null) {
    for (const part of mi[1].split(',')) {
      const name = part.trim().split(/\s*:\s*/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) addSym(name, mi[2]);
    }
  }
  CJS_DEFAULT_RE.lastIndex = 0;
  while ((mi = CJS_DEFAULT_RE.exec(content)) !== null) addSym(mi[1], mi[2]);

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
    if (mc[3]) {
      for (const iface of mc[3].split(',')) {
        const name = iface.trim();
        if (name) emit(`class:${filePath}:${mc[1]}`, `type:*:${name}`, 'implements');
      }
    }
  }

  // Exports — named declarations, CJS, and re-export blocks.
  EXPORT_NAMED_RE.lastIndex = 0;
  let me_;
  while ((me_ = EXPORT_NAMED_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `symbol:${filePath}:${me_[1]}`, 'exports');
  }
  EXPORT_CJS_RE.lastIndex = 0;
  while ((me_ = EXPORT_CJS_RE.exec(content)) !== null) {
    const name = me_[1] || 'default';
    emit(`file:${filePath}`, `symbol:${filePath}:${name}`, 'exports');
  }
  EXPORT_BLOCK_RE.lastIndex = 0;
  while ((me_ = EXPORT_BLOCK_RE.exec(content)) !== null) {
    for (const part of me_[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && /^\w+$/.test(name)) {
        emit(`file:${filePath}`, `symbol:${filePath}:${name}`, 'exports');
      }
    }
  }

  // Calls — same-file only. For each function node, scan its body lines for
  // identifier calls that match another function node declared in this file.
  const fnIds = new Map(); // name -> node id
  for (const n of nodes) if (n.kind === 'function') fnIds.set(n.name, n.id);
  // Skip call-graph extraction on minified/bundled files. They have hundreds
  // of single-letter function names, which triggers O(n²) bogus edges.
  const looksMinified =
    fnIds.size > 200                                                     // too many fns in one file
    || /\.min\.|\.bundle\.|\.chunk\./.test(filePath)                     // minified by filename
    || (content.length > 50_000 && lines.length > 0                      // dense long-line ratio
        && content.length / lines.length > 400);
  if ((fnIds.size >= 2 || Object.keys(importedSymbols).length > 0) && !looksMinified) {
    for (const caller of nodes) {
      if (caller.kind !== 'function') continue;
      const body = lines.slice(caller.line_start - 1, caller.line_end).join('\n');
      CALL_RE.lastIndex = 0;
      const seen = new Set();
      let mCall;
      while ((mCall = CALL_RE.exec(body)) !== null) {
        const callee = mCall[1];
        if (callee === caller.name) continue;        // self-recursion, skip
        if (NON_CALL_KEYWORDS.has(callee)) continue; // keywords
        if (seen.has(callee)) continue;              // dedupe per caller
        seen.add(callee);
        // 1) Same-file function → direct edge.
        const sameFile = fnIds.get(callee);
        if (sameFile) { emit(caller.id, sameFile, 'calls'); continue; }
        // 2) Imported symbol → edge to fn in target file (may not exist yet if
        //    target file isn't indexed yet; brain_impact/trace still traverses
        //    edges by string id).
        const targetFile = importedSymbols[callee];
        if (targetFile) {
          emit(caller.id, `fn:${targetFile}:${callee}`, 'calls');
        }
      }
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
