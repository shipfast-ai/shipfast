/**
 * Shared tree-sitter AST helper.
 *
 * Thin wrapper over web-tree-sitter:
 *   init()                    — async, idempotent. Loads the runtime WASM.
 *   loadLanguage(name)        — async, cached. Loads a grammar .wasm by name.
 *                               'name' maps to brain/extractors/grammars/tree-sitter-<name>.wasm
 *   parse(lang, source)       — sync (after init/loadLanguage). Returns a tree.
 *   query(lang, queryString)  — sync, cached. Returns a Query ready to `.matches()`.
 *
 * Keep the surface small; extractors stay language-specific.
 */

'use strict';

const path = require('path');
const fs = require('fs');

let TS = null;
let inited = false;
const grammarCache = new Map();   // name → Language
const parserCache  = new Map();   // name → Parser (pre-configured)
const queryCache   = new Map();   // `${lang}::${src}` → Query

const GRAMMARS_DIR = path.join(__dirname, 'grammars');

async function init() {
  if (inited) return;
  TS = require('web-tree-sitter');
  await TS.Parser.init();
  inited = true;
}

async function loadLanguage(name) {
  if (grammarCache.has(name)) return grammarCache.get(name);
  if (!inited) await init();
  const wasmPath = path.join(GRAMMARS_DIR, `tree-sitter-${name}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`tree-sitter grammar not found: ${wasmPath}`);
  }
  const lang = await TS.Language.load(wasmPath);
  grammarCache.set(name, lang);
  return lang;
}

async function getParser(name) {
  if (parserCache.has(name)) return parserCache.get(name);
  const lang = await loadLanguage(name);
  const parser = new TS.Parser();
  parser.setLanguage(lang);
  parserCache.set(name, parser);
  return parser;
}

async function parse(name, source) {
  const parser = await getParser(name);
  return parser.parse(source);
}

async function query(name, queryString) {
  const key = `${name}::${queryString}`;
  if (queryCache.has(key)) return queryCache.get(key);
  const lang = await loadLanguage(name);
  const q = new TS.Query(lang, queryString);
  queryCache.set(key, q);
  return q;
}

module.exports = { init, loadLanguage, parse, query };
