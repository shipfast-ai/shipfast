/**
 * ShipFast Architecture Layer Computation
 *
 * Derives architecture layers purely from the import graph + directory structure.
 * ZERO hardcoded patterns — works with any project, any language, any structure.
 *
 * How it works:
 *   1. Build import graph from brain.db edges
 *   2. Compute layer from graph depth (L0 = nothing imports it, LN = imports nothing)
 *   3. Index directory tree as folders with aggregated stats
 *   4. Detect folder roles from content (most exports = util, most imports = entry)
 */

'use strict';

const { execFileSync: safeExec } = require('child_process');
const path = require('path');
const brain = require('../brain/index.cjs');
const registry = require('../brain/extractors/index.cjs');

// ============================================================
// Ensure architecture table exists
// ============================================================

function ensureTable(cwd) {
  const dbPath = brain.getBrainPath(cwd);
  safeExec('sqlite3', [dbPath], {
    input: [
      "DROP TABLE IF EXISTS architecture;",
      "DROP TABLE IF EXISTS folders;",
      "CREATE TABLE IF NOT EXISTS architecture (file_path TEXT PRIMARY KEY, layer INTEGER NOT NULL, folder TEXT, imports_count INTEGER DEFAULT 0, imported_by_count INTEGER DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')));",
      "CREATE TABLE IF NOT EXISTS folders (folder_path TEXT PRIMARY KEY, file_count INTEGER DEFAULT 0, total_imports INTEGER DEFAULT 0, total_imported_by INTEGER DEFAULT 0, avg_layer REAL, role TEXT, updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')));",
      "CREATE INDEX IF NOT EXISTS idx_arch_layer ON architecture(layer);",
      "CREATE INDEX IF NOT EXISTS idx_arch_folder ON architecture(folder);",
      "CREATE INDEX IF NOT EXISTS idx_folders_role ON folders(role);",
    ].join('\n'),
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

// ============================================================
// Compute layers from import graph (zero hardcoding)
// ============================================================

function computeArchitecture(cwd) {
  if (!brain.brainExists(cwd)) return { computed: 0 };

  ensureTable(cwd);

  // Get all file nodes
  const files = brain.query(cwd, "SELECT file_path FROM nodes WHERE kind = 'file'");
  if (!files.length) return { computed: 0 };

  // Get all import edges
  const edges = brain.query(cwd, "SELECT source, target FROM edges WHERE kind = 'imports'");

  // Build adjacency maps
  const outbound = {}; // file → what it imports
  const inbound = {};  // file → who imports it
  const allFiles = new Set();

  for (const { file_path } of files) {
    allFiles.add(file_path);
    outbound[file_path] = [];
    inbound[file_path] = [];
  }

  // Registry-backed extension list — strips known extensions when building basename lookup
  const knownExts = registry.knownExtensions();
  const stripExtRe = new RegExp(
    '\\.(' + knownExts.map(e => e.replace(/^\./, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$'
  );

  const basenameMap = {};
  for (const f of allFiles) {
    const base = f.split('/').pop().replace(stripExtRe, '');
    if (!basenameMap[base]) basenameMap[base] = [];
    basenameMap[base].push(f);
  }

  // Candidate suffixes to try when resolving an unresolved import target.
  // Draws from the extractor registry so new languages auto-participate.
  const indexExts = knownExts.map(e => `/index${e}`).concat(knownExts.map(e => `/mod${e}`));
  const TRY_SUFFIXES = [...knownExts, ...indexExts];

  function resolveTarget(src, tgt) {
    if (allFiles.has(tgt)) return tgt;
    for (const ext of TRY_SUFFIXES) {
      if (allFiles.has(tgt + ext)) return tgt + ext;
    }
    const base = tgt.split('/').pop().replace(stripExtRe, '');
    const srcProject = src.split('/')[0];
    const candidates = (basenameMap[base] || []).filter(f => f.startsWith(srcProject));
    if (candidates.length === 1) return candidates[0];
    return null;
  }

  for (const edge of edges) {
    const src = edge.source.replace('file:', '');
    const tgt = edge.target.replace('file:', '');
    const resolved = resolveTarget(src, tgt);
    if (allFiles.has(src) && resolved) {
      outbound[src].push(resolved);
      inbound[resolved].push(src);
    }
  }

  // Compute layer: BFS from entry points (files with zero importers)
  const layers = {};
  const entryPoints = [...allFiles].filter(f => inbound[f].length === 0);

  // BFS to assign depth from entry points
  const queue = entryPoints.map(f => ({ file: f, depth: 0 }));
  const visited = new Set();

  while (queue.length > 0) {
    const { file, depth } = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    layers[file] = depth;

    for (const dep of (outbound[file] || [])) {
      if (!visited.has(dep)) {
        queue.push({ file: dep, depth: depth + 1 });
      }
    }
  }

  // Files not reachable from entry points get layer based on their own import count
  for (const f of allFiles) {
    if (!(f in layers)) {
      // Isolated file — assign layer based on outbound/inbound ratio
      const out = (outbound[f] || []).length;
      const inc = (inbound[f] || []).length;
      if (inc === 0 && out === 0) layers[f] = 0; // standalone
      else if (inc === 0) layers[f] = 0; // entry-like
      else if (out === 0) layers[f] = 99; // leaf (type/constant)
      else layers[f] = Math.round(out / (inc + 1)); // ratio-based
    }
  }

  // Normalize layers to 0-based consecutive
  const uniqueLayers = [...new Set(Object.values(layers))].sort((a, b) => a - b);
  const layerMap = {};
  uniqueLayers.forEach((l, i) => layerMap[l] = i);
  for (const f of allFiles) {
    layers[f] = layerMap[layers[f]] || 0;
  }

  // Extract folder from file path
  function getFolder(filePath) {
    const parts = filePath.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
  }

  // Aggregate folder stats
  const folderStats = {};
  for (const f of allFiles) {
    const folder = getFolder(f);
    if (!folderStats[folder]) {
      folderStats[folder] = { count: 0, totalImports: 0, totalImportedBy: 0, layerSum: 0 };
    }
    folderStats[folder].count++;
    folderStats[folder].totalImports += (outbound[f] || []).length;
    folderStats[folder].totalImportedBy += (inbound[f] || []).length;
    folderStats[folder].layerSum += layers[f];
  }

  // Detect folder role from stats (auto-derived, not hardcoded)
  function detectRole(stats) {
    const avgLayer = stats.layerSum / stats.count;
    const importRatio = stats.totalImports / Math.max(stats.totalImportedBy, 1);

    if (stats.totalImportedBy === 0 && stats.totalImports > 0) return 'entry';
    if (stats.totalImports === 0 && stats.totalImportedBy > 0) return 'leaf';
    if (importRatio < 0.3) return 'shared'; // heavily imported by others = shared/util
    if (importRatio > 3) return 'consumer'; // imports many, few import it = consumer/page
    if (avgLayer < 1) return 'top';
    if (avgLayer > 4) return 'foundation';
    return 'middle';
  }

  // Build SQL statements
  const dbPath = brain.getBrainPath(cwd);
  const statements = ['BEGIN TRANSACTION;', 'DELETE FROM architecture;', 'DELETE FROM folders;'];

  for (const f of allFiles) {
    const folder = getFolder(f);
    const layer = layers[f];
    const importsCount = (outbound[f] || []).length;
    const importedByCount = (inbound[f] || []).length;
    statements.push(
      `INSERT OR REPLACE INTO architecture (file_path, layer, folder, imports_count, imported_by_count, updated_at) ` +
      `VALUES ('${brain.esc(f)}', ${layer}, '${brain.esc(folder)}', ${importsCount}, ${importedByCount}, strftime('%s', 'now'));`
    );
  }

  for (const [folder, stats] of Object.entries(folderStats)) {
    const role = detectRole(stats);
    const avgLayer = (stats.layerSum / stats.count).toFixed(1);

    statements.push(
      `INSERT OR REPLACE INTO folders (folder_path, file_count, total_imports, total_imported_by, avg_layer, role, updated_at) ` +
      `VALUES ('${brain.esc(folder)}', ${stats.count}, ${stats.totalImports}, ${stats.totalImportedBy}, ${avgLayer}, '${role}', strftime('%s', 'now'));`
    );
  }

  statements.push('COMMIT;');
  safeExec('sqlite3', [dbPath], { input: statements.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] });

  return { computed: files.length, folders: Object.keys(folderStats).length };
}

// ============================================================
// Query helpers
// ============================================================

function getLayerSummary(cwd) {
  return brain.query(cwd,
    "SELECT layer, COUNT(*) as files, SUM(imports_count) as total_imports, SUM(imported_by_count) as total_consumers " +
    "FROM architecture GROUP BY layer ORDER BY layer"
  );
}

function getFolderRoles(cwd) {
  return brain.query(cwd,
    "SELECT folder_path, file_count, total_imports, total_imported_by, avg_layer, role " +
    "FROM folders ORDER BY avg_layer, folder_path LIMIT 40"
  );
}

function getFileLayer(cwd, filePath) {
  return brain.query(cwd,
    `SELECT a.*, f.role as folder_role FROM architecture a LEFT JOIN folders f ON a.folder = f.folder_path ` +
    `WHERE a.file_path = '${brain.esc(filePath)}' LIMIT 5`
  );
}

function getDataFlow(cwd, filePath) {
  const f = brain.esc(filePath);
  const file = brain.query(cwd,
    `SELECT * FROM architecture WHERE file_path = '${f}' LIMIT 1`
  );
  if (!file.length) return { error: 'File not found' };

  const upstream = brain.query(cwd,
    `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
    `JOIN edges e ON ('file:' || a.file_path) = e.source ` +
    `WHERE e.target = 'file:${f}' AND e.kind = 'imports' ` +
    `ORDER BY a.layer ASC LIMIT 10`
  );

  const downstream = brain.query(cwd,
    `SELECT a.file_path, a.layer, a.folder FROM architecture a ` +
    `JOIN edges e ON ('file:' || a.file_path) = e.target ` +
    `WHERE e.source = 'file:${f}' AND e.kind = 'imports' ` +
    `ORDER BY a.layer DESC LIMIT 10`
  );

  return { file: file[0], upstream, downstream };
}

function getMostConnected(cwd, limit) {
  return brain.query(cwd,
    `SELECT file_path, layer, folder, imports_count, imported_by_count, ` +
    `(imports_count + imported_by_count) as total FROM architecture ` +
    `ORDER BY total DESC LIMIT ${parseInt(limit) || 15}`
  );
}

module.exports = {
  computeArchitecture,
  getLayerSummary,
  getFolderRoles,
  getFileLayer,
  getDataFlow,
  getMostConnected
};
