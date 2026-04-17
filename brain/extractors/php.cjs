/**
 * PHP extractor.
 * Handles: .php
 *
 * Emits: file/function/class/type nodes; imports (use), extends, implements,
 * same-file calls, cross-file calls via `use` name resolution.
 */

'use strict';

const { hashContent, findBraceBlock, makeEdgeEmitter, emitCalls } = require('./_common.cjs');

const EXTENSIONS = ['.php'];

const FN_RE = /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|\s)*function\s+(\w+)\s*\(([^)]*)\)/g;
const CLASS_RE = /(?:final\s+|abstract\s+|readonly\s+|\s)*class\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+?))?\s*\{/g;
const INTERFACE_RE = /\binterface\s+(\w+)/g;
const TRAIT_RE = /\btrait\s+(\w+)/g;
const ENUM_RE = /\benum\s+(\w+)/g;
// `use Namespace\Class [as Alias];` — captures both and the optional alias.
const USE_RE = /\buse\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g;
const REQUIRE_RE = /\b(?:require|include|require_once|include_once)\s*\(?\s*['"]([^'"]+)['"]/g;

// PHP non-callee keywords (plus common pseudo-functions that look like calls
// but aren't target symbols). `echo`, `print`, etc. get filtered.
const PHP_NON_CALL_KEYWORDS = new Set([
  'if', 'elseif', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case',
  'return', 'break', 'continue', 'try', 'catch', 'finally', 'throw',
  'new', 'clone', 'instanceof', 'isset', 'unset', 'empty', 'array',
  'echo', 'print', 'require', 'include', 'require_once', 'include_once',
  'function', 'class', 'interface', 'trait', 'enum', 'namespace', 'use',
  'public', 'private', 'protected', 'static', 'final', 'abstract',
  'list', 'fn', 'match', 'yield', 'true', 'false', 'null',
]);

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
      if (isClass) {
        if (m[2]) emit(`class:${filePath}:${name}`, `class:*:${m[2]}`, 'extends');
        if (m[3]) {
          for (const iface of m[3].split(',')) {
            const clean = iface.trim().replace(/^\\+/, '');
            if (clean) emit(`class:${filePath}:${name}`, `type:*:${clean}`, 'implements');
          }
        }
      }
    }
  }

  push(FN_RE, 'function', (m) => `function ${m[1]}(${(m[2] || '').slice(0, 60)})`, false);
  push(CLASS_RE, 'class', (m) => `class ${m[1]}${m[2] ? ` extends ${m[2]}` : ''}${m[3] ? ` implements ${m[3].trim()}` : ''}`, true);
  push(INTERFACE_RE, 'type', (m) => `interface ${m[1]}`, false);
  push(TRAIT_RE, 'type', (m) => `trait ${m[1]}`, false);
  push(ENUM_RE, 'type', (m) => `enum ${m[1]}`, false);

  // Imports + symbol table for cross-file call resolution.
  // PHP `use Foo\Bar;` makes `Bar` locally usable; `use Foo\Bar as Baz;` makes `Baz` the callable.
  const importedSymbols = {};
  USE_RE.lastIndex = 0;
  let m;
  while ((m = USE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
    const alias = m[2] || m[1].split('\\').pop();
    // For PHP we can't resolve to a file without PSR-4 autoload mapping.
    // Record the fully-qualified class name so cross-file callers show up in
    // brain_impact (edge target is the FQN, still searchable).
    if (alias) importedSymbols[alias] = `php:${m[1]}`;
  }
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }

  // Same-file + cross-file calls (cross-file here is via FQN, since PSR-4
  // resolution needs composer.json parsing that's out of scope).
  emitCalls({
    content, lines, fnNodes: nodes, importedSymbols, filePath, emit,
    nonCallKeywords: PHP_NON_CALL_KEYWORDS,
  });

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
