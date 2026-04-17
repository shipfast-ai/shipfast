/**
 * Go AST extractor (tree-sitter-backed).
 *
 * Emits function/type nodes + imports + same-file calls. Cross-package
 * resolution via the import spec: `import "foo/bar"` with `bar.Func()` calls
 * emits `fn:foo/bar:Func` edges (same FQN-as-target pattern used by PHP/Rust).
 */

'use strict';

const { hashContent, makeEdgeEmitter } = require('./_common.cjs');
const ast = require('./_ast.cjs');

const EXTENSIONS = ['.go'];
const GRAMMAR = 'go';

const NON_CALL_KEYWORDS = new Set([
  'if','else','for','switch','case','defer','go','select','chan','range','return',
  'break','continue','func','type','var','const','struct','interface','map','import',
  'package','make','new','len','cap','append','copy','print','println','panic','recover',
  'nil','true','false','goto','fallthrough',
]);

function lineOf(n) { return { start: n.startPosition.row + 1, end: n.endPosition.row + 1 }; }
function findChild(n, type) {
  for (let i = 0; i < n.childCount; i++) if (n.child(i).type === type) return n.child(i);
  return null;
}

function resolveImport(fromFile, importPath) { return importPath; }

function extract(content, filePath) {
  const nodes = [];
  const { edges, emit } = makeEdgeEmitter();
  const lines = content.split('\n');

  let tree;
  try { tree = ast.parseSync(GRAMMAR, content); } catch { return { nodes, edges }; }
  const root = tree.rootNode;

  // packageAliases[alias] = 'import/path'. Used to resolve alias.Func() calls.
  const packageAliases = {};
  const sameFileFns = new Map();
  const pendingCalls = [];   // [{callerId, calleeName}]           — bare name
  const pendingScoped = [];  // [{callerId, pkg, member}]          — alias.Func

  function visit(n, currentFn) {
    const t = n.type;

    if (t === 'import_spec') {
      handleImportSpec(n);
    } else if (t === 'function_declaration' || t === 'method_declaration') {
      const fnNode = handleFunction(n);
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), fnNode ? fnNode.id : currentFn);
      return;
    } else if (t === 'type_declaration') {
      handleTypeDecl(n);
    } else if (t === 'call_expression') {
      handleCall(n, currentFn);
    }

    for (let i = 0; i < n.childCount; i++) visit(n.child(i), currentFn);
  }

  function handleImportSpec(n) {
    // `import_spec` children: [optional package_identifier] interpreted_string_literal
    const pathNode = findChild(n, 'interpreted_string_literal');
    if (!pathNode) return;
    const importPath = pathNode.text.replace(/^"|"$/g, '');
    emit(`file:${filePath}`, `module:${importPath}`, 'imports');

    const aliasNode = findChild(n, 'package_identifier') || findChild(n, 'blank_identifier');
    const alias = aliasNode ? aliasNode.text : importPath.split('/').pop();
    if (alias && alias !== '_' && alias !== '.') {
      packageAliases[alias] = importPath;
    }
  }

  function handleFunction(n) {
    const nameNode = n.childForFieldName && n.childForFieldName('name');
    if (!nameNode) return null;
    const name = nameNode.text;
    const { start, end } = lineOf(n);
    const params = n.childForFieldName && n.childForFieldName('parameters');
    const fnNode = {
      id: `fn:${filePath}:${name}`, kind: 'function', name, file_path: filePath,
      line_start: start, line_end: end,
      signature: `func ${name}${params ? params.text.slice(0, 60) : '()'}`,
      hash: hashContent(lines.slice(start - 1, end).join('\n')),
    };
    nodes.push(fnNode);
    sameFileFns.set(name, fnNode.id);
    return fnNode;
  }

  function handleTypeDecl(n) {
    // `type_declaration` can contain multiple type_spec children (for `type (…)` blocks).
    for (let i = 0; i < n.childCount; i++) {
      const spec = n.child(i);
      if (spec.type !== 'type_spec' && spec.type !== 'type_alias') continue;
      const nameNode = spec.childForFieldName && spec.childForFieldName('name');
      if (!nameNode) continue;
      const name = nameNode.text;
      const { start, end } = lineOf(spec);
      const typeNode = spec.childForFieldName && spec.childForFieldName('type');
      const label = typeNode && typeNode.type === 'struct_type' ? 'struct'
                  : typeNode && typeNode.type === 'interface_type' ? 'interface'
                  : 'type';
      nodes.push({
        id: `type:${filePath}:${name}`, kind: 'type', name, file_path: filePath,
        line_start: start, line_end: end,
        signature: `${label} ${name}`,
        hash: hashContent(lines.slice(start - 1, end).join('\n')),
      });
    }
  }

  function handleCall(n, currentFn) {
    if (!currentFn) return;
    const fn = n.childForFieldName && n.childForFieldName('function');
    if (!fn) return;
    if (fn.type === 'identifier') {
      pendingCalls.push({ callerId: currentFn, calleeName: fn.text });
    } else if (fn.type === 'selector_expression') {
      // `pkg.Func` or `x.Method`. Resolve pkg → import path if it matches an alias.
      const operand = fn.childForFieldName && fn.childForFieldName('operand');
      const field = fn.childForFieldName && fn.childForFieldName('field');
      if (operand && operand.type === 'identifier' && field) {
        pendingScoped.push({
          callerId: currentFn,
          pkg: operand.text,
          member: field.text,
        });
      }
    }
  }

  visit(root, null);

  const seen = new Set();
  for (const { callerId, calleeName } of pendingCalls) {
    const key = `${callerId}::bare::${calleeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (NON_CALL_KEYWORDS.has(calleeName)) continue;
    const sameFile = sameFileFns.get(calleeName);
    if (sameFile && sameFile !== callerId) { emit(callerId, sameFile, 'calls'); continue; }
    emit(callerId, `unresolved:${calleeName}`, 'calls');
  }
  for (const { callerId, pkg, member } of pendingScoped) {
    const key = `${callerId}::${pkg}.${member}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const importPath = packageAliases[pkg];
    if (!importPath) continue;   // local struct method — can't resolve without type info
    emit(callerId, `fn:${importPath}:${member}`, 'calls');
  }

  return { nodes, edges };
}

module.exports = { extensions: EXTENSIONS, extract, resolveImport, GRAMMAR };
