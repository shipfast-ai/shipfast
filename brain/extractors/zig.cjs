/**
 * Zig extractor.
 * Handles: .zig
 *
 * Zig types are typically anonymous structs assigned to `const Name = struct { … }`.
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.zig'];

const FN_RE = /(?:pub\s+|export\s+|extern\s+|inline\s+|noinline\s+|\s)*fn\s+(\w+)\s*\(([^)]*)\)/g;
const TYPE_RE = /(?:pub\s+)?const\s+(\w+)\s*=\s*(struct|enum|union|error)(?:\s|\{)/g;
const IMPORT_RE = /@import\s*\(\s*"([^"]+)"\s*\)/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(content)) !== null) {
    const name = m[1];
    const params = m[2];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `fn ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  TYPE_RE.lastIndex = 0;
  while ((m = TYPE_RE.exec(content)) !== null) {
    const name = m[1];
    const kind = m[2];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `const ${name} = ${kind}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
