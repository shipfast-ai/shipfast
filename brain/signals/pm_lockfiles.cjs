/**
 * Detect the package manager (pnpm / npm / yarn / bun) from lockfile presence.
 *
 * We don't parse the lockfile (skipped in SKIP_FILES for the code indexer)
 * — we only need its existence to know which PM the project uses.
 *
 * This scanner is unusual: it runs on the existence-check of specific
 * filenames. It reports a single signal. First detected lockfile wins;
 * precedence: packageManager field in package.json > pnpm > yarn > bun > npm.
 */

'use strict';

function scan(contents, filePath /*, cwd */) {
  const name = filePath.split('/').pop();
  const signals = {};

  const map = {
    'pnpm-lock.yaml':   'pnpm',
    'yarn.lock':        'yarn',
    'bun.lockb':        'bun',
    'bun.lock':         'bun',
    'package-lock.json':'npm',
    'Cargo.lock':       'cargo',
    'Gemfile.lock':     'bundler',
    'poetry.lock':      'poetry',
    'Pipfile.lock':     'pipenv',
    'composer.lock':    'composer',
    'uv.lock':          'uv',
  };

  const pm = map[name];
  if (pm) signals.detected_pm = pm;
  return { signals };
}

module.exports = {
  filenames: Object.keys({
    'pnpm-lock.yaml': 1, 'yarn.lock': 1, 'bun.lockb': 1, 'bun.lock': 1,
    'package-lock.json': 1, 'Cargo.lock': 1, 'Gemfile.lock': 1,
    'poetry.lock': 1, 'Pipfile.lock': 1, 'composer.lock': 1, 'uv.lock': 1,
  }),
  scan,
};
