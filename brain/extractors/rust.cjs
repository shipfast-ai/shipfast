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
const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.rs'];

const FN_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*(\([^)]*\))(?:\s*->\s*([^\s{]+))?/g;
const STRUCT_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w+)/g;
const ENUM_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w+)/g;
const TRAIT_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+(\w+)/g;
const TYPE_RE = /(?:pub(?:\s*\([^)]*\))?\s+)?type\s+(\w+)\s*=/g;
const USE_RE = /(?:pub\s+)?(?:use|mod)\s+([A-Za-z_][\w:]*)/g;

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

  return { nodes, edges };
}

module.exports = {
  extensions: EXTENSIONS,
  extract,
  resolveImport,
};
