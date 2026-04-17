/**
 * Kotlin extractor.
 * Handles: .kt .kts
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.kt', '.kts'];

const FN_RE = /(?:public\s+|private\s+|internal\s+|protected\s+|suspend\s+|inline\s+|infix\s+|operator\s+|override\s+|tailrec\s+|external\s+|@\w+(?:\([^)]*\))?|\s)*fun\s+(?:<[^>]+>\s+)?(?:[A-Za-z_][\w.]*\.)?(\w+)\s*\(([^)]*)\)/g;
const CLASS_RE = /(?:public\s+|private\s+|internal\s+|protected\s+|open\s+|final\s+|abstract\s+|sealed\s+|data\s+|inner\s+|enum\s+|annotation\s+|@\w+(?:\([^)]*\))?|\s)*class\s+(\w+)/g;
const OBJECT_RE = /(?:public\s+|private\s+|internal\s+|companion\s+|\s)*object\s+(\w+)/g;
const INTERFACE_RE = /(?:public\s+|private\s+|internal\s+|protected\s+|fun\s+|\s)*interface\s+(\w+)/g;
const TYPEALIAS_RE = /\btypealias\s+(\w+)\s*=/g;
const IMPORT_RE = /^import\s+([\w.*]+)(?:\s+as\s+\w+)?$/gm;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function pushSymbol(re, kind, sigPrefix, isClassKind) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `${isClassKind ? 'class' : kind === 'function' ? 'fn' : 'type'}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigPrefix === 'fn'
          ? `fun ${name}(${(m[2] || '').slice(0, 60)})`
          : `${sigPrefix} ${name}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

  pushSymbol(FN_RE, 'function', 'fn', false);
  pushSymbol(CLASS_RE, 'class', 'class', true);
  pushSymbol(OBJECT_RE, 'class', 'object', true);
  pushSymbol(INTERFACE_RE, 'type', 'interface', false);
  pushSymbol(TYPEALIAS_RE, 'type', 'typealias', false);

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  // Kotlin inheritance: `class Foo(...) : Base(), Iface1, Iface2 { ... }`.
  // The list after `:` contains one optional class (may have `()`) plus 0+
  // interfaces. We emit `extends` for anything with `(...)` and `implements`
  // for the rest — an imperfect-but-useful heuristic.
  const IMPLEMENTS_RE = /\bclass\s+(\w+)(?:\s*<[^>]+>)?\s*(?:\([^)]*\))?\s*:\s*([^{]+?)\s*\{/g;
  IMPLEMENTS_RE.lastIndex = 0;
  while ((m = IMPLEMENTS_RE.exec(content)) !== null) {
    for (const raw of m[2].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const name = part.split(/[\s<(]/)[0];
      if (!name) continue;
      const kind = part.includes('(') ? 'extends' : 'implements';
      emit(`class:${filePath}:${m[1]}`, `type:*:${name}`, kind);
    }
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
