/**
 * ShipFast Codebase Indexer v2
 *
 * Batch SQL mode: collects all INSERTs in memory, writes one transaction.
 * 10x faster than v1 (single sqlite3 call instead of per-insert).
 *
 * Supports: --changed-only (git-dirty files only, ~100ms incremental)
 * Language-specific extraction is delegated to brain/extractors/ registry.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const brain = require('./index.cjs');
const registry = require('./extractors/index.cjs');

// Source files worth indexing (code that humans write)
const INDEXABLE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',       // JavaScript / TypeScript
  '.rs',                                                 // Rust
  '.py', '.pyw',                                         // Python
  '.go',                                                 // Go
  '.java',                                               // Java
  '.kt', '.kts',                                         // Kotlin
  '.swift',                                              // Swift
  '.c', '.h', '.cpp', '.cc', '.hpp', '.cxx',            // C / C++
  '.rb',                                                 // Ruby
  '.php',                                                // PHP
  '.dart',                                               // Dart / Flutter
  '.ex', '.exs',                                         // Elixir
  '.scala', '.sc',                                       // Scala
  '.zig',                                                // Zig
  '.lua',                                                // Lua
  '.r', '.R',                                            // R
  '.jl',                                                 // Julia
  '.cs',                                                 // C#
  '.fs', '.fsx',                                         // F#
  '.vue', '.svelte', '.astro',                           // Frontend frameworks
  '.md', '.mdx',                                          // Markdown (docs, skills, READMEs)
]);

// Directories to skip at ANY depth (build output, deps, caches, generated, IDE).
// `vendor` is here because it's third-party code 99% of the time — Composer,
// Go modules, and Laravel's public/vendor bundled JS all go through this path.
// The rare legit exception (Laravel's resources/views/vendor view overrides)
// is handled via PATH_EXCEPTIONS below.
const SKIP_DIRS_ANYWHERE = new Set([
  // JavaScript / Node / Frontend
  'node_modules', '.next', '.nuxt', '.svelte-kit', '.output', '.vuepress',
  '.docusaurus', '.parcel-cache', '.cache', '.turbo', '.vite',
  'jspm_packages', 'web_modules', 'bower_components', '.pnpm-store',
  // Python
  '__pycache__', '.venv', '.eggs', 'sdist', 'wheels',
  '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.hypothesis',
  'htmlcov', '.ipynb_checkpoints', 'site-packages', '.pixi',
  // Rust
  'target',
  // Go / PHP Composer — dependencies at any depth
  'vendor',
  // Java / Kotlin / Scala / Android
  '.gradle', '.kotlin', '.mtj.tmp',
  // Swift / iOS
  'Pods', 'DerivedData', 'xcuserdata', 'Carthage',
  // Ruby
  '.bundle',
  // Dart / Flutter
  '.dart_tool', '.pub-cache',
  // Git
  '.git',
  // IDE / Editor
  '.vscode', '.idea', '.fleet', '.vs',
  // Test / Coverage
  '.nyc_output',
  // ShipFast / GSD
  '.shipfast', '.planning', '.gsd',
  // Misc generated / temp
  '.temp', '.serverless', '.firebase', '.dynamodb', '.docker',
]);

// Directories to skip ONLY at the repo root. These names are common as
// legitimate nested subdirectories — e.g. src/types/spec/, a repo with a
// tmp/ at root is output but app/tmp/ might be real code. Root-only keeps
// the common case safe without blowing away nested code.
const SKIP_DIRS_AT_ROOT = new Set([
  // Build output (tree root only — monorepo deep build dirs handled by tool configs)
  'dist', 'build', 'out', '_build', '.build', 'Release',
  // Python
  'venv', 'env', 'eggs',
  // Elixir
  'deps', '_build', 'cover',
  // Coverage / test scaffolding
  'coverage', 'spec',
  // Misc temp / log
  'tmp', 'temp', 'log', 'logs',
]);

// Explicit path prefixes (repo-relative) to keep indexed even if a segment
// matches SKIP_DIRS_ANYWHERE. Narrow and deliberate — Laravel is the only
// framework we currently carry an exception for.
const PATH_EXCEPTIONS = [
  /^resources[/\\]views[/\\]vendor(?:[/\\]|$)/, // Laravel: user-customized view overrides
];

// Back-compat alias so older callers that reference SKIP_DIRS still work. Prefer
// the two sets above for any new logic.
const SKIP_DIRS = new Set([...SKIP_DIRS_ANYWHERE, ...SKIP_DIRS_AT_ROOT]);

// Files to skip by exact name (lock files, generated, env, data)
const SKIP_FILES = new Set([
  // Lock files (every language)
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'Pipfile.lock',
  'composer.lock', 'pubspec.lock', 'go.sum', 'flake.lock',
  'mix.lock', 'packages.lock.json',
  // Env files
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  // Generated / config (not source code)
  '.DS_Store', 'Thumbs.db',
  '.eslintcache', '.stylelintcache', '.prettiercache',
  '.tsbuildinfo',
  // Data files
  'db.sqlite3', 'db.sqlite3-journal',
]);

// ============================================================
// File discovery
// ============================================================

function discoverFiles(rootDir, maxFiles = 2000) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 10 || files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        const entryRel = path.relative(rootDir, path.join(dir, entry.name)).replace(/\\/g, '/');
        const isException = PATH_EXCEPTIONS.some(re => re.test(entryRel));
        // Skip unless the repo-relative path is in PATH_EXCEPTIONS:
        //   - always-skip names (node_modules, vendor, etc.) at any depth
        //   - root-only names (dist, build, spec, etc.) at depth=0 only
        //   - any hidden directory (name starts with `.`)
        const skip = !isException && (
          SKIP_DIRS_ANYWHERE.has(entry.name)
          || (depth === 0 && SKIP_DIRS_AT_ROOT.has(entry.name))
          || entry.name.startsWith('.')
        );
        if (!skip) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile() && INDEXABLE.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) {
        // Also skip minified/generated files by suffix pattern
        const name = entry.name;
        if (name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.bundle.js') ||
            name.endsWith('.chunk.js') || name.endsWith('.map') || name.endsWith('.d.ts')) {
          // skip generated/minified files
        } else {
          files.push(path.join(dir, entry.name));
        }
      }
    }
  }
  walk(rootDir, 0);
  return files;
}

function discoverChangedFiles(cwd) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
    const allChanged = (output + '\n' + untracked).split('\n').filter(Boolean);
    return allChanged
      .filter(f => INDEXABLE.has(path.extname(f)))
      .map(f => path.join(cwd, f))
      .filter(f => fs.existsSync(f));
  } catch {
    return [];
  }
}

// ============================================================
// Hashing
// ============================================================

function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

// ============================================================
// SQL escaping — use brain.esc() as single source of truth
// ============================================================

const esc = brain.esc;
const escLike = brain.escLike || ((s) => String(s == null ? '' : s).replace(/'/g, "''"));

// ============================================================
// Batch SQL collector
// ============================================================

class BatchCollector {
  constructor() {
    this.statements = [];
  }

  // Purge stale per-file symbol nodes and outbound edges before re-inserting.
  // Runs inside the same transaction as the new INSERTs so the update is atomic.
  cleanupFile(filePath) {
    const p = esc(filePath);
    const pLike = escLike(filePath);
    this.statements.push(
      `DELETE FROM nodes WHERE file_path = '${p}' AND kind != 'file';`,
      `DELETE FROM edges WHERE source = 'file:${p}' ` +
        `OR source LIKE 'fn:${pLike}:%' ESCAPE '\\' ` +
        `OR source LIKE 'type:${pLike}:%' ESCAPE '\\' ` +
        `OR source LIKE 'class:${pLike}:%' ESCAPE '\\' ` +
        `OR source LIKE 'component:${pLike}:%' ESCAPE '\\';`
    );
  }

  addNode(node) {
    const { id, kind, name, file_path, line_start, line_end, signature, hash, metadata } = node;
    this.statements.push(
      `INSERT OR REPLACE INTO nodes (id, kind, name, file_path, line_start, line_end, signature, hash, metadata, updated_at) VALUES ('${esc(id)}', '${esc(kind)}', '${esc(name)}', '${esc(file_path || '')}', ${line_start || 'NULL'}, ${line_end || 'NULL'}, '${esc(signature || '')}', '${esc(hash || '')}', '${esc(JSON.stringify(metadata || {}))}', strftime('%s', 'now'));`
    );
  }

  addEdge(source, target, kind, weight = 1.0) {
    this.statements.push(
      `INSERT OR REPLACE INTO edges (source, target, kind, weight) VALUES ('${esc(source)}', '${esc(target)}', '${esc(kind)}', ${weight});`
    );
  }

  toSQL() {
    if (this.statements.length === 0) return '';
    return 'BEGIN TRANSACTION;\n' + this.statements.join('\n') + '\nCOMMIT;\n';
  }

  get count() { return this.statements.length; }
}

// ============================================================
// Main indexer (batch mode)
// ============================================================

function indexCodebase(cwd, opts = {}) {
  const { verbose = false, maxFiles = 2000, changedOnly = false, useAst = false } = opts;

  if (!brain.brainExists(cwd)) {
    brain.initBrain(cwd);
  }

  // AST mode: the caller is responsible for pre-awaiting `ast.preload([...])`
  // before calling indexCodebase (see the CLI entry below). Here we build an
  // ext → AST-extractor map so the per-file dispatch below can pick it cleanly.
  let astExtByExt = null;
  if (useAst) {
    astExtByExt = {};
    for (const mod of ['./extractors/javascript-ast.cjs', './extractors/php-ast.cjs', './extractors/python-ast.cjs', './extractors/java-ast.cjs', './extractors/go-ast.cjs']) {
      try {
        const ex = require(mod);
        for (const e of ex.extensions) astExtByExt[e] = ex;
      } catch (err) {
        if (verbose) console.log('AST extractor failed to load: ' + mod + ' (' + err.message + ')');
      }
    }
    if (verbose) {
      const langs = [...new Set(Object.values(astExtByExt).map(x => x.GRAMMAR))].join(', ');
      console.log('AST mode enabled for: ' + langs);
    }
  }

  const startTime = Date.now();

  // File discovery
  const files = changedOnly ? discoverChangedFiles(cwd) : discoverFiles(cwd, maxFiles);

  // Build hash map of existing nodes for skip detection
  const existingHashes = {};
  if (!changedOnly) {
    const existing = brain.query(cwd, "SELECT id, hash FROM nodes WHERE kind = 'file'");
    for (const row of existing) {
      existingHashes[row.id] = row.hash;
    }
  }

  // Extract all symbols into batch collector
  const batch = new BatchCollector();
  let indexed = 0, skipped = 0, totalNodes = 0, totalEdges = 0;

  // Project-wide resolver state — collected across all files, flushed after
  // the main loop so every `unresolved:<name>` edge can consult the full
  // symbol index (not just same-file).
  const resolver = require('../core/resolver.cjs');
  const allSymbolNodes = [];   // function/class/type nodes
  const pendingEdges = [];     // edges deferred to the resolver pass

  // Per-language config cache keyed by extractor (so JS tsconfig loads once, etc.)
  const configCache = new Map();
  function getConfigFor(extractor) {
    if (!extractor || typeof extractor.loadConfig !== 'function') return null;
    if (configCache.has(extractor)) return configCache.get(extractor);
    let cfg = null;
    try { cfg = extractor.loadConfig(cwd); } catch { cfg = null; }
    configCache.set(extractor, cfg);
    return cfg;
  }

  for (const file of files) {
    try {
      const relPath = path.relative(cwd, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');
      const fileHash = hashContent(content);

      // Skip unchanged files
      if (!changedOnly && existingHashes[`file:${relPath}`] === fileHash) {
        skipped++;
        continue;
      }

      // Purge stale edges/symbols from any previous index of this file
      batch.cleanupFile(relPath);

      // File node
      batch.addNode({
        id: `file:${relPath}`, kind: 'file', name: path.basename(file),
        file_path: relPath, hash: fileHash
      });

      // Dispatch to language extractor via registry.
      // In --ast mode, JS/TS/JSX/TSX/MJS/CJS files use the AST extractor;
      // everything else continues to use the regex registry.
      const ext = path.extname(file);
      let extractor = registry.getExtractor(ext);
      if (astExtByExt && astExtByExt[ext]) extractor = astExtByExt[ext];
      const ctx = { cwd, aliases: getConfigFor(extractor) };
      const result = extractor ? extractor.extract(content, relPath, ctx) : { nodes: [], edges: [] };

      for (const node of result.nodes) {
        batch.addNode(node);
        if (node.kind === 'function' || node.kind === 'class' || node.kind === 'type') {
          allSymbolNodes.push(node);
        }
      }
      // Defer edges. The resolver pass (after the loop) rewrites any
      // `unresolved:<name>` targets against the project-wide symbol index.
      for (const edge of result.edges) pendingEdges.push(edge);

      indexed++;
      totalNodes += result.nodes.length;
      totalEdges += result.edges.length;
    } catch (err) {
      if (verbose) console.error(`  skip ${path.relative(cwd, file)}: ${err.message}`);
    }
  }

  // Project-wide resolver pass — replace `unresolved:<name>` edge targets
  // with concrete node ids from the cross-file symbol index. Closes the
  // cross-file calls gap for languages without named imports (Swift/Ruby/C/…).
  const resolvedEdges = resolver.resolveEdges(allSymbolNodes, pendingEdges);
  for (const edge of resolvedEdges) {
    batch.addEdge(edge.source, edge.target, edge.kind, edge.weight);
  }
  totalEdges = resolvedEdges.length;

  // Execute batch in single transaction
  const sql = batch.toSQL();
  if (sql) {
    const dbPath = brain.getBrainPath(cwd);
    execFileSync('sqlite3', [dbPath], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  // Clean orphan nodes: remove entries for files that no longer exist on disk
  let cleaned = 0;
  if (!changedOnly) {
    const discoveredPaths = new Set(files.map(f => path.relative(cwd, f).replace(/\\/g, '/')));
    const existingFiles = brain.query(cwd, "SELECT file_path FROM nodes WHERE kind = 'file'");
    const orphans = existingFiles.filter(row => !discoveredPaths.has(row.file_path));

    if (orphans.length > 0) {
      const cleanSql = ['BEGIN TRANSACTION;'];
      for (const orphan of orphans) {
        const escaped = orphan.file_path.replace(/'/g, "''");
        // Delete file node + all symbols from that file + all edges from/to that file
        cleanSql.push(`DELETE FROM nodes WHERE file_path = '${escaped}';`);
        cleanSql.push(`DELETE FROM edges WHERE source LIKE 'file:${escaped}%' OR target LIKE 'file:${escaped}%' OR source LIKE 'fn:${escaped}%' OR source LIKE 'type:${escaped}%' OR source LIKE 'class:${escaped}%' OR source LIKE 'component:${escaped}%';`);
      }
      cleanSql.push('COMMIT;');
      const dbPath = brain.getBrainPath(cwd);
      execFileSync('sqlite3', [dbPath], { input: cleanSql.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] });
      cleaned = orphans.length;
    }
  }

  // Update hot files from git history on every index
  brain.updateHotFiles(cwd);

  // Run co-change analysis from git history to detect files that change together
  try {
    const gitIntelPath = path.join(__dirname, '..', 'core', 'git-intel.cjs');
    if (fs.existsSync(gitIntelPath)) {
      const gitIntel = require(gitIntelPath);
      gitIntel.analyzeCoChanges(cwd, 200);
    }
  } catch { /* git-intel optional */ }

  // Compute architecture layers from import graph
  let layers = 0;
  try {
    const archPath = path.join(__dirname, '..', 'core', 'architecture.cjs');
    if (fs.existsSync(archPath)) {
      const arch = require(archPath);
      const result = arch.computeArchitecture(cwd);
      layers = result.computed || 0;
    }
  } catch { /* architecture optional */ }

  // Scan project signals (deps, scripts, framework, runtime) — new in v1.7.0
  try {
    const signals = require('./signals/index.cjs');
    signals.scanAll(cwd);
  } catch { /* signals optional */ }

  const elapsed = Date.now() - startTime;
  return { files: files.length, indexed, skipped, cleaned, layers, nodes: totalNodes, edges: totalEdges, statements: batch.count, elapsed_ms: elapsed };
}

