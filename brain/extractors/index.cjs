/**
 * Language extractor registry.
 *
 * Each extractor exports { extensions, extract, resolveImport, loadConfig? }
 * and registers itself via this module's getExtractor() lookup.
 *
 * Adding a language = drop in brain/extractors/<lang>.cjs and list it below.
 * No edits to brain/indexer.cjs required.
 */

'use strict';

const EXTRACTOR_FILES = [
  './javascript.cjs',
  './rust.cjs',
  './python.cjs',
  './go.cjs',
  './java.cjs',
  './kotlin.cjs',
  './swift.cjs',
  './c.cjs',
  './cpp.cjs',
  './ruby.cjs',
  './php.cjs',
  './dart.cjs',
  './elixir.cjs',
  './scala.cjs',
  './zig.cjs',
  './lua.cjs',
  './r.cjs',
  './julia.cjs',
  './csharp.cjs',
  './fsharp.cjs',
  './sfc.cjs',
];

const byExtension = new Map();
const loaded = [];

for (const file of EXTRACTOR_FILES) {
  let mod;
  try { mod = require(file); }
  catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') continue;  // extractor not yet implemented
    throw err;
  }
  if (!mod || !Array.isArray(mod.extensions) || typeof mod.extract !== 'function') continue;
  loaded.push(mod);
  for (const ext of mod.extensions) byExtension.set(ext, mod);
}

function getExtractor(ext) {
  return byExtension.get(ext) || null;
}

function extract(ext, content, filePath, ctx) {
  const e = byExtension.get(ext);
  if (!e) return { nodes: [], edges: [] };
  return e.extract(content, filePath, ctx);
}

function resolveImport(ext, fromFile, importPath, ctx) {
  const e = byExtension.get(ext);
  if (!e || typeof e.resolveImport !== 'function') return importPath;
  return e.resolveImport(fromFile, importPath, ctx);
}

/**
 * All extensions registered across all extractors. Used by consumers
 * (e.g. core/architecture.cjs) that need to strip extensions uniformly.
 */
function knownExtensions() {
  return [...byExtension.keys()];
}

module.exports = {
  getExtractor,
  extract,
  resolveImport,
  knownExtensions,
  loaded,
};
