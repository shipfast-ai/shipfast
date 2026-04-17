/**
 * Project-wide symbol resolver.
 *
 * Extractors emit `calls` edges with target like `unresolved:<name>` when the
 * callee can't be resolved to a same-file function or an explicit import.
 * After all files are extracted, this resolver:
 *
 *   1. Builds a name → [nodeId] index from every function/class/method node
 *      collected this run.
 *   2. For each `unresolved:<name>` edge:
 *        - 0 candidates   → drop (likely a stdlib / platform call)
 *        - 1 candidate    → emit a concrete calls edge (high confidence)
 *        - 2–5 candidates → emit edges to ALL candidates (ambiguous but useful)
 *        - >5 candidates  → drop (name too generic; false-positive risk)
 *
 * Same-file edges that already resolved stay untouched.
 *
 * This closes the cross-file gap for languages without named imports (Swift,
 * Ruby, Lua, C, C++) and turbocharges every other language by filling in
 * calls to project-local functions that weren't imported via recognisable
 * syntax.
 */

'use strict';

const UNRESOLVED_PREFIX = 'unresolved:';
const MAX_CANDIDATES_PER_NAME = 5;

/**
 * Resolve every `unresolved:<name>` edge against a name-index built from
 * `symbolNodes` (nodes with kind in {function, class, type}).
 *
 *   symbolNodes: iterable of node objects ({ id, kind, name, ... })
 *   edges:       iterable of { source, target, kind, weight? }
 *
 * Returns: a new array of edges. Resolved edges carry their new concrete
 * target. Unresolvable edges are omitted.
 */
function resolveEdges(symbolNodes, edges) {
  const byName = new Map(); // name → Set of node ids
  for (const n of symbolNodes) {
    if (!n || !n.name) continue;
    if (n.kind !== 'function' && n.kind !== 'class' && n.kind !== 'type') continue;
    if (!byName.has(n.name)) byName.set(n.name, new Set());
    byName.get(n.name).add(n.id);
  }

  const out = [];
  const seen = new Set(); // dedupe source+target+kind

  for (const edge of edges) {
    const target = edge.target || '';
    if (!target.startsWith(UNRESOLVED_PREFIX)) {
      // Pass-through resolved edges unchanged.
      pushOnce(out, seen, edge);
      continue;
    }
    const name = target.slice(UNRESOLVED_PREFIX.length);
    const candidates = byName.get(name);
    if (!candidates || candidates.size === 0) continue; // drop — no match
    if (candidates.size > MAX_CANDIDATES_PER_NAME) continue; // drop — too generic

    for (const id of candidates) {
      if (id === edge.source) continue; // no self-edges
      pushOnce(out, seen, { ...edge, target: id });
    }
  }

  return out;
}

function pushOnce(out, seen, edge) {
  const key = `${edge.source}::${edge.target}::${edge.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(edge);
}

module.exports = { resolveEdges, UNRESOLVED_PREFIX, MAX_CANDIDATES_PER_NAME };