// CLI mode
if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const changedOnly = args.includes('--changed-only');
  const fresh = args.includes('--fresh');
  // v2.0: AST mode is default. --regex opts out to the legacy path.
  // --ast still works for explicit opt-in (no-op when already default).
  let useAst = !args.includes('--regex');
  const cwd = args.find(a => !a.startsWith('-')) || process.cwd();

  // --fresh flag: delete existing brain.db for full reindex
  if (fresh) {
    const dbPath = path.join(cwd, '.shipfast', 'brain.db');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Cleared existing brain.db');
    }
  }

  // --ast flag: preload tree-sitter grammar(s) before the sync index loop.
  // Failure here is non-fatal — indexCodebase will fall back to regex.
  if (useAst) {
    try {
      const astHelper = require('./extractors/_ast.cjs');
      const grammars = [];
      for (const mod of ['./extractors/javascript-ast.cjs', './extractors/php-ast.cjs', './extractors/python-ast.cjs', './extractors/java-ast.cjs', './extractors/go-ast.cjs']) {
        try {
          const ex = require(mod);
          if (ex.GRAMMARS_USED) grammars.push(...ex.GRAMMARS_USED);
          else if (ex.GRAMMAR) grammars.push(ex.GRAMMAR);
        } catch {}
      }
      await astHelper.preload([...new Set(grammars)]);
    } catch (err) {
      console.log('AST preload failed (' + err.message + ') — continuing with regex');
      // Critical: disable AST so the file loop uses regex extractors.
      // Without this the indexer would route JS/PHP/… to AST extractors
      // whose parseSync() throws on every file (grammar not preloaded).
      useAst = false;
    }
  }

  console.log(`Indexing ${cwd}...`);
  const result = indexCodebase(cwd, { verbose: true, changedOnly, useAst });
  const parts = [`Done in ${result.elapsed_ms}ms: ${result.indexed} files indexed`];
  if (result.skipped) parts.push(`${result.skipped} unchanged`);
  if (result.cleaned) parts.push(`${result.cleaned} deleted files cleaned`);
  parts.push(`${result.nodes} symbols, ${result.edges} edges`);
  console.log(parts.join(', '));
})();

module.exports = { indexCodebase, discoverFiles, discoverChangedFiles, BatchCollector };
