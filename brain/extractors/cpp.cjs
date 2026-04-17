/**
 * C++ extractor.
 * Handles: .cpp .cc .hpp .cxx
 *
 * Extends the C patterns with:
 *   - namespace, enum class
 *   - class X, struct X (with body), template <>
 *   - Qualified method definitions ClassName::method(...)
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter, stripBlockComments, emitCalls } = require('./_common.cjs');
const CPP_NON_CALL_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break', 'continue', 'goto', 'default', 'sizeof', 'typedef', 'struct', 'union', 'enum', 'static', 'extern', 'const', 'volatile', 'inline', 'int', 'char', 'float', 'double', 'void', 'long', 'short', 'signed', 'unsigned', 'printf', 'scanf', 'malloc', 'free', 'namespace', 'class', 'public', 'private', 'protected', 'virtual', 'override', 'template', 'typename', 'using', 'auto', 'decltype', 'nullptr', 'delete', 'new', 'this', 'throw', 'try', 'catch', 'std', 'cout', 'cin', 'endl', 'make_unique', 'make_shared', 'move', 'forward', 'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast', 'true', 'false'
]);


const EXTENSIONS = ['.cpp', '.cc', '.hpp', '.cxx'];

const CONTROL_KEYWORDS = new Set([
  'if', 'while', 'for', 'switch', 'return', 'sizeof', 'typeof',
  'case', 'default', 'goto', 'do', 'else', 'throw', 'catch', 'try',
  'decltype', 'alignof', 'noexcept',
]);

const FN_RE = /(?:^|\n)[ \t]*(?:template\s*<[^>]*>\s*)?(?:static\s+|extern\s+|inline\s+|virtual\s+|explicit\s+|constexpr\s+|consteval\s+|noexcept\s+|[A-Z_]+\s+)*([A-Za-z_][\w:]*(?:\s*<[^>]+>)?(?:\s*\*+|\s*&)?(?:\s+[A-Za-z_][\w:]*)*)\s+((?:[A-Za-z_][\w]*::)*[A-Za-z_~]\w*)\s*\(([^)]*)\)(?:\s*(?:const|noexcept|override|final|\s)*)?\s*(?:\{|\n\s*\{|:\s*[A-Za-z_])/g;
const CLASS_RE = /(?:template\s*<[^>]*>\s*)?class\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+([\w:<>, ]+))?\s*\{/g;
const STRUCT_RE = /(?:template\s*<[^>]*>\s*)?struct\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+([\w:<>, ]+))?\s*\{/g;
const NAMESPACE_RE = /\bnamespace\s+(\w+)\s*\{/g;
const ENUM_CLASS_RE = /\benum\s+(?:class|struct)\s+(\w+)/g;
const INCLUDE_RE = /^\s*#\s*include\s+[<"]([^>"]+)[>"]/gm;
const USING_RE = /\busing\s+(?:namespace\s+)?([A-Za-z_][\w:]*)/g;

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
    const rawLine = lines[lineNum - 1] || '';
    if (/^\s*#/.test(rawLine)) continue;
    const endLine = findBraceBlock(lines, lineNum - 1);
    const baseName = name.includes('::') ? name.split('::').pop() : name;
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name: baseName,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${returnType} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  function pushType(re, prefix, isClass) {
    re.lastIndex = 0;
    let x;
    while ((x = re.exec(clean)) !== null) {
      const name = x[1];
      const lineNum = clean.slice(0, x.index).split('\n').length;
      const endLine = findBraceBlock(lines, lineNum - 1);
      nodes.push({
        id: `${isClass ? 'class' : 'type'}:${filePath}:${name}`,
        kind: isClass ? 'class' : 'type',
        name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: `${prefix} ${name}${x[2] ? ` : ${x[2].trim()}` : ''}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (isClass && x[2]) {
        const base = x[2].trim().split(/[\s<,]/)[0];
        if (base) emit(`class:${filePath}:${name}`, `class:*:${base}`, 'extends');
      }
    }
  }

  pushType(CLASS_RE, 'class', true);
  pushType(STRUCT_RE, 'struct', false);
  pushType(NAMESPACE_RE, 'namespace', false);
  pushType(ENUM_CLASS_RE, 'enum class', false);

  INCLUDE_RE.lastIndex = 0;
  while ((m = INCLUDE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  USING_RE.lastIndex = 0;
  while ((m = USING_RE.exec(clean)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'uses');
  }

  emitCalls({ content, lines, fnNodes: nodes, importedSymbols: {}, filePath, emit, nonCallKeywords: CPP_NON_CALL_KEYWORDS });
  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
