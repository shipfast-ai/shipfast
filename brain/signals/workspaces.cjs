/**
 * Workspace / monorepo layout files:
 *   pnpm-workspace.yaml  — { packages: [glob...] }
 *   turbo.json           — tasks pipeline (we record presence, not details)
 *   nx.json              — nx workspace (we record presence)
 *   lerna.json           — lerna workspace
 */

'use strict';

const { parseYamlLite, safeJsonParse } = require('./_common.cjs');

function scan(contents, filePath /*, cwd */) {
  const name = filePath.split('/').pop();
  const signals = {};

  if (name === 'pnpm-workspace.yaml') {
    const y = parseYamlLite(contents);
    if (y && Array.isArray(y.packages)) {
      signals.workspace = { type: 'pnpm', packages: y.packages };
    }
  } else if (name === 'turbo.json') {
    signals.monorepo_tool = 'turbo';
  } else if (name === 'nx.json') {
    signals.monorepo_tool = 'nx';
  } else if (name === 'lerna.json') {
    const j = safeJsonParse(contents);
    signals.workspace = signals.workspace || {};
    signals.monorepo_tool = 'lerna';
    if (j && Array.isArray(j.packages)) {
      signals.workspace = { type: 'lerna', packages: j.packages };
    }
  }

  return { signals };
}

module.exports = {
  filenames: ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'],
  scan,
};
