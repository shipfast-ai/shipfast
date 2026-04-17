/**
 * go.mod scanner — Go module manifest.
 *
 * Format:
 *   module github.com/acme/foo
 *   go 1.21
 *   require (
 *     github.com/x/y v1.2.3
 *     github.com/a/b v0.5.0 // indirect
 *   )
 *   require github.com/single/dep v1.0.0
 */

'use strict';

function scan(contents /*, filePath, cwd */) {
  if (!contents) return {};
  const deps = [];
  const signals = {};

  const moduleMatch = contents.match(/^module\s+(\S+)/m);
  if (moduleMatch) signals.project_name = moduleMatch[1];

  const goMatch = contents.match(/^go\s+(\S+)/m);
  if (goMatch) signals.go_version = goMatch[1];

  // Multi-line require blocks
  const blockRe = /require\s*\(([\s\S]*?)\)/g;
  let m;
  while ((m = blockRe.exec(contents)) !== null) {
    for (const line of m[1].split('\n')) {
      const entry = line.replace(/\/\/.*$/, '').trim();  // strip comments
      if (!entry) continue;
      const isIndirect = /\/\/\s*indirect/.test(line);
      const parts = entry.split(/\s+/);
      if (parts.length >= 2) {
        deps.push({
          ecosystem: 'go',
          name: parts[0],
          version: parts[1],
          kind: isIndirect ? 'peer' : 'runtime',
        });
      }
    }
  }

  // Single-line requires
  const singleRe = /^require\s+(\S+)\s+(\S+)(?:\s+\/\/\s*indirect)?/gm;
  while ((m = singleRe.exec(contents)) !== null) {
    deps.push({ ecosystem: 'go', name: m[1], version: m[2], kind: 'runtime' });
  }

  return { deps, signals };
}

module.exports = {
  filenames: ['go.mod'],
  scan,
};
