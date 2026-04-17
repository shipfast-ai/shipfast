/**
 * Lua extractor.
 * Handles: .lua
 *
 * Lua has no native class system. We extract functions only (including
 * local functions and table-method definitions like `function Mod.foo()`).
 */

'use strict';

const { hashContent, findKeywordBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.lua'];

const NESTED_OPENERS = ['function', 'do', 'then', 'repeat'];
// Lua uses `end` universally; `then` opens blocks closed by `end` too.
const CLOSERS = ['end'];

// function name(...) | function mod.name(...) | function Mod:method(...) | local function name(...)
const FN_RE = /\b(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(([^)]*)\)/g;
const REQUIRE_RE = /\brequire\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(content)) !== null) {
    const fullName = m[1];
    const name = fullName.split(/[.:]/).pop();
    const params = m[2];
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS, CLOSERS);
    nodes.push({
      id: `fn:${filePath}:${fullName}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `function ${fullName}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
