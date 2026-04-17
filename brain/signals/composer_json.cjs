/**
 * composer.json scanner — PHP Composer manifest.
 */

'use strict';

const { safeJsonParse } = require('./_common.cjs');

function scan(contents /*, filePath, cwd */) {
  const pkg = safeJsonParse(contents);
  if (!pkg) return {};

  const deps = [];
  const signals = {};

  if (pkg.name)    signals.project_name = String(pkg.name);
  if (pkg.version) signals.project_version = String(pkg.version);

  if (pkg.require && typeof pkg.require === 'object') {
    for (const [name, version] of Object.entries(pkg.require)) {
      if (name === 'php') { signals.php_required = String(version); continue; }
      deps.push({ ecosystem: 'composer', name, version: String(version), kind: 'runtime' });
    }
  }
  if (pkg['require-dev'] && typeof pkg['require-dev'] === 'object') {
    for (const [name, version] of Object.entries(pkg['require-dev'])) {
      deps.push({ ecosystem: 'composer', name, version: String(version), kind: 'dev' });
    }
  }

  const scripts = [];
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command === 'string') {
        scripts.push({ name, command, source: 'composer.json' });
      } else if (Array.isArray(command)) {
        scripts.push({ name, command: command.join(' && '), source: 'composer.json' });
      }
    }
  }

  return { deps, scripts, signals };
}

module.exports = {
  filenames: ['composer.json'],
  scan,
};
