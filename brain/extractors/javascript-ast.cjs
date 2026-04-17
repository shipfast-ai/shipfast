/**
 * JavaScript / TypeScript AST extractor (tree-sitter-backed).
 *
 * Same module contract as javascript.cjs so the indexer's extractor registry
 * can swap one for the other behind --ast. Emits the same node/edge shapes:
 *   nodes:  function | type | class
 *   edges:  imports | exports | calls | extends | implements
 *
 * Parser/grammar preloaded by the indexer; extract() runs synchronously.
 *
 * Phase 1 scope: JS/JSX only (the vendored grammar is tree-sitter-javascript,
 * which also handles JSX). TypeScript-specific syntax (type aliases, interfaces,
 * `implements`) is tolerated but only partially extracted — full TS support
 * requires vendoring tree-sitter-typescript in Phase 2.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { hashContent, makeEdgeEmitter } = require('./_common.cjs');
const ast = require('./_ast.cjs');

// Reuse path-alias resolution from the regex extractor — no need to duplicate
// tsconfig parsing here. We only call its resolveImport + loadConfig.
const regexJs = require('./javascript.cjs');
const resolveImport = regexJs.resolveImport;
const loadConfig = regexJs.loadConfig;

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

// Grammar selection per extension:
//   .ts          → typescript grammar (proper TS syntax: generics, interface, type, enum)
//   .tsx         → tsx grammar (TS + JSX)
//   .js/.jsx/.mjs/.cjs → javascript grammar (handles JSX fine)
// All three vendored under brain/extractors/grammars/.
const GRAMMAR = 'javascript'; // default for .js/.jsx/.mjs/.cjs
const GRAMMAR_FOR_EXT = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};
const GRAMMARS_USED = ['javascript', 'typescript', 'tsx'];

function isLocalImport(target) {
  return target.startsWith('.') || target.startsWith('@') || target.startsWith('~') || target.startsWith('#');
}

function lineCol(node) {
  return { start: node.startPosition.row + 1, end: node.endPosition.row + 1 };
}

function safe(str) {
  return typeof str === 'string' ? str : '';
}

function extract(content, filePath, ctx) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  const ext = path.extname(filePath);
  const grammar = GRAMMAR_FOR_EXT[ext] || GRAMMAR;
  let tree;
  try {
    tree = ast.parseSync(grammar, content);
  } catch {
    // If the grammar isn't preloaded or parsing fails catastrophically, emit
    // nothing — indexer's default (regex) path should be used instead.
    return { nodes, edges };
  }
  const root = tree.rootNode;

  // Traversal state
  const importedSymbols = {};      // local name → resolved target file
  const sameFileFns = new Map();   // name → fn node id
  const sameFileClasses = new Set(); // class names declared in this file
  const classMethods = new Map();  // `ClassName.method` → method node id
  const localTypes = new Map();    // var name → ClassName (for receiver resolution)
  const pendingCalls = [];         // buffer: [{callerId, calleeName}] — flushed after full walk
  const pendingMethodCalls = [];   // [{callerId, receiverVar, method}] — dispatched after walk

  // Walk the tree once, dispatching per node kind.
  function visit(n, currentFn /* node id of enclosing fn, or null */) {
    const kind = n.type;

    if (kind === 'import_statement') {
      handleImport(n);
    } else if (kind === 'export_statement') {
      handleExport(n);
    } else if (kind === 'function_declaration'
            || kind === 'function_expression'
            || kind === 'arrow_function'
            || kind === 'method_definition'
            || kind === 'generator_function_declaration'
            || kind === 'generator_function') {
      const fnNode = handleFunction(n);
      // If this is a method inside a class, record it under ClassName.method
      // for method dispatch resolution.
      if (fnNode && kind === 'method_definition') {
        const enclosingClass = findEnclosingClass(n);
        if (enclosingClass) {
          const nameN = enclosingClass.childForFieldName && enclosingClass.childForFieldName('name');
          if (nameN) classMethods.set(`${nameN.text}.${fnNode.name}`, fnNode.id);
        }
      }
      // Walk into body with this function as caller for `calls` edges.
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), fnNode ? fnNode.id : currentFn);
      return;
    } else if (kind === 'class_declaration') {
      const nameN = n.childForFieldName && n.childForFieldName('name');
      if (nameN) sameFileClasses.add(nameN.text);
      handleClass(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
      return;
    } else if (kind === 'type_alias_declaration'
            || kind === 'interface_declaration') {
      handleTypeLike(n);
    } else if (kind === 'call_expression') {
      handleCall(n, currentFn);
    } else if (kind === 'assignment_expression') {
      handleCjsExport(n);
      handleMutate(n, currentFn);
    } else if (kind === 'variable_declarator') {
      handleRequire(n);
      handleLocalType(n);
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
  }

  function handleImport(n) {
    const src = findChild(n, 'string');
    if (!src) return;
    const target = stringLiteral(src);
    if (!target || !isLocalImport(target)) return;
    const resolved = resolveImport(filePath, target, ctx);
    emit(`file:${filePath}`, `file:${resolved}`, 'imports');

    // Harvest named + default imports into importedSymbols for call resolution.
    const clause = findChild(n, 'import_clause');
    if (!clause) return;
    for (let i = 0; i < clause.childCount; i++) {
      const c = clause.child(i);
      if (c.type === 'identifier') {
        importedSymbols[c.text] = resolved;   // default import
      } else if (c.type === 'named_imports') {
        for (let j = 0; j < c.childCount; j++) {
          const spec = c.child(j);
          if (spec.type !== 'import_specifier') continue;
          const orig = findChild(spec, 'identifier');
          const asAlias = spec.childCount > 1 ? spec.child(spec.childCount - 1) : null;
          const alias = asAlias && asAlias !== orig ? asAlias.text : (orig ? orig.text : null);
          if (alias) importedSymbols[alias] = resolved;
        }
      } else if (c.type === 'namespace_import') {
        // `import * as NS from '...'` — NS.field refs aren't tracked at this level.
        const id = findChild(c, 'identifier');
        if (id) importedSymbols[id.text] = resolved;
      }
    }
  }

  function handleExport(n) {
    // `export function Foo(...)` / `export class Foo` / `export const Foo = ...` / `export { A, B }`
    // Find any identifier that gets exported and emit an edge.
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type === 'function_declaration' || c.type === 'class_declaration'
          || c.type === 'generator_function_declaration') {
        const name = findChild(c, 'identifier') || findChild(c, 'type_identifier');
        if (name) emit(`file:${filePath}`, `symbol:${filePath}:${name.text}`, 'exports');
      } else if (c.type === 'lexical_declaration' || c.type === 'variable_declaration') {
        for (let j = 0; j < c.childCount; j++) {
          const d = c.child(j);
          if (d.type === 'variable_declarator') {
            const id = findChild(d, 'identifier');
            if (id) emit(`file:${filePath}`, `symbol:${filePath}:${id.text}`, 'exports');
          }
        }
      } else if (c.type === 'export_clause') {
        for (let j = 0; j < c.childCount; j++) {
          const spec = c.child(j);
          if (spec.type !== 'export_specifier') continue;
          // `{ A }` or `{ A as B }` — the export alias is the last identifier.
          const ids = [];
          for (let k = 0; k < spec.childCount; k++) {
            const ch = spec.child(k);
            if (ch.type === 'identifier') ids.push(ch.text);
          }
          const exportedAs = ids[ids.length - 1];
          if (exportedAs) emit(`file:${filePath}`, `symbol:${filePath}:${exportedAs}`, 'exports');
        }
      }
    }
  }

  function handleCjsExport(n) {
    // `module.exports = …` or `module.exports.Foo = …`
    const left = n.child(0);
    if (!left) return;
    const text = left.text;
    const m = text.match(/^module\.exports(?:\.(\w+))?$/);
    if (!m) return;
    const name = m[1] || 'default';
    emit(`file:${filePath}`, `symbol:${filePath}:${name}`, 'exports');
  }

  function handleRequire(n) {
    // `const X = require('./foo')`
    // `const { A, B: C } = require('./foo')`
    const right = n.childForFieldName && n.childForFieldName('value');
    if (!right || right.type !== 'call_expression') return;
    const fn = right.child(0);
    if (!fn || fn.text !== 'require') return;
    const arg = right.child(1);
    if (!arg || arg.type !== 'arguments' || arg.childCount < 2) return;
    const pathNode = arg.child(1);
    if (!pathNode || pathNode.type !== 'string') return;
    const target = stringLiteral(pathNode);
    if (!target || !isLocalImport(target)) return;
    const resolved = resolveImport(filePath, target, ctx);
    emit(`file:${filePath}`, `file:${resolved}`, 'imports');

    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    if (nameNode.type === 'identifier') {
      importedSymbols[nameNode.text] = resolved;
    } else if (nameNode.type === 'object_pattern') {
      for (let i = 0; i < nameNode.childCount; i++) {
        const p = nameNode.child(i);
        if (p.type === 'shorthand_property_identifier_pattern' || p.type === 'property_identifier') {
          importedSymbols[p.text] = resolved;
        } else if (p.type === 'pair_pattern') {
          // { orig: alias }
          const value = p.childForFieldName && p.childForFieldName('value');
          if (value && value.type === 'identifier') importedSymbols[value.text] = resolved;
        }
      }
    }
  }

  function handleFunction(n) {
    // function_declaration / generator_function_declaration have a named identifier.
    // arrow_function / function_expression may be assigned via variable_declarator or pair.
    let nameNode = null;
    if (n.type === 'function_declaration' || n.type === 'generator_function_declaration'
        || n.type === 'method_definition') {
      nameNode = n.childForFieldName ? (n.childForFieldName('name') || findChild(n, 'identifier') || findChild(n, 'property_identifier')) : findChild(n, 'identifier');
    } else {
      // Anonymous; try parent binding. `const foo = () => ...` parent is variable_declarator.
      const parent = n.parent;
      if (parent && parent.type === 'variable_declarator') {
        nameNode = parent.childForFieldName ? parent.childForFieldName('name') : findChild(parent, 'identifier');
      } else if (parent && parent.type === 'pair') {
        nameNode = parent.childForFieldName ? parent.childForFieldName('key') : null;
      }
    }
    if (!nameNode) return null;
    const name = nameNode.text;
    const { start, end } = lineCol(n);
    const params = findChild(n, 'formal_parameters');
    const signature = `${name}${params ? params.text.slice(0, 60) : '()'}`;
    const body = lines.slice(start - 1, end).join('\n');
    const node = {
      id: `fn:${filePath}:${name}`, kind: 'function', name,
      file_path: filePath, line_start: start, line_end: end,
      signature, hash: hashContent(body),
    };
    nodes.push(node);
    sameFileFns.set(name, node.id);
    return node;
  }

  function handleClass(n) {
    const nameNode = n.childForFieldName ? n.childForFieldName('name') : findChild(n, 'identifier');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineCol(n);
    const body = lines.slice(start - 1, end).join('\n');
    nodes.push({
      id: `class:${filePath}:${name}`, kind: 'class', name,
      file_path: filePath, line_start: start, line_end: end,
      signature: `class ${name}`,
      hash: hashContent(body),
    });

    // extends + implements via the class_heritage or heritage clauses.
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type === 'class_heritage') {
        for (let j = 0; j < c.childCount; j++) {
          const h = c.child(j);
          if (h.type === 'extends_clause') {
            const id = findChild(h, 'identifier') || findChild(h, 'type_identifier');
            if (id) emit(`class:${filePath}:${name}`, `class:*:${id.text}`, 'extends');
          } else if (h.type === 'implements_clause') {
            for (let k = 0; k < h.childCount; k++) {
              const id = h.child(k);
              if (id.type === 'type_identifier' || id.type === 'identifier') {
                emit(`class:${filePath}:${name}`, `type:*:${id.text}`, 'implements');
              }
            }
          }
        }
      }
    }
  }

  function handleTypeLike(n) {
    const nameNode = n.childForFieldName ? n.childForFieldName('name') : findChild(n, 'type_identifier') || findChild(n, 'identifier');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineCol(n);
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name,
      file_path: filePath, line_start: start, line_end: end,
      signature: `type ${name}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
  }

  function handleCall(n, currentFn) {
    // Only emit edges when we have a known caller. Buffer; resolve after
    // the full walk so forward references work (callees defined later in
    // the file).
    if (!currentFn) return;
    const callee = n.childForFieldName ? n.childForFieldName('function') : n.child(0);
    if (!callee) return;
    if (callee.type === 'identifier') {
      pendingCalls.push({ callerId: currentFn, calleeName: callee.text });
      return;
    }
    // Method dispatch — `receiver.method(…)` where receiver is an identifier.
    if (callee.type === 'member_expression') {
      const obj = callee.childForFieldName ? callee.childForFieldName('object') : null;
      const prop = callee.childForFieldName ? callee.childForFieldName('property') : null;
      if (obj && obj.type === 'identifier' && prop && prop.type === 'property_identifier') {
        pendingMethodCalls.push({
          callerId: currentFn,
          receiverVar: obj.text,
          method: prop.text,
        });
      }
    }
  }

  function handleLocalType(n) {
    // `const x = new Foo(...)` → localTypes[x] = 'Foo'
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    const value = n.childForFieldName && n.childForFieldName('value');
    if (!nameNode || !value || nameNode.type !== 'identifier') return;
    if (value.type === 'new_expression') {
      const ctor = value.childForFieldName && value.childForFieldName('constructor');
      if (ctor && ctor.type === 'identifier') {
        localTypes.set(nameNode.text, ctor.text);
      }
    }
  }

  function handleMutate(n, currentFn) {
    // `this.field = …` inside a method → mutates edge from method to variable.
    if (!currentFn) return;
    const left = n.childForFieldName ? n.childForFieldName('left') : n.child(0);
    if (!left || left.type !== 'member_expression') return;
    const obj = left.childForFieldName && left.childForFieldName('object');
    const prop = left.childForFieldName && left.childForFieldName('property');
    if (!obj || !prop || prop.type !== 'property_identifier') return;
    if (obj.type === 'this') {
      emit(currentFn, `variable:${filePath}:this.${prop.text}`, 'mutates');
    } else if (obj.type === 'identifier' && obj.text === 'module' && prop.text === 'exports') {
      // handled by handleCjsExport
      return;
    } else if (obj.type === 'identifier') {
      // module-level var write — only emit if `obj` is a top-level identifier.
      // Can't easily verify top-level-ness without scope tracking. Emit edges
      // for named assignments; noise is acceptable at this resolution.
      emit(currentFn, `variable:${filePath}:${obj.text}.${prop.text}`, 'mutates');
    }
  }

  function findChild(n, type) {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type === type) return c;
    }
    return null;
  }

  function findEnclosingClass(n) {
    let p = n.parent;
    while (p) {
      if (p.type === 'class_declaration' || p.type === 'class') return p;
      p = p.parent;
    }
    return null;
  }

  function stringLiteral(n) {
    // Drop the surrounding quotes; handle both 'foo' and "foo".
    const txt = n.text;
    if (txt.length >= 2) return txt.slice(1, -1);
    return '';
  }

  visit(root, null);

  // Flush pending calls now that sameFileFns + importedSymbols are fully populated.
  const seen = new Set(); // dedupe per caller+callee
  for (const { callerId, calleeName } of pendingCalls) {
    const key = `${callerId}::${calleeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sameFile = sameFileFns.get(calleeName);
    if (sameFile) {
      if (sameFile !== callerId) emit(callerId, sameFile, 'calls');
      continue;
    }
    const targetFile = importedSymbols[calleeName];
    if (targetFile) { emit(callerId, `fn:${targetFile}:${calleeName}`, 'calls'); continue; }
    // Unresolved — defer to project-wide resolver.
    emit(callerId, `unresolved:${calleeName}`, 'calls');
  }

  // Method dispatch: x.method() where x was `new Foo()` and Foo is same-file.
  // Emits a calls edge to fn:filePath:methodId via the qualified classMethods
  // key. Limited to same-file receivers — cross-file/cross-module dispatch
  // needs classpath / autoload awareness that's out of scope.
  for (const { callerId, receiverVar, method } of pendingMethodCalls) {
    const cls = localTypes.get(receiverVar);
    if (!cls || !sameFileClasses.has(cls)) continue;
    const methodId = classMethods.get(`${cls}.${method}`);
    if (methodId && methodId !== callerId) emit(callerId, methodId, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, loadConfig, GRAMMAR, GRAMMARS_USED };
