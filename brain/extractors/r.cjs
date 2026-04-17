/**
 * R extractor.
 * Handles: .r .R
 *
 * Functions in R are assigned to names. Classes are defined via setClass()
 * (S4) or R6Class() (R6). Both are best-effort — R's semantics require
 * runtime evaluation for full fidelity.
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.r', '.R'];

// name <- function(...) | name = function(...)
const FN_RE = /(?:^|\n)[ \t]*([A-Za-z.][\w.]*)\s*(?:<-|=)\s*function\s*\(([^)]*)\)/g;
const S4_CLASS_RE = /\bsetClass\s*\(\s*["']([A-Za-z.][\w.]*)["']/g;
const R6_CLASS_RE = /\bR6::R6Class\s*\(\s*["']([A-Za-z.][\w.]*)["']/g;
const LIBRARY_RE = /\b(?:library|require)\s*\(\s*["']?([A-Za-z.][\w.]*)["']?\s*\)/g;
const SOURCE_RE = /\bsource\s*\(\s*["']([^"']+)["']/g;

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
      signature: `${name} <- function(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  function pushClass(re, sigPrefix) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(content)) !== null) {
      const name = x[1];
      const lineNum = content.slice(0, x.index).split('\n').length;
      nodes.push({
        id: `class:${filePath}:${name}`, kind: 'class', name,
        file_path: filePath, line_start: lineNum, line_end: lineNum,
        signature: `${sigPrefix} ${name}`, hash: '',
      });
    }
  }
  pushClass(S4_CLASS_RE, 'setClass');
  pushClass(R6_CLASS_RE, 'R6Class');

  LIBRARY_RE.lastIndex = 0;
  while ((m = LIBRARY_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  SOURCE_RE.lastIndex = 0;
  while ((m = SOURCE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
