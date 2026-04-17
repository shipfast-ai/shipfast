/**
 * Swift extractor.
 * Handles: .swift
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.swift'];

const FN_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|static\s+|class\s+|override\s+|final\s+|mutating\s+|nonmutating\s+|@\w+(?:\([^)]*\))?|\s)*func\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g;
const CLASS_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|final\s+|@\w+(?:\([^)]*\))?|\s)*class\s+(\w+)/g;
const STRUCT_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|\s)*struct\s+(\w+)/g;
const ENUM_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|indirect\s+|\s)*enum\s+(\w+)/g;
const PROTOCOL_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|\s)*protocol\s+(\w+)/g;
const EXTENSION_RE = /\bextension\s+(\w+)/g;
const ACTOR_RE = /(?:public\s+|private\s+|internal\s+|fileprivate\s+|\s)*actor\s+(\w+)/g;
const TYPEALIAS_RE = /\btypealias\s+(\w+)\s*=/g;
const IMPORT_RE = /^import\s+([A-Za-z_][\w.]*)/gm;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function pushSymbol(re, kind, sigPrefix) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      const sig = sigPrefix === 'fn'
        ? `func ${name}(${(m[2] || '').slice(0, 60)})`
        : `${sigPrefix} ${name}`;
      nodes.push({
        id: `${kind === 'class' ? 'class' : kind === 'function' ? 'fn' : 'type'}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sig,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

  pushSymbol(FN_RE, 'function', 'fn');
  pushSymbol(CLASS_RE, 'class', 'class');
  pushSymbol(STRUCT_RE, 'type', 'struct');
  pushSymbol(ENUM_RE, 'type', 'enum');
  pushSymbol(PROTOCOL_RE, 'type', 'protocol');
  pushSymbol(EXTENSION_RE, 'type', 'extension');
  pushSymbol(ACTOR_RE, 'class', 'actor');
  pushSymbol(TYPEALIAS_RE, 'type', 'typealias');

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
