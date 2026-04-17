/**
 * Rust extractor.
 * Handles: .rs
 *
 * Symbols emitted: function, type (struct/enum/trait). Imports recorded as
 * module-kind edges because Rust module paths don't map 1:1 to files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { hashContent, findBraceBlock, makeEdgeEmitter, emitCalls } = require('./_common.cjs');

const RUST_NON_CALL_KEYWORDS = new Set([
  'if','else','for','while','loop','match','let','const','fn','struct','impl','enum',
  'trait','mod','use','pub','return','unsafe','move','ref','as','type','where','async',
  'await','dyn','self','Self','super','crate','in','true','false','static','mut',
  'Box','Vec','Option','Some','None','Result','Ok','Err','String','println','print',
  'vec','format','write','writeln','panic','assert','debug_assert','unreachable',
  'todo','unimplemented','eprintln','dbg','drop','break','continue',
]);

const EXTENSIONS = ['.rs'];

const FN_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*(\([^)]*\))(?:\s*->\s*([^\s{]+))?/g;
const STRUCT_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w+)/g;
const ENUM_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w+)/g;
const TRAIT_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+(\w+)/g;
const TYPE_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?type\s+(\w+)\s*=/g;
const USE_RE = /(?:pub\s+)?(?:use|mod)\s+([A-Za-z_][\w:]*)/g;
// Detailed use-path capture for cross-file call resolution:
//   use crate::foo::bar;         → imports `bar` from crate::foo
//   use crate::foo::bar as baz;  → imports `baz` (alias)
//   use crate::foo::{a, b, c};   → imports a, b, c
const USE_PATH_RE   = /\buse\s+([a-zA-Z_][\w:]*)::(\w+)(?:\s+as\s+(\w+))?\s*;/g;
const USE_GROUP_RE  = /\buse\s+([a-zA-Z_][\w:]*)::\{([^}]+)\}\s*;/g;

function resolveImport(fromFile, importPath /* , ctx */) {
  // Rust's module resolution requires crate layout; we just record the module path.
  return importPath;
}

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function push(pattern, kind, sigPrefix) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      const sig = sigPrefix === 'fn'
        ? `fn ${name}${m[2] || ''}${m[3] ? ` -> ${m[3]}` : ''}`
        : `${sigPrefix} ${name}`;
      nodes.push({
        id: `${kind === 'function' ? 'fn' : 'type'}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sig,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

  push(FN_RE, 'function', 'fn');
  push(STRUCT_RE, 'type', 'struct');
  push(ENUM_RE, 'type', 'enum');
  push(TRAIT_RE, 'type', 'trait');
  push(TYPE_RE, 'type', 'type');

  USE_RE.lastIndex = 0;
  let um;
  while ((um = USE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${um[1]}`, 'imports');
  }

  // Cross-file call resolution via `use` paths. Rust modules don't map 1:1
  // to files without Cargo knowledge, so we store the FQN (crate::mod::name)
  // as the edge target. brain_impact/trace still traverses it as a string id.
  const importedSymbols = {};
  USE_PATH_RE.lastIndex = 0;
  let up;
  while ((up = USE_PATH_RE.exec(content)) !== null) {
    const mod = up[1], name = up[2], alias = up[3] || up[2];
    importedSymbols[alias] = `rust:${mod}::${name}`;
  }
  USE_GROUP_RE.lastIndex = 0;
  while ((up = USE_GROUP_RE.exec(content)) !== null) {
    const mod = up[1];
    for (const part of up[2].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const asMatch = p.match(/^(\w+)\s+as\s+(\w+)$/);
      const bare = p.match(/^(\w+)$/);
      const name  = asMatch ? asMatch[1] : (bare && bare[1]);
      const alias = asMatch ? asMatch[2] : name;
      if (name) importedSymbols[alias] = `rust:${mod}::${name}`;
    }
  }

  emitCalls({ content, lines, fnNodes: nodes, importedSymbols, filePath, emit, nonCallKeywords: RUST_NON_CALL_KEYWORDS });
  return { nodes, edges };
}

module.exports = {
  extensions: EXTENSIONS,
  extract,
  resolveImport,
};
