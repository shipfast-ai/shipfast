/**
 * package.json scanner — the most important signal source for JS/TS projects.
 * Captures runtime + dev + peer + optional deps, scripts, engines, packageManager.
 */

'use strict';

const { safeJsonParse } = require('./_common.cjs');

const DEP_FIELDS = [
  ['dependencies',         'runtime'],
  ['devDependencies',      'dev'],
  ['peerDependencies',     'peer'],
  ['optionalDependencies', 'optional'],
];

function scan(contents /*, filePath, cwd */) {
  const pkg = safeJsonParse(contents);
  if (!pkg || typeof pkg !== 'object') return {};

  const deps = [];
  for (const [field, kind] of DEP_FIELDS) {
    const m = pkg[field];
    if (!m || typeof m !== 'object') continue;
    for (const [name, version] of Object.entries(m)) {
      deps.push({ ecosystem: 'npm', name, version: String(version || ''), kind });
    }
  }

  const scripts = [];
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command === 'string') {
        scripts.push({ name, command, source: 'package.json' });
      }
    }
  }

  const signals = {};
  if (pkg.name)    signals.project_name = String(pkg.name);
  if (pkg.version) signals.project_version = String(pkg.version);
  if (pkg.engines) signals.engines = pkg.engines;

  // packageManager field: "pnpm@8.15.0" etc.
  if (pkg.packageManager) signals.package_manager = String(pkg.packageManager);

  // monorepo workspace declaration
  if (pkg.workspaces) {
    signals.workspace = {
      type: 'npm',
      packages: Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages || []),
    };
  }

  return { deps, scripts, signals };
}

module.exports = {
  filenames: ['package.json'],
  scan,
};
