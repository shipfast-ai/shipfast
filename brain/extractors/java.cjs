/**
 * Java extractor.
 * Handles: .java
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.java'];

// class X | abstract class X | final class X | sealed class X
const CLASS_RE = /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+)*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+([\w.<>, ]+?))?(?=\s*(?:implements|\{))/g;
const INTERFACE_RE = /(?:public\s+|private\s+|protected\s+|static\s+|sealed\s+|non-sealed\s+)*interface\s+(\w+)(?:\s*<[^>]+>)?/g;
const ENUM_RE = /(?:public\s+|private\s+|protected\s+|static\s+)*enum\s+(\w+)/g;
const RECORD_RE = /(?:public\s+|private\s+|protected\s+|static\s+)*record\s+(\w+)\s*\([^)]*\)/g;
// Method: <modifiers> ReturnType X(...) [throws ...] { — require `{` or `;` after close paren
const METHOD_RE = /(?:public|private|protected|static|final|abstract|synchronized|native|default|@\w+(?:\([^)]*\))?|\s)+(?:<[^>]+>\s+)?([A-Za-z_][\w.<>\[\], ?]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*throws\s+[^{;]+)?\s*[{;]/g;
const IMPORT_RE = /\bimport\s+(?:static\s+)?([\w.*]+);/g;
// Java `class Foo … implements A, B<X>, C` — captures class name and the
// comma-separated interface list. Runs after CLASS_RE so it complements it.
const IMPLEMENTS_RE = /\bclass\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+[\w.<>, ]+?)?\s+implements\s+([\w.<>, ]+?)\s*\{/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function pushType(re, prefix) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `${prefix === 'class' ? 'class' : 'type'}:${filePath}:${name}`,
        kind: prefix === 'class' ? 'class' : 'type',
        name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: `${prefix} ${name}${m[2] ? ` extends ${m[2].trim()}` : ''}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (m[2]) emit(`class:${filePath}:${name}`, `class:*:${m[2].trim().split(/[\s<]/)[0]}`, 'extends');
    }
  }

  pushType(CLASS_RE, 'class');
  pushType(INTERFACE_RE, 'interface');
  pushType(ENUM_RE, 'enum');
  pushType(RECORD_RE, 'record');

  METHOD_RE.lastIndex = 0;
  let m;
  while ((m = METHOD_RE.exec(content)) !== null) {
    const returnType = (m[1] || '').trim();
    const name = m[2];
    const params = m[3];
    // Filter out constructors-as-class-refs and control-keyword false matches
    if (['if', 'while', 'for', 'switch', 'return', 'catch', 'synchronized'].includes(returnType)) continue;
    if (['if', 'while', 'for', 'switch', 'return', 'catch'].includes(name)) continue;
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${returnType} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  // implements edges — one per interface in the list
  IMPLEMENTS_RE.lastIndex = 0;
  while ((m = IMPLEMENTS_RE.exec(content)) !== null) {
    for (const iface of m[2].split(',')) {
      const name = iface.trim().split(/[\s<]/)[0];
      if (name) emit(`class:${filePath}:${m[1]}`, `type:*:${name}`, 'implements');
    }
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
