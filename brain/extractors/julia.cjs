/**
 * Julia extractor.
 * Handles: .jl
 *
 * Uses keyword-based block detection. Julia openers closed by `end`:
 * function, struct, module, if, for, while, let, try, begin, do, quote, macro, abstract, mutable.
 */

'use strict';

const { hashContent, findKeywordBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.jl'];

const NESTED_OPENERS = ['function', 'struct', 'module', 'if', 'for', 'while',
  'let', 'try', 'begin', 'do', 'quote', 'macro'];

// Multi-line function: function name(...) ... end
const FN_RE = /^\s*function\s+([A-Za-z_!][\w.]*)\s*(?:\{[^}]+\})?\s*\(([^)]*)\)/gm;
// One-line: name(args) = expr
const FN_SHORT_RE = /^\s*([A-Za-z_!]\w*)\s*\(([^)]*)\)\s*=\s*[^=\n]/gm;
const STRUCT_RE = /^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/gm;
const ABSTRACT_RE = /^\s*abstract\s+type\s+([A-Za-z_]\w*)/gm;
const PRIMITIVE_RE = /^\s*primitive\s+type\s+([A-Za-z_]\w*)/gm;
const MODULE_RE = /^\s*module\s+([A-Za-z_]\w*)/gm;
const USING_RE = /^\s*using\s+([A-Za-z_][\w.]*)/gm;
const IMPORT_RE = /^\s*import\s+([A-Za-z_][\w.]*)/gm;
const INCLUDE_RE = /\binclude\s*\(\s*"([^"]+)"/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  // Multi-line functions (block)
  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(content)) !== null) {
    const full = m[1];
    const name = full.split('.').pop();
    const params = m[2];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS);
    nodes.push({
      id: `fn:${filePath}:${full}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `function ${full}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  // Short-form functions
  FN_SHORT_RE.lastIndex = 0;
  while ((m = FN_SHORT_RE.exec(content)) !== null) {
    const name = m[1];
    // Skip if already recorded by long-form
    if (nodes.some(n => n.id === `fn:${filePath}:${name}`)) continue;
    const params = m[2];
    const lineNum = content.slice(0, m.index).split('\n').length;
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: lineNum,
      signature: `${name}(${params.slice(0, 60)}) = …`,
      hash: '',
    });
  }

  function pushType(re, prefix, hasBlock) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(content)) !== null) {
      const name = x[1];
      const lineNum = content.slice(0, x.index).split('\n').length;
      const endLine = hasBlock ? findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS) : lineNum;
      nodes.push({
        id: `type:${filePath}:${name}`, kind: 'type', name,
        file_path: filePath, line_start: lineNum, line_end: endLine,
        signature: `${prefix} ${name}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }
  pushType(STRUCT_RE, 'struct', true);
  pushType(MODULE_RE, 'module', true);
  pushType(ABSTRACT_RE, 'abstract type', false);
  pushType(PRIMITIVE_RE, 'primitive type', false);

  USING_RE.lastIndex = 0;
  while ((m = USING_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  INCLUDE_RE.lastIndex = 0;
  while ((m = INCLUDE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
