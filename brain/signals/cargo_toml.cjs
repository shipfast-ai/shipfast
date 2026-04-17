/**
 * Cargo.toml scanner — Rust package manifest.
 *
 * Captures [dependencies], [dev-dependencies], [build-dependencies],
 * [workspace.members], [package.name/version/edition].
 * Each dep entry can be a simple "1.2.3" or a table { version = "1", features = [...] }.
 */

'use strict';

const { parseTomlLite } = require('./_common.cjs');

const DEP_SECTIONS = [
  ['dependencies',       'runtime'],
  ['dev-dependencies',   'dev'],
  ['build-dependencies', 'dev'],
];

function scan(contents /*, filePath, cwd */) {
  const toml = parseTomlLite(contents);
  if (!toml) return {};

  const deps = [];
  for (const [section, kind] of DEP_SECTIONS) {
    const s = toml[section];
    if (!s || typeof s !== 'object') continue;
    for (const [name, value] of Object.entries(s)) {
      let version = '';
      if (typeof value === 'string') version = value;
      else if (value && typeof value === 'object') version = value.version || '';
      deps.push({ ecosystem: 'cargo', name, version: String(version), kind });
    }
  }

  const signals = {};
  if (toml.package) {
    if (toml.package.name)    signals.project_name = String(toml.package.name);
    if (toml.package.version) signals.project_version = String(toml.package.version);
    if (toml.package.edition) signals.rust_edition = String(toml.package.edition);
  }
  if (toml.workspace && toml.workspace.members) {
    signals.workspace = {
      type: 'cargo',
      packages: Array.isArray(toml.workspace.members) ? toml.workspace.members : [],
    };
  }

  return { deps, signals };
}

module.exports = {
  filenames: ['Cargo.toml'],
  scan,
};
