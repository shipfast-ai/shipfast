/**
 * Go extractor.
 * Handles: .go
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.go'];

// func X(...)  |  func (r *T) X(...)  |  func X[T any](...)
const FN_RE = /\bfunc\s+(?:\([^)]*\)\s+)?(\w+)(?:\s*\[[^\]]+\])?\s*\(([^)]*)\)/g;
const STRUCT_RE = /\btype\s+(\w+)\s+struct\s*\{/g;
const INTERFACE_RE = /\btype\s+(\w+)\s+interface\s*\{/g;
const TYPEALIAS_RE = /\btype\s+(\w+)\s*=\s*([^\n]+)/g;
const TYPE_RE = /\btype\s+(\w+)\s+([A-Za-z_][\w.]*)\s*$/gm;
const IMPORT_SINGLE = /\bimport\s+(?:\w+\s+)?"([^"]+)"/g;
const IMPORT_BLOCK = /\bimport\s*\(([\s\S]*?)\)/g;
const IMPORT_ITEM = /(?:\w+\s+)?"([^"]+)"/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function pushType(re, prefix, openBrace) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = openBrace ? findBraceBlock(lines, lineNum - 1) : lineNum;
      nodes.push({
        id: `type:${filePath}:${name}`, kind: 'type', name,
        file_path: filePath, line_start: lineNum, line_end: endLine,
        signature: `${prefix} ${name}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

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
      signature: `func ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  pushType(STRUCT_RE, 'struct', true);
  pushType(INTERFACE_RE, 'interface', true);
  pushType(TYPEALIAS_RE, 'type', false);
  pushType(TYPE_RE, 'type', false);

  IMPORT_BLOCK.lastIndex = 0;
  while ((m = IMPORT_BLOCK.exec(content)) !== null) {
    const inside = m[1];
    IMPORT_ITEM.lastIndex = 0;
    let im;
    while ((im = IMPORT_ITEM.exec(inside)) !== null) {
      emit(`file:${filePath}`, `module:${im[1]}`, 'imports');
    }
  }
  IMPORT_SINGLE.lastIndex = 0;
  while ((m = IMPORT_SINGLE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
