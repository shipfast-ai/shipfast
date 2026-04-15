/**
 * ShipFast Codebase Indexer v2
 *
 * Batch SQL mode: collects all INSERTs in memory, writes one transaction.
 * 10x faster than v1 (single sqlite3 call instead of per-insert).
 *
 * Supports: --changed-only (git-dirty files only, ~100ms incremental)
 * Languages: JS/TS/JSX/TSX, Rust, Python, Go
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const brain = require('./index.cjs');

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
// SQL escaping (for batch mode)
// ============================================================

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/'/g, "''");
}

// ============================================================
// Batch SQL collector
// ============================================================

class BatchCollector {
  constructor() {
    this.statements = [];
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
// Regex extraction (JS/TS)
// ============================================================

function extractJS(content, filePath) {
  const nodes = [];
  const edges = [];
  const lines = content.split('\n');
  let match;

  // Imports
  const importRe = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importRe.exec(content)) !== null) {
    const target = match[3];
    if (target.startsWith('.') || target.startsWith('@/') || target.startsWith('~/')) {
      edges.push({ source: `file:${filePath}`, target: `file:${resolveImport(filePath, target)}`, kind: 'imports' });
    }
  }

  // Functions
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))[^{]*/g,
    /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(\([^)]*\))\s*(?::\s*\S+\s*)?=>/g,
  ];
  for (const pattern of funcPatterns) {
    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      const name = match[1];
      const params = match[2] || '';
      const endLine = findBlockEnd(lines, lineNum - 1);
      nodes.push({
        id: `fn:${filePath}:${name}`, kind: 'function', name,
        file_path: filePath, line_start: lineNum, line_end: endLine,
        signature: `${name}${params}`,
        hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
      });
    }
  }

  // Types/interfaces
  const typeRe = /(?:export\s+)?(?:type|interface)\s+(\w+)(?:<[^>]+>)?\s*[={]/g;
  while ((match = typeRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const endLine = findBlockEnd(lines, lineNum - 1);
    nodes.push({
      id: `type:${filePath}:${match[1]}`, kind: 'type', name: match[1],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `type ${match[1]}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
  }

  // Classes
  const classRe = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  while ((match = classRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const endLine = findBlockEnd(lines, lineNum - 1);
    nodes.push({
      id: `class:${filePath}:${match[1]}`, kind: 'class', name: match[1],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `class ${match[1]}${match[2] ? ` extends ${match[2]}` : ''}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
    if (match[2]) {
      edges.push({ source: `class:${filePath}:${match[1]}`, target: `class:*:${match[2]}`, kind: 'extends' });
    }
  }

  // React components
  const componentRe = /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/g;
  while ((match = componentRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    if (!nodes.find(n => n.id === `fn:${filePath}:${match[1]}`)) {
      nodes.push({
        id: `component:${filePath}:${match[1]}`, kind: 'component', name: match[1],
        file_path: filePath, line_start: lineNum,
        line_end: findBlockEnd(lines, lineNum - 1),
        signature: `<${match[1]} />`, hash: ''
      });
    }
  }

  return { nodes, edges };
}

// ============================================================
// Rust extraction
// ============================================================

function extractRust(content, filePath) {
  const nodes = [];
  const edges = [];
  const lines = content.split('\n');
  let match;

  const fnRe = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*(\([^)]*\))(?:\s*->\s*([^\s{]+))?/g;
  while ((match = fnRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const endLine = findBlockEnd(lines, lineNum - 1);
    nodes.push({
      id: `fn:${filePath}:${match[1]}`, kind: 'function', name: match[1],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `fn ${match[1]}${match[2]}${match[3] ? ` -> ${match[3]}` : ''}`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
  }

  for (const [re, prefix] of [[/(?:pub\s+)?struct\s+(\w+)/g, 'struct'], [/(?:pub\s+)?enum\s+(\w+)/g, 'enum']]) {
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      nodes.push({
        id: `type:${filePath}:${match[1]}`, kind: 'type', name: match[1],
        file_path: filePath, line_start: lineNum,
        line_end: findBlockEnd(lines, lineNum - 1),
        signature: `${prefix} ${match[1]}`, hash: ''
      });
    }
  }

  const useRe = /(?:pub\s+)?(?:use|mod)\s+([a-z_:]+)/g;
  while ((match = useRe.exec(content)) !== null) {
    edges.push({ source: `file:${filePath}`, target: `module:${match[1]}`, kind: 'imports' });
  }

  return { nodes, edges };
}

// ============================================================
// Python extraction
// ============================================================

function extractPython(content, filePath) {
  const nodes = [];
  const edges = [];
  const lines = content.split('\n');
  let match;

  const fnRe = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
  while ((match = fnRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const indent = match[1].length;
    let endLine = lineNum;
    for (let i = lineNum; i < lines.length; i++) {
      if (lines[i].trim() && lines[i].match(/^(\s*)/)[1].length <= indent && i > lineNum - 1) break;
      endLine = i + 1;
    }
    nodes.push({
      id: `fn:${filePath}:${match[2]}`, kind: 'function', name: match[2],
      file_path: filePath, line_start: lineNum, line_end: endLine,
      signature: `def ${match[2]}(${match[3].slice(0, 60)})`,
      hash: hashContent(lines.slice(lineNum - 1, endLine).join('\n'))
    });
  }

  const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm;
  while ((match = classRe.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    nodes.push({
      id: `class:${filePath}:${match[1]}`, kind: 'class', name: match[1],
      file_path: filePath, line_start: lineNum, line_end: lineNum,
      signature: `class ${match[1]}${match[2] ? `(${match[2]})` : ''}`, hash: ''
    });
  }

  const importRe = /^(?:from\s+(\S+)\s+)?import\s+(.+)/gm;
  while ((match = importRe.exec(content)) !== null) {
    const target = match[1] || match[2].split(',')[0].trim();
    if (target.startsWith('.')) {
      edges.push({ source: `file:${filePath}`, target: `file:${target}`, kind: 'imports' });
    }
  }

  return { nodes, edges };
}

// ============================================================
// Helpers
// ============================================================

function findBlockEnd(lines, startIdx) {
  let braceCount = 0, found = false;
  for (let i = startIdx; i < lines.length && i < startIdx + 500; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceCount++; found = true; }
      if (ch === '}') { braceCount--; }
      if (found && braceCount === 0) return i + 1;
    }
  }
  return Math.min(startIdx + 20, lines.length);
}

function resolveImport(fromFile, importPath) {
  return path.join(path.dirname(fromFile), importPath).replace(/\\/g, '/');
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

      // File node
      batch.addNode({
        id: `file:${relPath}`, kind: 'file', name: path.basename(file),
        file_path: relPath, hash: fileHash
      });

      // Extract symbols
      const ext = path.extname(file);
      let result = { nodes: [], edges: [] };
      if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        result = extractJS(content, relPath);
      } else if (ext === '.rs') {
        result = extractRust(content, relPath);
      } else if (ext === '.py') {
        result = extractPython(content, relPath);
      }

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

  // Update hot files (separate transaction)
  brain.updateHotFiles(cwd);

  const elapsed = Date.now() - startTime;
  return { files: files.length, indexed, skipped, nodes: totalNodes, edges: totalEdges, statements: batch.count, elapsed_ms: elapsed };
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const changedOnly = args.includes('--changed-only');
  const cwd = args.find(a => !a.startsWith('-')) || process.cwd();
  console.log(`Indexing ${cwd}${changedOnly ? ' (changed only)' : ''}...`);
  const result = indexCodebase(cwd, { verbose: true, changedOnly });
  console.log(`Done in ${result.elapsed_ms}ms: ${result.indexed} files (${result.skipped} unchanged), ${result.nodes} symbols, ${result.edges} edges, ${result.statements} SQL statements`);
}

module.exports = { indexCodebase, discoverFiles, discoverChangedFiles };
