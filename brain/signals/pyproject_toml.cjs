/**
 * pyproject.toml scanner — Python modern project manifest.
 *
 * Handles both PEP 621 ([project.dependencies]) and Poetry
 * ([tool.poetry.dependencies]) styles.
 */

'use strict';

const { parseTomlLite } = require('./_common.cjs');

function scan(contents /*, filePath, cwd */) {
  const toml = parseTomlLite(contents);
  if (!toml) return {};

  const deps = [];
  const scripts = [];
  const signals = {};

  // PEP 621 style — dependencies is a list of strings
  if (toml.project) {
    if (toml.project.name)            signals.project_name = String(toml.project.name);
    if (toml.project.version)         signals.project_version = String(toml.project.version);
    if (toml.project['requires-python']) signals.python_requires = String(toml.project['requires-python']);
    if (Array.isArray(toml.project.dependencies)) {
      for (const entry of toml.project.dependencies) {
        deps.push(parsePepRequirement(entry, 'runtime'));
      }
    }
    if (toml.project['optional-dependencies']) {
      for (const [group, list] of Object.entries(toml.project['optional-dependencies'])) {
        if (Array.isArray(list)) for (const entry of list) {
          deps.push(parsePepRequirement(entry, 'optional'));
        }
      }
    }
  }

  // Poetry style
  if (toml.tool && toml.tool.poetry) {
    const p = toml.tool.poetry;
    if (p.name)    signals.project_name = signals.project_name || String(p.name);
    if (p.version) signals.project_version = signals.project_version || String(p.version);
    if (p.dependencies && typeof p.dependencies === 'object') {
      for (const [name, val] of Object.entries(p.dependencies)) {
        if (name === 'python') {
          signals.python_requires = typeof val === 'string' ? val : (val && val.version) || '';
          continue;
        }
        deps.push({
          ecosystem: 'pypi', name,
          version: typeof val === 'string' ? val : (val && val.version) || '',
          kind: 'runtime',
        });
      }
    }
    if (p['dev-dependencies'] && typeof p['dev-dependencies'] === 'object') {
      for (const [name, val] of Object.entries(p['dev-dependencies'])) {
        deps.push({
          ecosystem: 'pypi', name,
          version: typeof val === 'string' ? val : (val && val.version) || '',
          kind: 'dev',
        });
      }
    }
    if (p.scripts && typeof p.scripts === 'object') {
      for (const [name, command] of Object.entries(p.scripts)) {
        if (typeof command === 'string') {
          scripts.push({ name, command, source: 'pyproject.toml' });
        }
      }
    }
  }

  return { deps: deps.filter(d => d && d.name), scripts, signals };
}

// Parse a PEP 508 requirement: "package>=1.0" → {name, version}
function parsePepRequirement(s, kind) {
  if (!s || typeof s !== 'string') return null;
  // Strip env markers (after ';') and extras (in [])
  const core = s.split(';')[0].trim();
  const m = core.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  return { ecosystem: 'pypi', name: m[1], version: m[2].trim(), kind };
}

module.exports = {
  filenames: ['pyproject.toml'],
  scan,
};
