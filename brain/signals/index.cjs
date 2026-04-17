/**
 * Project-signal scanner registry.
 *
 * Scanners parse manifest/config files (package.json, Cargo.toml, etc.) and
 * write structured dependency/script/signal data into brain.db. Runs once on
 * `shipfast init` (and `shipfast refresh`). Derived signals (framework,
 * runtime, test_framework, etc.) land in the `context` table under
 * scope='project' so agents see them in their fresh context.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const brain = require('../index.cjs');
const common = require('./_common.cjs');

const SCANNER_FILES = [
  './package_json.cjs',
  './tsconfig_json.cjs',
  './version_files.cjs',
  './pm_lockfiles.cjs',
  './cargo_toml.cjs',
  './go_mod.cjs',
  './pyproject_toml.cjs',
  './requirements_txt.cjs',
  './gemfile.cjs',
  './composer_json.cjs',
  './pubspec_yaml.cjs',
  './csproj.cjs',
  './mix_exs.cjs',
  './env_example.cjs',
  './workspaces.cjs',
  // framework_detect runs last — derives from the others
  './framework_detect.cjs',
];

const scanners = [];
for (const f of SCANNER_FILES) {
  let mod;
  try { mod = require(f); }
  catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') continue;
    throw err;
  }
  if (!mod) continue;
  // Accept file-based scanners (scan fn) and derived scanners (derive fn).
  if (typeof mod.scan !== 'function' && typeof mod.derive !== 'function') continue;
  scanners.push(mod);
}

/**
 * Walk the repo, invoke each scanner on matching manifests, collect results,
 * flush to brain.db in a single transaction.
 *
 * Returns { manifests, deps, scripts, signals } counts.
 */
function scanAll(cwd) {
  if (!brain.brainExists(cwd)) return { manifests: 0, deps: 0, scripts: 0, signals: 0 };

  const deps = [];    // {manifest_path, ecosystem, name, version, kind}
  const scripts = []; // {manifest_path, name, command, source}
  const signals = {}; // {key: value}  flat

  let manifestCount = 0;

  for (const scanner of scanners) {
    if (!scanner.filenames && !scanner.derived) continue;

    // Derived scanners (e.g. framework_detect) don't walk files — they read
    // results from previous scanners via the aggregate object we build up.
    if (scanner.derived) {
      const derived = scanner.derive({ deps, scripts, signals }, cwd) || {};
      Object.assign(signals, derived);
      continue;
    }

    const opts = scanner.matchSuffix ? { suffix: scanner.matchSuffix } : {};
    const matches = common.findManifests(cwd, scanner.filenames || [], 500, opts);
    for (const full of matches) {
      manifestCount++;
      const rel = path.relative(cwd, full).replace(/\\/g, '/');
      const contents = common.safeReadFile(full);
      let out;
      try { out = scanner.scan(contents, rel, cwd) || {}; }
      catch { out = {}; }
      if (out.deps) for (const d of out.deps) deps.push({ ...d, manifest_path: rel });
      if (out.scripts) for (const s of out.scripts) scripts.push({ ...s, manifest_path: rel });
      if (out.signals) Object.assign(signals, out.signals);
    }
  }

  flushToBrain(cwd, { deps, scripts, signals });

  return {
    manifests: manifestCount,
    deps: deps.length,
    scripts: scripts.length,
    signals: Object.keys(signals).length,
  };
}

function flushToBrain(cwd, { deps, scripts, signals }) {
  const dbPath = brain.getBrainPath(cwd);
  const esc = brain.esc;

  const stmts = ['BEGIN TRANSACTION;'];

  // Wipe previous signal data — scanAll is idempotent and reflects current state
  stmts.push("DELETE FROM dependencies;");
  stmts.push("DELETE FROM scripts;");

  for (const d of deps) {
    stmts.push(
      `INSERT OR REPLACE INTO dependencies (manifest_path, ecosystem, name, version, kind) ` +
      `VALUES ('${esc(d.manifest_path)}', '${esc(d.ecosystem)}', '${esc(d.name)}', '${esc(d.version || '')}', '${esc(d.kind || 'runtime')}');`
    );
  }
  for (const s of scripts) {
    stmts.push(
      `INSERT OR REPLACE INTO scripts (manifest_path, name, command, source) ` +
      `VALUES ('${esc(s.manifest_path)}', '${esc(s.name)}', '${esc(s.command)}', '${esc(s.source || 'package.json')}');`
    );
  }

  // Derived signals go into context table under scope='project'
  for (const [key, value] of Object.entries(signals)) {
    const val = typeof value === 'string' ? value : JSON.stringify(value);
    stmts.push(
      `INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at) ` +
      `VALUES ('project:${esc(key)}', 'project', '${esc(key)}', '${esc(val)}', ` +
      `COALESCE((SELECT version FROM context WHERE id = 'project:${esc(key)}'), 0) + 1, strftime('%s', 'now'));`
    );
  }

  stmts.push('COMMIT;');
  execFileSync('sqlite3', [dbPath], { input: stmts.join('\n'), stdio: ['pipe', 'pipe', 'pipe'] });
}

module.exports = {
  scanAll,
  scanners,  // exposed for tests
};
