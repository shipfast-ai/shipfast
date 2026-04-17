/**
 * PHP AST extractor (tree-sitter-backed).
 *
 * Parity with php.cjs — emits function/class/type nodes + imports/
 * extends/implements/calls edges. Uses tree-sitter-php grammar for
 * precise detection (no regex false positives on strings/heredocs).
 *
 * Indexer preloads the grammar via `php` name.
 */

'use strict';

const { hashContent, makeEdgeEmitter } = require('./_common.cjs');
const ast = require('./_ast.cjs');

const EXTENSIONS = ['.php'];
const GRAMMAR = 'php';

const NON_CALL_KEYWORDS = new Set([
  'if','elseif','else','for','foreach','while','do','switch','case','return','break','continue',
  'try','catch','finally','throw','new','clone','instanceof','isset','unset','empty','array',
  'echo','print','require','include','require_once','include_once','function','class','interface',
  'trait','enum','namespace','use','public','private','protected','static','final','abstract',
  'list','fn','match','yield','true','false','null','self','parent','this',
]);

function resolveImport(fromFile, importPath) { return importPath; }

function lineOf(node) {
  return { start: node.startPosition.row + 1, end: node.endPosition.row + 1 };
}

function findChild(n, type) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === type) return n.child(i);
  return null;
}
function findAll(n, type, out = []) {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c.type === type) out.push(c);
  }
  return out;
}

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  let tree;
  try { tree = ast.parseSync(GRAMMAR, content); } catch { return { nodes, edges }; }
  const root = tree.rootNode;

  const importedSymbols = {};      // local name → 'php:FQN'
  const sameFileFns = new Map();   // name → fn id
  const sameFileClasses = new Set();
  const classMethods = new Map();  // `ClassName.method` → method node id
  const localTypes = new Map();    // $var → ClassName (same-file)
  const pendingCalls = [];         // [{callerId, calleeName}]
  const pendingMethodCalls = [];   // [{callerId, receiverVar, method}]

  function visit(n, currentFn) {
    const t = n.type;

    if (t === 'namespace_use_declaration' || t === 'use_declaration') {
      handleUse(n);
    } else if (t === 'class_declaration') {
      const nn = n.childForFieldName && n.childForFieldName('name');
      if (nn) sameFileClasses.add(nn.text);
      handleClass(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
      return;
    } else if (t === 'interface_declaration' || t === 'trait_declaration' || t === 'enum_declaration') {
      handleTypeLike(n, t);
    } else if (t === 'function_definition' || t === 'method_declaration') {
      const fnNode = handleFunction(n);
      if (fnNode && t === 'method_declaration') {
        const enclosing = findEnclosingClass(n);
        const cnn = enclosing && enclosing.childForFieldName && enclosing.childForFieldName('name');
        if (cnn) classMethods.set(`${cnn.text}.${fnNode.name}`, fnNode.id);
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), fnNode ? fnNode.id : currentFn);
      return;
    } else if (t === 'function_call_expression') {
      handleCall(n, currentFn);
    } else if (t === 'scoped_call_expression' || t === 'member_call_expression') {
      handleDottedCall(n, currentFn);
    } else if (t === 'object_creation_expression') {
      handleObjectCreation(n);
    } else if (t === 'assignment_expression') {
      handleAssignment(n, currentFn);
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
  }

  function handleUse(n) {
    // `use Foo\Bar;`, `use Foo\Bar as Baz;`, `use Foo\{Bar, Baz};`
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type === 'namespace_use_clause') {
        // children: qualified_name [as alias]
        const qn = findChild(c, 'qualified_name') || findChild(c, 'name');
        const aliasClause = findChild(c, 'namespace_aliasing_clause');
        if (!qn) continue;
        const fqn = qn.text;
        const aliasName = aliasClause ? (findChild(aliasClause, 'name') || {}).text : fqn.split('\\').pop();
        if (aliasName) importedSymbols[aliasName] = `php:${fqn}`;
        emit(`file:${filePath}`, `module:${fqn}`, 'imports');
      } else if (c.type === 'namespace_use_group') {
        // `use Foo\{Bar, Baz as B};` — common children are use_instead_of_clause / namespace_use_clause
        const prefixNode = findChild(n, 'qualified_name') || findChild(n, 'name');
        const prefix = prefixNode ? prefixNode.text : '';
        for (let j = 0; j < c.childCount; j++) {
          const g = c.child(j);
          if (g.type === 'namespace_use_clause') {
            const qn = findChild(g, 'qualified_name') || findChild(g, 'name');
            const aliasClause = findChild(g, 'namespace_aliasing_clause');
            if (!qn) continue;
            const fqn = prefix ? `${prefix}\\${qn.text}` : qn.text;
            const aliasName = aliasClause ? (findChild(aliasClause, 'name') || {}).text : qn.text.split('\\').pop();
            if (aliasName) importedSymbols[aliasName] = `php:${fqn}`;
            emit(`file:${filePath}`, `module:${fqn}`, 'imports');
          }
        }
      }
    }
  }

  function handleClass(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    nodes.push({
      id: `class:${filePath}:${name}`, kind: 'class', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `class ${name}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
    // extends / implements
    const base = findChild(n, 'base_clause');
    if (base) {
      for (let i = 0; i < base.childCount; i++) {
        const id = base.child(i);
        if (id.type === 'name' || id.type === 'qualified_name') {
          emit(`class:${filePath}:${name}`, `class:*:${id.text.replace(/^\\+/, '')}`, 'extends');
        }
      }
    }
    const impl = findChild(n, 'class_interface_clause');
    if (impl) {
      for (let i = 0; i < impl.childCount; i++) {
        const id = impl.child(i);
        if (id.type === 'name' || id.type === 'qualified_name') {
          emit(`class:${filePath}:${name}`, `type:*:${id.text.replace(/^\\+/, '')}`, 'implements');
        }
      }
    }
  }

  function handleTypeLike(n, kindLabel) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `${kindLabel.replace('_declaration','')} ${name}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
  }

  function handleFunction(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    const params = findChild(n, 'formal_parameters');
    const fnNode = {
      id: `fn:${filePath}:${name}`, kind: 'function', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `function ${name}${params ? params.text.slice(0, 60) : '()'}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    };
    nodes.push(fnNode);
    sameFileFns.set(name, fnNode.id);
    return fnNode;
  }

  function handleCall(n, currentFn) {
    if (!currentFn) return;
    // function_call_expression → function (name or qualified_name) arguments
    const fn = n.childForFieldName ? n.childForFieldName('function') : n.child(0);
    if (!fn) return;
    if (fn.type !== 'name' && fn.type !== 'qualified_name') return;
    const calleeName = fn.text.replace(/^\\+/, '');
    pendingCalls.push({ callerId: currentFn, calleeName });
  }

  function findEnclosingClass(n) {
    let p = n.parent;
    while (p) {
      if (p.type === 'class_declaration') return p;
      p = p.parent;
    }
    return null;
  }

  function handleObjectCreation(n) {
    // `new Foo(...)` — look at the parent assignment_expression if any and
    // bind the LHS variable to the class Foo.
    const typeNode = findChild(n, 'name') || findChild(n, 'qualified_name');
    if (!typeNode) return;
    const className = typeNode.text.replace(/^\\+/, '');
    const parent = n.parent;
    if (!parent || parent.type !== 'assignment_expression') return;
    const left = parent.childForFieldName && parent.childForFieldName('left');
    if (!left || left.type !== 'variable_name') return;
    // `$x` text is '$x' — store under '$x' so `$x->method()` resolves.
    localTypes.set(left.text, className);
  }

  function handleAssignment(n, currentFn) {
    // `$this->field = expr` inside a method → mutates edge.
    if (!currentFn) return;
    const left = n.childForFieldName && n.childForFieldName('left');
    if (!left) return;
    if (left.type === 'member_access_expression') {
      const obj = left.childForFieldName && left.childForFieldName('object');
      const name = left.childForFieldName && left.childForFieldName('name');
      if (!name) return;
      const field = name.text;
      if (obj && obj.type === 'variable_name' && obj.text === '$this') {
        emit(currentFn, `variable:${filePath}:this.${field}`, 'mutates');
      } else if (obj && obj.type === 'variable_name') {
        emit(currentFn, `variable:${filePath}:${obj.text}.${field}`, 'mutates');
      }
    }
  }

  function handleDottedCall(n, currentFn) {
    if (!currentFn) return;
    // `$this->method(...)` or `Class::method(...)` — resolve `method` against
    // imported names or leave abstract.
    const method = n.childForFieldName ? n.childForFieldName('name') : null;
    if (!method || (method.type !== 'name' && method.type !== 'member_name')) return;
    const calleeName = method.text;
    // For scoped_call_expression we can also see the scope (class) — resolve
    // against importedSymbols if it's a known alias.
    const scope = n.childForFieldName ? n.childForFieldName('scope') : null;
    if (scope && (scope.type === 'name' || scope.type === 'qualified_name')) {
      const className = scope.text.replace(/^\\+/, '');
      const fqn = importedSymbols[className] || `php:${className}`;
      emit(currentFn, `fn:${fqn}::${calleeName}`, 'calls');
      return;
    }
    // `$x->foo()` — try to resolve $x's class via localTypes.
    const obj2 = n.childForFieldName && n.childForFieldName('object');
    if (obj2 && obj2.type === 'variable_name') {
      pendingMethodCalls.push({
        callerId: currentFn,
        receiverVar: obj2.text,
        method: calleeName,
      });
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
    const targetFqn = importedSymbols[calleeName];
    if (targetFqn) { emit(callerId, `${targetFqn}::${calleeName}`, 'calls'); continue; }
    emit(callerId, `unresolved:${calleeName}`, 'calls');
  }

  // Method dispatch — `$x->m()` where $x = new Foo() (same-file only).
  for (const { callerId, receiverVar, method } of pendingMethodCalls) {
    const cls = localTypes.get(receiverVar);
    if (!cls || !sameFileClasses.has(cls)) continue;
    const methodId = classMethods.get(`${cls}.${method}`);
    if (methodId && methodId !== callerId) emit(callerId, methodId, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, GRAMMAR };
