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
  const sameFileClasses = new Set();
  const classMethods = new Map();    // `ClassName.method` → method node id
  const localTypes = new Map();       // var → ClassName
  const pendingCalls = [];
  const pendingMethodCalls = [];      // [{callerId, receiverVar, method}]

  function visit(n, currentFn) {
    const t = n.type;

    if (t === 'function_definition') {
      const node = handleFunction(n);
      if (node) {
        const enclosing = findEnclosingClass(n);
        const cnn = enclosing && enclosing.childForFieldName && enclosing.childForFieldName('name');
        if (cnn) classMethods.set(`${cnn.text}.${node.name}`, node.id);
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), node ? node.id : currentFn);
      return;
    }
    if (t === 'class_definition') {
      const nn = n.childForFieldName && n.childForFieldName('name');
      if (nn) sameFileClasses.add(nn.text);
      handleClass(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
      return;
    }
    if (t === 'import_from_statement') {
      handleFromImport(n);
    } else if (t === 'call') {
      handleCall(n, currentFn);
    } else if (t === 'assignment') {
      handleAssignment(n, currentFn);
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

  function findEnclosingClass(n) {
    let p = n.parent;
    while (p) {
      if (p.type === 'class_definition') return p;
      p = p.parent;
    }
    return null;
  }

  function handleCall(n, currentFn) {
    if (!currentFn) return;
    const fn = n.childForFieldName ? n.childForFieldName('function') : n.child(0);
    if (!fn) return;
    if (fn.type === 'identifier') {
      pendingCalls.push({ callerId: currentFn, calleeName: fn.text });
      return;
    }
    if (fn.type === 'attribute') {
      // `obj.method()` — resolve obj's class if it's a tracked local.
      const object = fn.childForFieldName && fn.childForFieldName('object');
      const attr = fn.childForFieldName && fn.childForFieldName('attribute');
      if (object && object.type === 'identifier' && attr) {
        pendingMethodCalls.push({
          callerId: currentFn,
          receiverVar: object.text,
          method: attr.text,
        });
      }
    }
  }

  function handleAssignment(n, currentFn) {
    // `x = SomeClass()` → track local type, resolve `new_expression`-like usage.
    // `self.field = X` inside a method → mutates edge.
    const left = n.childForFieldName && n.childForFieldName('left');
    const right = n.childForFieldName && n.childForFieldName('right');
    if (!left) return;

    // self.x = ... / obj.x = ...  → mutates
    if (currentFn && left.type === 'attribute') {
      const object = left.childForFieldName && left.childForFieldName('object');
      const attr = left.childForFieldName && left.childForFieldName('attribute');
      if (object && attr) {
        if (object.type === 'identifier' && object.text === 'self') {
          emit(currentFn, `variable:${filePath}:self.${attr.text}`, 'mutates');
        } else if (object.type === 'identifier') {
          emit(currentFn, `variable:${filePath}:${object.text}.${attr.text}`, 'mutates');
        }
      }
    }

    // x = Foo() → localTypes[x] = 'Foo' (only for simple calls to identifier)
    if (left.type === 'identifier' && right && right.type === 'call') {
      const fn = right.childForFieldName && right.childForFieldName('function');
      if (fn && fn.type === 'identifier') {
        localTypes.set(left.text, fn.text);
      }
    }
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

  // Method dispatch — obj.method() where obj = Foo() (same-file classes).
  for (const { callerId, receiverVar, method } of pendingMethodCalls) {
    const cls = localTypes.get(receiverVar);
    if (!cls || !sameFileClasses.has(cls)) continue;
    const methodId = classMethods.get(`${cls}.${method}`);
    if (methodId && methodId !== callerId) emit(callerId, methodId, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, GRAMMAR };
