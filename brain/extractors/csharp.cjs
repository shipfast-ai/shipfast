/**
 * C# extractor.
 * Handles: .cs
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter } = require('./_common.cjs');

const EXTENSIONS = ['.cs'];

const CONTROL = new Set(['if', 'while', 'for', 'foreach', 'switch', 'return', 'using', 'lock', 'try', 'catch', 'finally', 'get', 'set']);

const CLASS_RE = /(?:public\s+|private\s+|internal\s+|protected\s+|static\s+|abstract\s+|sealed\s+|partial\s+|unsafe\s+|\s)*class\s+(\w+)(?:\s*<[^>]+>)?(?:\s*:\s*([\w.<>, ]+))?/g;
const INTERFACE_RE = /(?:public\s+|internal\s+|\s)*interface\s+(\w+)(?:\s*<[^>]+>)?/g;
const STRUCT_RE = /(?:public\s+|private\s+|internal\s+|readonly\s+|ref\s+|\s)*struct\s+(\w+)/g;
const ENUM_RE = /(?:public\s+|internal\s+|\s)*enum\s+(\w+)/g;
const RECORD_RE = /(?:public\s+|internal\s+|\s)*record\s+(?:class\s+|struct\s+)?(\w+)/g;
// Method: modifiers ReturnType Name(params) { ... }  — require `{` or `=>`
const METHOD_RE = /(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|partial|new|\s)+(?:<[^>]+>\s+)?([A-Za-z_][\w.<>\[\], ?]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*where\s+[^{;]+)?\s*[{=]/g;
const USING_RE = /^\s*using\s+(?:static\s+)?([\w.=\s]+);/gm;

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
        id: `${isClass ? 'class' : 'type'}:${filePath}:${name}`,
        kind: isClass ? 'class' : 'type',
        name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
      if (isClass && m[2]) {
        const base = m[2].trim().split(/[\s,<]/)[0];
        if (base) emit(`class:${filePath}:${name}`, `class:*:${base}`, 'extends');
      }
    }
  }

  push(CLASS_RE, 'class', (m) => `class ${m[1]}${m[2] ? ` : ${m[2].trim()}` : ''}`, true);
  push(INTERFACE_RE, 'type', (m) => `interface ${m[1]}`, false);
  push(STRUCT_RE, 'type', (m) => `struct ${m[1]}`, false);
  push(ENUM_RE, 'type', (m) => `enum ${m[1]}`, false);
  push(RECORD_RE, 'type', (m) => `record ${m[1]}`, false);

  METHOD_RE.lastIndex = 0;
  let m;
  while ((m = METHOD_RE.exec(content)) !== null) {
    const returnType = m[1].trim();
    const name = m[2];
    const params = m[3];
    if (CONTROL.has(name) || CONTROL.has(returnType)) continue;
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findBraceBlock(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${returnType} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  USING_RE.lastIndex = 0;
  while ((m = USING_RE.exec(content)) !== null) {
    const ns = m[1].trim().split('=').pop().trim();
    emit(`file:${filePath}`, `module:${ns}`, 'imports');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
