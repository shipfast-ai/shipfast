/**
 * Shared tree-sitter AST helper.
 *
 * Contract splits into async setup and sync per-file work:
 *   await preload(['javascript', ...])  — run once at indexer startup
 *   parseSync(name, source)              — sync after preload; returns tree
 *   querySync(name, queryString)         — sync after preload; returns Query
 *
 * Keeping parse/query sync means extract() stays sync and the indexer's
 * file loop doesn't need async rewiring. web-tree-sitter's Parser.parse()
 * IS synchronous once the runtime + grammar are loaded — only the
 * init/load steps are async.
 */

'use strict';

const path = require('path');
const fs = require('fs');

let TS = null;
let runtimeInited = false;
const grammarCache = new Map();   // name → Language
const parserCache  = new Map();   // name → Parser (pre-configured)
const queryCache   = new Map();   // `${lang}::${src}` → Query

const GRAMMARS_DIR = path.join(__dirname, 'grammars');

async function init() {
  if (runtimeInited) return;
  TS = require('web-tree-sitter');
  await TS.Parser.init();
  runtimeInited = true;
}

async function loadLanguage(name) {
  if (grammarCache.has(name)) return grammarCache.get(name);
  if (!runtimeInited) await init();
  const wasmPath = path.join(GRAMMARS_DIR, `tree-sitter-${name}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`tree-sitter grammar not found: ${wasmPath}`);
  }
  const lang = await TS.Language.load(wasmPath);
  grammarCache.set(name, lang);
  const parser = new TS.Parser();
  parser.setLanguage(lang);
  parserCache.set(name, parser);
  return lang;
}

/**
 * Preload a set of grammars for later sync access. Call once at startup.
 */
async function preload(names) {
  await init();
  for (const n of names) await loadLanguage(n);
}

/**
 * Sync parse. Throws if `name` wasn't preloaded. Extractors should only
 * call this from their (sync) extract() after the indexer has preloaded.
 */
function parseSync(name, source) {
  const parser = parserCache.get(name);
  if (!parser) throw new Error(`tree-sitter grammar '${name}' not preloaded — call preload([...]) first`);
  return parser.parse(source);
}

/**
 * Sync Query lookup/build. Results cached for the process lifetime.
 */
function querySync(name, queryString) {
  const key = `${name}::${queryString}`;
  if (queryCache.has(key)) return queryCache.get(key);
  const lang = grammarCache.get(name);
  if (!lang) throw new Error(`tree-sitter grammar '${name}' not preloaded — call preload([...]) first`);
  const q = new TS.Query(lang, queryString);
  queryCache.set(key, q);
  return q;
}

/**
 * Probe availability of a grammar on disk without loading it (used by the
 * indexer to decide whether --ast can handle a given extension).
 */
function grammarAvailable(name) {
  return fs.existsSync(path.join(GRAMMARS_DIR, `tree-sitter-${name}.wasm`));
}

module.exports = {
  init,
  loadLanguage,
  preload,
  parseSync,
  querySync,
  grammarAvailable,
};
