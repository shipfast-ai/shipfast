/**
 * Python extractor.
 * Handles: .py .pyw
 *
 * Symbols emitted: function, class. Scope is determined by indentation.
 * Imports that start with '.' are treated as local; others are skipped
 * (they usually point to installed packages, not project files).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { hashContent, findIndentBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.py', '.pyw'];

const FN_RE = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
const CLASS_RE = /^(\s*)class\s+(\w+)(?:\(([^)]*)\))?:/gm;
const IMPORT_RE = /^(\s*)(?:from\s+(\.[.\w]*)\s+)?import\s+(.+)/gm;

function resolveImport(fromFile, importPath, ctx) {
  const cwd = ctx && ctx.cwd;
  const dir = path.dirname(fromFile);
  // Count leading dots for relative imports
  let dots = 0;
  while (dots < importPath.length && importPath[dots] === '.') dots++;
  if (dots === 0) return importPath;

  // Go up `dots - 1` levels from fromFile's directory
  const parts = dir.split('/');
  const up = parts.slice(0, Math.max(0, parts.length - (dots - 1)));
  const rest = importPath.slice(dots).replace(/\./g, '/');
  const base = rest ? `${up.join('/')}/${rest}` : up.join('/');

  if (cwd) {
    for (const ext of ['.py', '/__init__.py']) {
      if (fs.existsSync(path.join(cwd, base + ext))) return (base + ext).replace(/\\/g, '/');
    }
  }
  return base.replace(/\\/g, '/');
}

function extract(content, filePath, ctx) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(content)) !== null) {
    const indent = m[1].length;
    const name = m[2];
    const params = m[3];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findIndentBlock(lines, lineNum - 1, indent);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `def ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(content)) !== null) {
    const indent = m[1].length;
    const name = m[2];
    const bases = m[3];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findIndentBlock(lines, lineNum - 1, indent);
    nodes.push({
      id: `class:${filePath}:${name}`, kind: 'class', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `class ${name}${bases ? `(${bases})` : ''}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const fromClause = m[2];
    const targets = m[3];
    if (fromClause && fromClause.startsWith('.')) {
      const resolved = resolveImport(filePath, fromClause, ctx);
      emit(`file:${filePath}`, `file:${resolved}`, 'imports');
    } else if (!fromClause) {
      // `import X` with no `from` — only tracked when relative (rare). Skip.
    }
  }

  return { nodes, edges };
}

module.exports = {
  extensions: EXTENSIONS,
  extract,
  resolveImport,
};
