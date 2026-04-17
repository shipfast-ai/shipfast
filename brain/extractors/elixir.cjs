/**
 * Elixir extractor.
 * Handles: .ex .exs
 *
 * Uses keyword-based block detection (defmodule/def/… end).
 */

'use strict';

const { hashContent, findKeywordBlock, makeEdgeEmitter, emitCalls } = require('./_common.cjs');
const ELIXIR_NON_CALL_KEYWORDS = new Set([
  'if', 'unless', 'case', 'when', 'cond', 'with', 'do', 'end', 'def', 'defp', 'defmodule', 'defprotocol', 'defimpl', 'defmacro', 'defguard', 'use', 'alias', 'import', 'require', 'try', 'rescue', 'catch', 'throw', 'raise', 'else', 'after', 'fn', 'in', 'and', 'or', 'not', 'true', 'false', 'nil', 'IO', 'Enum', 'Map', 'List', 'String', 'Integer', 'Atom', 'receive', 'send', 'spawn', 'self', '__MODULE__', 'return'
]);


const EXTENSIONS = ['.ex', '.exs'];

const NESTED_OPENERS = ['defmodule', 'def', 'defp', 'defmacro', 'defmacrop',
  'defprotocol', 'defimpl', 'do', 'case', 'cond', 'if', 'unless', 'receive', 'fn', 'try', 'with', 'for'];

const DEF_RE = /^\s*(defp?|defmacro[p]?)\s+(\w+[?!]?)\s*(?:\(([^)]*)\))?/gm;
const MODULE_RE = /^\s*defmodule\s+([\w.]+)/gm;
const PROTOCOL_RE = /^\s*defprotocol\s+([\w.]+)/gm;
const IMPL_RE = /^\s*defimpl\s+([\w.]+)/gm;
const IMPORT_RE = /^\s*(?:import|alias|use|require)\s+([\w.]+)/gm;

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  function push(re, kind, sigFn, idPrefix) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const endLine = findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS);
      nodes.push({
        id: `${idPrefix}:${filePath}:${name}`,
        kind, name, file_path: filePath,
        line_start: lineNum, line_end: endLine,
        signature: sigFn(m),
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
      });
    }
  }

  DEF_RE.lastIndex = 0;
  let m;
  while ((m = DEF_RE.exec(content)) !== null) {
    const kw = m[1];
    const name = m[2];
    const params = m[3] || '';
    const lineNum = content.slice(0, m.index).split('\n').length;
    const endLine = findKeywordBlock(lines, lineNum - 1, NESTED_OPENERS);
    nodes.push({
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `${kw} ${name}(${params.slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n')),
    });
  }

  push(MODULE_RE, 'type', (x) => `defmodule ${x[1]}`, 'type');
  push(PROTOCOL_RE, 'type', (x) => `defprotocol ${x[1]}`, 'type');
  push(IMPL_RE, 'type', (x) => `defimpl ${x[1]}`, 'type');

  // Track aliases for cross-file call resolution. Elixir's `alias Mod.Sub`
  // brings `Sub` into scope as a shorthand for `Mod.Sub`. `alias X.Y, as: Z`
  // brings `Z` as the alias. `import Mod, only: [foo: 2]` brings bare `foo/2`.
  const importedSymbols = {};
  // Plain `alias Mod.Sub` (no `as:`) → Sub maps to Mod.Sub
  const ALIAS_SIMPLE = /^\s*alias\s+([\w.]+)/gm;
  const ALIAS_AS = /^\s*alias\s+([\w.]+)\s*,\s*as:\s*([\w.]+)/gm;
  const IMPORT_ONLY = /^\s*import\s+([\w.]+)\s*,\s*only:\s*\[([^\]]+)\]/gm;

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    emit(`file:${filePath}`, `module:${m[1]}`, 'imports');
  }
  ALIAS_SIMPLE.lastIndex = 0;
  let ma;
  while ((ma = ALIAS_SIMPLE.exec(content)) !== null) {
    const fq = ma[1];
    const short = fq.split('.').pop();
    if (short) importedSymbols[short] = `elixir:${fq}`;
  }
  ALIAS_AS.lastIndex = 0;
  while ((ma = ALIAS_AS.exec(content)) !== null) {
    const fq = ma[1], alias = ma[2].split('.').pop();
    if (alias) importedSymbols[alias] = `elixir:${fq}`;
  }
  IMPORT_ONLY.lastIndex = 0;
  while ((ma = IMPORT_ONLY.exec(content)) !== null) {
    const mod = ma[1];
    for (const part of ma[2].split(',')) {
      const name = part.trim().split(':')[0].trim();
      if (/^[a-z_][\w?!]*$/.test(name)) importedSymbols[name] = `elixir:${mod}.${name}`;
    }
  }

  emitCalls({ content, lines, fnNodes: nodes, importedSymbols, filePath, emit, nonCallKeywords: ELIXIR_NON_CALL_KEYWORDS });
  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport };
