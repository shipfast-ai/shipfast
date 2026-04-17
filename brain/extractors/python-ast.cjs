/**
 * Python AST extractor (tree-sitter-backed).
 *
 * Parity with python.cjs — functions, classes, from-imports, same-file
 * + cross-file calls. Uses tree-sitter-python so strings/docstrings don't
 * cause false positives.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { hashContent, makeEdgeEmitter } = require('./_common.cjs');
const ast = require('./_ast.cjs');

// Reuse resolveImport from the regex python extractor.
const regexPy = require('./python.cjs');
const resolveImport = regexPy.resolveImport;

const EXTENSIONS = ['.py', '.pyw'];
const GRAMMAR = 'python';

const NON_CALL_KEYWORDS = new Set([
  'if','elif','else','for','while','return','yield','lambda','try','except','finally','raise',
  'with','as','def','class','import','from','global','nonlocal','and','or','not','in','is',
  'async','await','True','False','None','pass','break','continue','print','super','self',
  'isinstance','issubclass','int','str','float','list','dict','tuple','set','bool','bytes',
  'len','range','enumerate','zip','map','filter','sorted','reversed',
]);

function lineOf(n) { return { start: n.startPosition.row + 1, end: n.endPosition.row + 1 }; }
function findChild(n, type) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === type) return n.child(i);
  return null;
}

function extract(content, filePath, ctx) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  let tree;
  try { tree = ast.parseSync(GRAMMAR, content); } catch { return { nodes, edges }; }
  const root = tree.rootNode;

  const importedSymbols = {};
  const sameFileFns = new Map();
  const pendingCalls = [];

  function visit(n, currentFn) {
    const t = n.type;

    if (t === 'function_definition') {
      const node = handleFunction(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), node ? node.id : currentFn);
      return;
    }
    if (t === 'class_definition') {
      handleClass(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
      return;
    }
    if (t === 'import_from_statement') {
      handleFromImport(n);
    } else if (t === 'call') {
      handleCall(n, currentFn);
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
  }

  function handleFunction(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    const params = findChild(n, 'parameters');
    const node = {
      id: `fn:${filePath}:${name}`, kind: 'function', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `def ${name}${params ? params.text.slice(0, 60) : '()'}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    };
    nodes.push(node);
    sameFileFns.set(name, node.id);
    return node;
  }

  function handleClass(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    const bases = findChild(n, 'argument_list');
    nodes.push({
      id: `class:${filePath}:${name}`, kind: 'class', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `class ${name}${bases ? bases.text : ''}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
    if (bases) {
      for (let i = 0; i < bases.childCount; i++) {
        const c = bases.child(i);
        if (c.type === 'identifier' || c.type === 'attribute') {
          emit(`class:${filePath}:${name}`, `class:*:${c.text}`, 'extends');
        }
      }
    }
  }

  function handleFromImport(n) {
    // `from .pkg import a, b as c`
    const mod = n.childForFieldName && n.childForFieldName('module_name');
    if (!mod) return;
    const modText = mod.text;
    if (!modText.startsWith('.')) return;  // only tracking relative for cross-file

    const resolved = resolveImport(filePath, modText, ctx);
    emit(`file:${filePath}`, `file:${resolved}`, 'imports');

    // Children include `dotted_name` items + `aliased_import` items
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type === 'dotted_name' && c !== mod) {
        importedSymbols[c.text] = resolved;
      } else if (c.type === 'aliased_import') {
        const nameN = findChild(c, 'dotted_name') || findChild(c, 'identifier');
        const aliasN = c.childForFieldName && c.childForFieldName('alias');
        if (aliasN) importedSymbols[aliasN.text] = resolved;
        else if (nameN) importedSymbols[nameN.text] = resolved;
      }
    }
  }

  function handleCall(n, currentFn) {
    if (!currentFn) return;
    const fn = n.childForFieldName ? n.childForFieldName('function') : n.child(0);
    if (!fn || fn.type !== 'identifier') return;
    pendingCalls.push({ callerId: currentFn, calleeName: fn.text });
  }

  visit(root, null);

  const seen = new Set();
  for (const { callerId, calleeName } of pendingCalls) {
    const key = `${callerId}::${calleeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (NON_CALL_KEYWORDS.has(calleeName)) continue;
    const sameFile = sameFileFns.get(calleeName);
    if (sameFile && sameFile !== callerId) { emit(callerId, sameFile, 'calls'); continue; }
    const targetFile = importedSymbols[calleeName];
    if (targetFile) { emit(callerId, `fn:${targetFile}:${calleeName}`, 'calls'); continue; }
    emit(callerId, `unresolved:${calleeName}`, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, GRAMMAR };
