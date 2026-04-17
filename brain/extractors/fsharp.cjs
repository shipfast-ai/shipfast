/**
 * F# extractor.
 * Handles: .fs .fsx
 *
 * F# uses the off-side rule (indent-based). Block-end detection is lenient;
 * symbol names remain accurate even when line_end is approximate.
 */

'use strict';

const { hashContent, findIndentBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.fs', '.fsx'];

const LET_RE = /^(\s*)let\s+(?:rec\s+|mutable\s+|inline\s+)?(\w+)(?:\s*(?:<[^>]+>)?\s*((?:\s+\w+|\s+\([^)]*\))+))?(?:\s*:\s*[^=\n]+)?\s*=/gm;
const TYPE_RE = /^(\s*)type\s+(\w+)(?:\s*<[^>]+>)?\s*(?:=|\()/gm;
const MODULE_RE = /^(\s*)module\s+(\w+)/gm;
const MEMBER_RE = /^(\s*)member\s+\w+\.(\w+)\s*\(([^)]*)\)/gm;
const OPEN_RE = /^\s*open\s+([\w.]+)/gm;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function push(re, kind, sigFn, isFn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const indent = m[1].length;
      const name = m[2];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findIndentBlock(lines, lineNum - 1, indent);
      nodes.push({
        id: `${isFn ? 'fn' : 'type'}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

  push(LET_RE, 'function', (m) => `let ${m[2]}${(m[3] || '').slice(0, 60)}`, true);
  push(TYPE_RE, 'type', (m) => `type ${m[2]}`, false);
  push(MODULE_RE, 'type', (m) => `module ${m[2]}`, false);
  push(MEMBER_RE, 'function', (m) => `member ${m[2]}(${(m[3] || '').slice(0, 60)})`, true);

  OPEN_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
