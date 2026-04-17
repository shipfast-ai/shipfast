/**
 * requirements.txt scanner — legacy Python pip manifest.
 *
 * Format:
 *   package==1.2.3
 *   package>=1.0,<2.0
 *   -r other-requirements.txt    (include — ignored)
 *   # comment
 *   -e .                         (editable install — ignored)
 *   -e git+https://...           (editable VCS — ignored)
 */

'use strict';

function scan(contents, filePath /*, cwd */) {
  const deps = [];
  const kind = /requirements-dev\.txt$|dev-requirements\.txt$/i.test(filePath) ? 'dev' : 'runtime';
  for (const raw of (contents || '').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    if (line.startsWith('-')) continue;   // -r, -e, --flag
    if (/^(https?|git\+|file:)/i.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(.*)$/);
    if (m) {
      deps.push({ ecosystem: 'pypi', name: m[1], version: m[2].trim(), kind });
    }
  }
  return { deps };
}

module.exports = {
  filenames: ['requirements.txt', 'requirements-dev.txt', 'dev-requirements.txt'],
  scan,
};
