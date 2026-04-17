/**
 * Java AST extractor (tree-sitter-backed).
 *
 * Emits class/interface/enum/record types, method functions, imports,
 * extends and implements edges, plus same-file method calls.
 *
 * Cross-file method resolution would need classpath/JAR parsing, so we keep
 * it same-file + "imports" edges to module:<fqn> targets (same shape as
 * the regex java.cjs).
 */

'use strict';

const { hashContent, makeEdgeEmitter } = require('./_common.cjs');
const ast = require('./_ast.cjs');

const EXTENSIONS = ['.java'];
const GRAMMAR = 'java';

const NON_CALL_KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','return','break','continue','goto','default',
  'try','catch','finally','throw','throws','new','this','super','instanceof','typeof',
  'class','interface','enum','record','public','private','protected','static','final','abstract',
  'synchronized','native','transient','volatile','package','import','void','true','false','null',
  'System','out','println','print','String','Integer','Boolean','Object','Math',
]);

function lineOf(n) { return { start: n.startPosition.row + 1, end: n.endPosition.row + 1 }; }
function findChild(n, type) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === type) return n.child(i);
  return null;
}
function findAll(n, type, out = []) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === type) out.push(n.child(i));
  return out;
}

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  let tree;
  try { tree = ast.parseSync(GRAMMAR, content); } catch { return { nodes, edges }; }
  const root = tree.rootNode;

  const sameFileFns = new Map();
  const pendingCalls = [];

  function visit(n, currentFn) {
    const t = n.type;

    if (t === 'import_declaration') {
      handleImport(n);
    } else if (t === 'class_declaration' || t === 'record_declaration') {
      handleClass(n);
    } else if (t === 'interface_declaration') {
      handleInterface(n);
    } else if (t === 'enum_declaration') {
      handleEnum(n);
    } else if (t === 'method_declaration' || t === 'constructor_declaration') {
      const fnNode = handleMethod(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), fnNode ? fnNode.id : currentFn);
      return;
    } else if (t === 'method_invocation') {
      handleCall(n, currentFn);
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
  }

  function handleImport(n) {
    // `import foo.bar.Baz;` or `import static foo.bar.Baz.qux;`
    const nameNode = findChild(n, 'scoped_identifier') || findChild(n, 'identifier');
    if (nameNode) emit(`file:${filePath}`, `module:${nameNode.text}`, 'imports');
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
    // superclass
    const superclass = findChild(n, 'superclass');
    if (superclass) {
      const id = findChild(superclass, 'type_identifier') || findChild(superclass, 'identifier');
      if (id) emit(`class:${filePath}:${name}`, `class:*:${id.text}`, 'extends');
    }
    // implements (super_interfaces → type_list → type_identifier*)
    const superInts = findChild(n, 'super_interfaces');
    if (superInts) {
      const list = findChild(superInts, 'type_list') || superInts;
      for (let i = 0; i < list.childCount; i++) {
        const c = list.child(i);
        if (c.type === 'type_identifier' || c.type === 'identifier') {
          emit(`class:${filePath}:${name}`, `type:*:${c.text}`, 'implements');
        }
      }
    }
  }

  function handleInterface(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `interface ${name}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
  }

  function handleEnum(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    nodes.push({
      id: `type:${filePath}:${name}`, kind: 'type', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `enum ${name}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    });
  }

  function handleMethod(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    const params = findChild(n, 'formal_parameters');
    const returnType = n.childForFieldName && n.childForFieldName('type');
    const fnNode = {
      id: `fn:${filePath}:${name}`, kind: 'function', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `${returnType ? returnType.text + ' ' : ''}${name}${params ? params.text.slice(0, 60) : '()'}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    };
    nodes.push(fnNode);
    sameFileFns.set(name, fnNode.id);
    return fnNode;
  }

  function handleCall(n, currentFn) {
    if (!currentFn) return;
    // `method_invocation` children: [object ".", name, arguments]. We want bare
    // `foo(...)` where object is absent, or `this.foo(...)`.
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return;
    const name = nameNode.text;
    const obj = n.childForFieldName && n.childForFieldName('object');
    // Skip chained calls like `x.y.z()` — can't resolve without type info.
    if (obj && obj.type !== 'this') return;
    pendingCalls.push({ callerId: currentFn, calleeName: name });
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
    emit(callerId, `unresolved:${calleeName}`, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, GRAMMAR };
