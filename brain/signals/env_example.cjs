/**
 * .env.example scanner — captures env var NAMES only.
 *
 * IMPORTANT: values are never captured. Real .env files are explicitly
 * skipped — only the "example" / "sample" / "template" variants that
 * contain placeholder values checked into the repo.
 */

'use strict';

const { parseEnvKeys } = require('./_common.cjs');

function scan(contents, filePath /*, cwd */) {
  const name = filePath.split('/').pop();
  // Defensive: never read a real .env file even if it somehow landed here
  if (name === '.env' || name === '.env.local') return {};

  const keys = parseEnvKeys(contents);
  if (!keys.length) return {};
  return {
    signals: {
      env_vars: keys.sort(),
    },
  };
}

module.exports = {
  filenames: ['.env.example', '.env.sample', '.env.template'],
  scan,
};
