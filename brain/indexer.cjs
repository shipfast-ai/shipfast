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
]);

// Directories to skip (build output, deps, caches, generated, IDE)
const SKIP_DIRS = new Set([
  // JavaScript / Node / Frontend
  'node_modules', '.next', '.nuxt', '.svelte-kit', '.output', '.vuepress',
  '.docusaurus', '.parcel-cache', '.cache', '.turbo', '.vite',
  'jspm_packages', 'web_modules', 'bower_components', '.pnpm-store',
  // Build output (all languages)
  'dist', 'build', 'out', '_build', '.build', 'Release',
  // Python
  '__pycache__', '.venv', 'venv', 'env', '.eggs', 'eggs', 'sdist', 'wheels',
  '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.hypothesis',
  'htmlcov', '.ipynb_checkpoints', 'site-packages', '.pixi',
  // Rust
  'target',
  // Go
  'vendor',
  // Java / Kotlin / Scala / Android
  '.gradle', '.kotlin', '.mtj.tmp',
  // Swift / iOS
  'Pods', 'DerivedData', 'xcuserdata', 'Carthage',
  // Ruby
  '.bundle',
  // PHP
  // 'vendor' already listed under Go
  // Dart / Flutter
  '.dart_tool', '.pub-cache',
  // Elixir
  'deps', '_build', 'cover',
  // Git
  '.git',
  // IDE / Editor
  '.vscode', '.idea', '.fleet', '.vs',
  // Test / Coverage
  'coverage', '.nyc_output', 'spec',
  // ShipFast / GSD
  '.shipfast', '.planning', '.gsd',
  // Misc generated / temp
  'tmp', 'temp', '.temp', '.serverless', '.firebase', '.dynamodb',
  '.docker', 'log', 'logs',
]);

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
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
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
  const { verbose = false, maxFiles = 2000, changedOnly = false } = opts;

  if (!brain.brainExists(cwd)) {
    brain.initBrain(cwd);
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

      // Dispatch to language extractor via registry
      const ext = path.extname(file);
      const extractor = registry.getExtractor(ext);
      const ctx = { cwd, aliases: getConfigFor(extractor) };
      const result = extractor ? extractor.extract(content, relPath, ctx) : { nodes: [], edges: [] };

      for (const node of result.nodes) batch.addNode(node);
      for (const edge of result.edges) batch.addEdge(edge.source, edge.target, edge.kind);

      indexed++;
      totalNodes += result.nodes.length;
      totalEdges += result.edges.length;
    } catch (err) {
      if (verbose) console.error(`  skip ${path.relative(cwd, file)}: ${err.message}`);
    }
  }

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

  const elapsed = Date.now() - startTime;
  return { files: files.length, indexed, skipped, cleaned, layers, nodes: totalNodes, edges: totalEdges, statements: batch.count, elapsed_ms: elapsed };
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const changedOnly = args.includes('--changed-only');
  const fresh = args.includes('--fresh');
  const cwd = args.find(a => !a.startsWith('-')) || process.cwd();

  // --fresh flag: delete existing brain.db for full reindex
  if (fresh) {
    const dbPath = path.join(cwd, '.shipfast', 'brain.db');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Cleared existing brain.db');
    }
  }

  console.log(`Indexing ${cwd}...`);
  const result = indexCodebase(cwd, { verbose: true, changedOnly });
  const parts = [`Done in ${result.elapsed_ms}ms: ${result.indexed} files indexed`];
  if (result.skipped) parts.push(`${result.skipped} unchanged`);
  if (result.cleaned) parts.push(`${result.cleaned} deleted files cleaned`);
  parts.push(`${result.nodes} symbols, ${result.edges} edges`);
  console.log(parts.join(', '));
}

module.exports = { indexCodebase, discoverFiles, discoverChangedFiles, BatchCollector };
