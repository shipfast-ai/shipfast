/**
 * Shared utilities for language extractors.
 *
 * Three block-detection strategies cover every language in INDEXABLE:
 *   findBraceBlock  — C-family (JS, Rust, Go, Java, Kotlin, Swift, C/C++, etc.)
 *   findIndentBlock — off-side rule (Python, F#)
 *   findKeywordBlock — explicit-end (Ruby, Elixir, Julia, Lua)
 *
 * Extractors pick the helper that matches their language's scoping rules.
 */

'use strict';

const crypto = require('crypto');

function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

/**
 * Balance `{` and `}` from startIdx, skipping over string and comment contents.
 * Returns the 1-based line number (inclusive) where the block ends, or
 * startIdx + fallback if no balancing brace was found within maxScan lines.
 */
function findBraceBlock(lines, startIdx, maxScan = 500) {
  let depth = 0;
  let seen = false;
  const end = Math.min(lines.length, startIdx + maxScan);
  for (let i = startIdx; i < end; i++) {
    const line = lines[i];
    let j = 0;
    const n = line.length;
    while (j < n) {
      const c = line[j];
      const next = line[j + 1];
      if (c === '/' && next === '/') break;  // line comment — rest of line
      if (c === '/' && next === '*') {
        const closeIdx = line.indexOf('*/', j + 2);
        if (closeIdx === -1) { j = n; break; }
        j = closeIdx + 2; continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        j++;
        while (j < n) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === quote) { j++; break; }
          j++;
        }
        continue;
      }
      if (c === '{') { depth++; seen = true; j++; continue; }
      if (c === '}') {
        depth--;
        if (seen && depth === 0) return i + 1;
        j++; continue;
      }
      j++;
    }
  }
  return Math.min(startIdx + 20, lines.length);
}

/**
 * Indent-based scoping. The block started at startIdx with the given indent
 * (measured in leading whitespace chars). The block ends when a later non-empty
 * line has indent <= the given indent.
 */
function findIndentBlock(lines, startIdx, indent) {
  let end = startIdx + 1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const lead = line.match(/^(\s*)/)[1].length;
    if (lead <= indent) return end;
    end = i + 1;
  }
  return end;
}

/**
 * Keyword-based scoping for languages that use `end` (Ruby/Elixir/Julia/Lua).
 * Counts nested openers vs closers. Openers are a Set of words that open
 * nested blocks within the same construct (e.g. `do`, `if`, `case`); `closers`
 * defaults to ['end']. Returns 1-based line end.
 */
function findKeywordBlock(lines, startIdx, openers, closers = ['end'], maxScan = 500) {
  const openerSet = new Set(openers);
  const closerSet = new Set(closers);
  let depth = 1; // startIdx itself is an opener
  const end = Math.min(lines.length, startIdx + maxScan);
  // Rough token split — good enough for "keywords on their own" patterns
  const tokenRe = /\b[a-z_]\w*\b/g;
  for (let i = startIdx + 1; i < end; i++) {
    const line = lines[i].replace(/#.*$/, '').replace(/\/\/.*$/, ''); // strip line comments
    let m;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(line)) !== null) {
      if (openerSet.has(m[0])) depth++;
      else if (closerSet.has(m[0])) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
  }
  return Math.min(startIdx + 40, lines.length);
}

/**
 * Strip /* ... *\/ block comments. Used by C/C++ extractors before symbol scan
 * to avoid false matches inside comments.
 */
function stripBlockComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close === -1) break;
      // preserve newlines inside comment so line numbers stay accurate
      const chunk = src.slice(i, close + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i = close + 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/**
 * Build a uniform ctx passed to every extractor:
 *   { cwd, aliases, emitEdge, existsFile }
 *
 * Extractors MUST use emitEdge (which dedupes) instead of pushing edges
 * directly, so cross-pattern overlaps don't create duplicate rows.
 */
function makeEdgeEmitter() {
  const seen = new Set();
  const edges = [];
  return {
    edges,
    emit(source, target, kind) {
      const key = `${source}::${target}::${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target, kind });
    }
  };
}

/**
 * Line number (1-based) for an absolute index into `content`.
 */
function lineOfIndex(content, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Shared call-graph extractor. Emits same-file and cross-file `calls` edges.
 *
 *   content          full file text
 *   lines            content.split('\n')
 *   fnNodes          array of function/method node objects (with .name, .id, .line_start, .line_end)
 *   importedSymbols  { importedName → resolvedTargetFilePath }  (may be empty)
 *   filePath         relative path, used only for minified filename check
 *   emit             edge emitter from makeEdgeEmitter()
 *   callRe           regex capturing identifier-then-paren (default: /\b([A-Za-z_$][\w$]*)\s*\(/g)
 *   nonCallKeywords  Set<string> of language keywords to ignore as callees
 *
 * Bails out on minified-looking content to avoid O(n²) edge explosions.
 */
const DEFAULT_CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;
function emitCalls({ content, lines, fnNodes, importedSymbols, filePath, emit, callRe, nonCallKeywords }) {
  const fnIds = new Map();
  for (const n of fnNodes) if (n && n.kind === 'function') fnIds.set(n.name, n.id);
  if (fnIds.size === 0 && (!importedSymbols || Object.keys(importedSymbols).length === 0)) return;

  const isMin =
    fnIds.size > 200
    || /\.min\.|\.bundle\.|\.chunk\./.test(filePath)
    || (content.length > 50_000 && lines.length > 0 && content.length / lines.length > 400);
  if (isMin) return;

  const re = callRe || DEFAULT_CALL_RE;
  const skip = nonCallKeywords || new Set();
  for (const caller of fnNodes) {
    if (!caller || caller.kind !== 'function') continue;
    const body = lines.slice(caller.line_start - 1, caller.line_end).join('\n');
    re.lastIndex = 0;
    const seen = new Set();
    let m;
    while ((m = re.exec(body)) !== null) {
      const callee = m[1];
      if (callee === caller.name) continue;  // self-recursion
      if (skip.has(callee)) continue;
      if (seen.has(callee)) continue;
      seen.add(callee);
      const sameFile = fnIds.get(callee);
      if (sameFile) { emit(caller.id, sameFile, 'calls'); continue; }
      const targetFile = importedSymbols && importedSymbols[callee];
      if (targetFile) emit(caller.id, `fn:${targetFile}:${callee}`, 'calls');
    }
  }
}

module.exports = {
  hashContent,
  findBraceBlock,
  findIndentBlock,
  findKeywordBlock,
  stripBlockComments,
  makeEdgeEmitter,
  lineOfIndex,
  emitCalls,
};
