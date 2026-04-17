/**
 * PHP extractor.
 * Handles: .php
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.php'];

const FN_RE = /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|\s)*function\s+(\w+)\s*\(([^)]*)\)/g;
const CLASS_RE = /(?:final\s+|abstract\s+|readonly\s+|\s)*class\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+[\w\\, ]+)?/g;
const INTERFACE_RE = /\binterface\s+(\w+)/g;
const TRAIT_RE = /\btrait\s+(\w+)/g;
const ENUM_RE = /\benum\s+(\w+)/g;
const USE_RE = /\buse\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/g;
const REQUIRE_RE = /\b(?:require|include|require_once|include_once)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function push(re, kind, sigFn, isClass) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      const prefix = kind === 'function' ? 'fn:' : isClass ? 'class:' : 'type:';
      nodes.push({
        id: `${prefix}${filePath}:${name}`, kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (isClass && m[2]) {
        emit(`class:${filePath}:${name}`, `class:*:${m[2]}`, 'extends');
      }
    }
  }

  push(FN_RE, 'function', (m) => `function ${m[1]}(${(m[2] || '').slice(0, 60)})`, false);
  push(CLASS_RE, 'class', (m) => `class ${m[1]}${m[2] ? ` extends ${m[2]}` : ''}`, true);
  push(INTERFACE_RE, 'type', (m) => `interface ${m[1]}`, false);
  push(TRAIT_RE, 'type', (m) => `trait ${m[1]}`, false);
  push(ENUM_RE, 'type', (m) => `enum ${m[1]}`, false);

  USE_RE.lastIndex = 0;
  let m;
  while ((m = USE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
