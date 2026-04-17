/**
 * Ruby extractor.
 * Handles: .rb
 *
 * Uses keyword-based block detection (def/class/module … end).
 * Ruby openers that may nest within a def/class: do, if, unless, case, begin, while, until, for.
 */

'use strict';

const { hashContent, findKeywordBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.rb'];

const NESTED_OPENERS = ['def', 'class', 'module', 'do', 'begin', 'case', 'if', 'unless', 'while', 'until', 'for'];

const DEF_RE = /^\s*def\s+(?:self\.|[A-Z]\w*\.)?([a-z_][\w?!=]*)\s*(\([^)]*\))?/gm;
const CLASS_RE = /^\s*class\s+([A-Z]\w*)(?:\s*<\s*([\w:]+))?/gm;
const MODULE_RE = /^\s*module\s+([A-Z]\w*)/gm;
const REQUIRE_RE = /\b(?:require|require_relative|load|autoload)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function pushBlock(re, kind, sigFn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS);
      const id = (kind === 'function' ? 'fn:' : kind === 'class' ? 'class:' : 'type:') + `${filePath}:${name}`;
      nodes.push({
        id, kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (kind === 'class' && m[2]) {
        emit(`class:${filePath}:${name}`, `class:*:${m[2]}`, 'extends');
      }
    }
  }

  pushBlock(DEF_RE, 'function', (m) => `def ${m[1]}${(m[2] || '').slice(0, 60)}`);
  pushBlock(CLASS_RE, 'class', (m) => `class ${m[1]}${m[2] ? ` < ${m[2]}` : ''}`);
  pushBlock(MODULE_RE, 'type', (m) => `module ${m[1]}`);

  REQUIRE_RE.lastIndex = 0;
  let m;
  while ((m = REQUIRE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
