/**
 * Scala extractor.
 * Handles: .scala .sc
 *
 * Uses brace block detection (Scala 2 style). Scala 3 indent-based programs
 * may have less-accurate end-line detection but symbol names still extract.
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter, emitCalls } = require('./_common.cjs');
const SCALA_NON_CALL_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'match', 'case', 'val', 'var', 'def', 'class', 'object', 'trait', 'package', 'import', 'return', 'throw', 'try', 'catch', 'finally', 'new', 'this', 'super', 'override', 'private', 'protected', 'implicit', 'abstract', 'sealed', 'final', 'lazy', 'yield', 'with', 'extends', 'println', 'print', 'type', 'forSome', 'true', 'false', 'null', 'Nothing', 'Any', 'AnyRef', 'AnyVal', 'String', 'Int', 'Long', 'Boolean', 'Seq', 'List', 'Set', 'Map', 'Option', 'Some', 'None'
]);


const EXTENSIONS = ['.scala', '.sc'];

const DEF_RE = /(?:^|\n)[ \t]*(?:override\s+|private\s+|protected\s+|public\s+|final\s+|implicit\s+|inline\s+|\s)*def\s+(\w+)\s*(?:\[[^\]]+\])?\s*(\([^)]*\))?/g;
const CLASS_RE = /(?:^|\n)[ \t]*(?:abstract\s+|final\s+|sealed\s+|case\s+|\s)*class\s+(\w+)(?:\s*\[[^\]]+\])?(?:\s*\([^)]*\))?(?:\s+extends\s+([\w.]+))?/g;
const OBJECT_RE = /(?:^|\n)[ \t]*(?:case\s+|\s)*object\s+(\w+)/g;
const TRAIT_RE = /\btrait\s+(\w+)/g;
const ENUM_RE = /\benum\s+(\w+)/g;  // Scala 3
const IMPORT_RE = /^\s*import\s+([\w.{}*, ]+)/gm;

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
      nodes.push({
        id: `${kind === 'function' ? 'fn' : isClass ? 'class' : 'type'}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (isClass && m[2]) {
        emit(`class:${filePath}:${name}`, `class:*:${m[2]}`, 'extends');
      }
    }
  }

  push(DEF_RE, 'function', (m) => `def ${m[1]}${(m[2] || '').slice(0, 60)}`, false);
  push(CLASS_RE, 'class', (m) => `class ${m[1]}${m[2] ? ` extends ${m[2]}` : ''}`, true);
  push(OBJECT_RE, 'class', (m) => `object ${m[1]}`, true);
  push(TRAIT_RE, 'type', (m) => `trait ${m[1]}`, false);
  push(ENUM_RE, 'type', (m) => `enum ${m[1]}`, false);

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1].trim().split(/\s+/)[0].replace(/[{}]/g, '');
    emit(`file:${filePath}`, `module:${spec}`, 'imports');
  }

  emitCalls({ content, lines, fnNodes: nodes, importedSymbols: {}, filePath, emit, nonCallKeywords: SCALA_NON_CALL_KEYWORDS });
  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
