/**
 * pubspec.yaml scanner — Dart/Flutter manifest.
 */

'use strict';

const { parseYamlLite } = require('./_common.cjs');

function scan(contents /*, filePath, cwd */) {
  const yaml = parseYamlLite(contents);
  if (!yaml) return {};

  const deps = [];
  const signals = {};

  if (yaml.name)    signals.project_name = String(yaml.name);
  if (yaml.version) signals.project_version = String(yaml.version);
  if (yaml.environment && yaml.environment.sdk) signals.dart_sdk = String(yaml.environment.sdk);

  for (const [field, kind] of [['dependencies', 'runtime'], ['dev_dependencies', 'dev']]) {
    const obj = yaml[field];
    if (!obj || typeof obj !== 'object') continue;
    for (const [name, val] of Object.entries(obj)) {
      if (name === 'flutter') continue;   // SDK ref, not a dep
      deps.push({
        ecosystem: 'pubspec',
        name,
        version: typeof val === 'object' ? (val.version || '') : String(val || ''),
        kind,
      });
    }
  }

  return { deps, signals };
}

module.exports = {
  filenames: ['pubspec.yaml', 'pubspec.yml'],
  scan,
};
