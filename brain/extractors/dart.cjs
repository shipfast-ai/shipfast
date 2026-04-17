/**
 * Dart / Flutter extractor.
 * Handles: .dart
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.dart'];

// Function with an explicit return type. Captures return type, name, params.
const FN_RE = /(?:^|\n)[ \t]*(?:static\s+|external\s+|abstract\s+|@\w+(?:\([^)]*\))?|\s)*([A-Za-z_][\w<>, ?]*?)\s+(\w+)\s*\(([^)]*)\)\s*(?:async\*?\s+|sync\*?\s+)?\{/g;
const CLASS_RE = /(?:abstract\s+|base\s+|final\s+|sealed\s+|interface\s+|\s)*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s+extends\s+([\w<>, ]+?))?(?:\s+with\s+[\w<>, ]+)?(?:\s+implements\s+[\w<>, ]+)?\s*\{/g;
const MIXIN_RE = /\bmixin\s+(\w+)/g;
const EXTENSION_RE = /\bextension\s+(\w+)/g;
const TYPEDEF_RE = /\btypedef\s+(\w+)\s*=/g;
const IMPORT_RE = /\bimport\s+['"]([^'"]+)['"]/g;

const CONTROL = new Set(['if', 'while', 'for', 'switch', 'return', 'sizeof', 'catch', 'try', 'assert']);

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(content)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    const params = m[3];
    if (CONTROL.has(name) || CONTROL.has(returnType)) continue;
    if (returnType === 'new') continue;  // false match inside ctor body
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${returnType} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  function push(re, kind, sigFn, isClass) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(content)) !== null) {
      const name = x[1];
      const lineNum = content.slice(0, x.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `${isClass ? 'class' : 'type'}:${filePath}:${name}`,
        kind: isClass ? 'class' : 'type', name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(x),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (isClass && x[2]) {
        const base = x[2].trim().split(/[\s<,]/)[0];
        if (base) emit(`class:${filePath}:${name}`, `class:*:${base}`, 'extends');
      }
    }
  }

  push(CLASS_RE, 'class', (x) => `class ${x[1]}${x[2] ? ` extends ${x[2].trim()}` : ''}`, true);
  push(MIXIN_RE, 'type', (x) => `mixin ${x[1]}`, false);
  push(EXTENSION_RE, 'type', (x) => `extension ${x[1]}`, false);
  push(TYPEDEF_RE, 'type', (x) => `typedef ${x[1]}`, false);

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
