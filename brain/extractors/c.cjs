/**
 * C extractor.
 * Handles: .c .h
 *
 * Function extraction is heuristic — guards against common false positives:
 *   - require `{` after close paren (distinguishes definition from prototype)
 *   - skip control keywords (if/while/for/switch/return/sizeof)
 *   - skip preprocessor lines
 *   - strip block comments before scanning
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter, stripBlockComments } = require('./_common.cjs');

const EXTENSIONS = ['.c', '.h'];

const CONTROL_KEYWORDS = new Set([
  'if', 'while', 'for', 'switch', 'return', 'sizeof', 'typeof',
  'case', 'default', 'goto', 'do', 'else',
]);

// Return-type + name + params + '{' on same line or within next 2 lines.
// Capture up to 3 identifiers of return-type (const pointer T), then name, then params.
const FN_RE = /(?:^|\n)[ \t]*(?:static\s+|extern\s+|inline\s+|_Noreturn\s+)*((?:const\s+|unsigned\s+|signed\s+|volatile\s+)*[A-Za-z_][\w]*(?:\s*\*+)?(?:\s+[A-Za-z_][\w]*)*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:\{|\n\s*\{)/g;
const STRUCT_RE = /\bstruct\s+(\w+)\s*\{/g;
const UNION_RE = /\bunion\s+(\w+)\s*\{/g;
const ENUM_RE = /\benum\s+(\w+)\s*\{/g;
const TYPEDEF_RE = /\btypedef\s+[^;]*\b(\w+)\s*;/g;
const INCLUDE_RE = /^\s*#\s*include\s+[<"]([^>"]+)[>"]/gm;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');
  const clean = stripBlockComments(content);

  FN_RE.lastIndex = 0;
  let m;
  while ((m = FN_RE.exec(clean)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    const params = m[3];
    if (CONTROL_KEYWORDS.has(name) || CONTROL_KEYWORDS.has(returnType)) continue;
    const lineNum = clean.slice(0, m.index).split('\n').length;
    // Skip if inside preprocessor line (#define etc.)
    const rawLine = lines[lineNum - 1] || '';
    if (/^\s*#/.test(rawLine)) continue;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${returnType} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  function pushType(re, prefix) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(clean)) !== null) {
      const name = x[1];
      const lineNum = clean.slice(0, x.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `type:${filePath}:${name}`, kind: 'type', name,
        file_path: filePath, line_start: lineNum, line_end: endLine,
        signature: `${prefix} ${name}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }
  pushType(STRUCT_RE, 'struct');
  pushType(UNION_RE, 'union');
  pushType(ENUM_RE, 'enum');

  TYPEDEF_RE.lastIndex = 0;
  while ((m = TYPEDEF_RE.exec(clean)) !== null) {
    const name = m[1];
    const lineNum = clean.slice(0, m.index).split('\n').length;
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name,
      file_path: filePath, line_start: lineNum, line_end: lineNum,
      signature: `typedef ${name}`, hash: '',
    });
  }

  INCLUDE_RE.lastIndex = 0;
  while ((m = INCLUDE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
