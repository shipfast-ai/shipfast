/**
 * tsconfig.json scanner — captures TypeScript compiler options that affect
 * what code style is valid (strict, target, moduleResolution, path aliases).
 *
 * Ignores tsconfig variants (tsconfig.build.json etc.) — only root tsconfig.json
 * is scanned to avoid noise.
 */

'use strict';

const { safeJsonParse } = require('./_common.cjs');

function scan(contents, filePath /*, cwd */) {
  // Only root-level tsconfig.json — not apps/web/tsconfig.json for now
  if (filePath !== 'tsconfig.json' && filePath !== 'jsconfig.json') return {};

  const cfg = safeJsonParse(contents);
  if (!cfg || !cfg.compilerOptions) return {};
  const co = cfg.compilerOptions;

  const signals = {
    typescript: {
      target: co.target || 'es5',
      module: co.module || null,
      moduleResolution: co.moduleResolution || null,
      strict: !!co.strict,
      jsx: co.jsx || null,
      paths: co.paths || null,
      baseUrl: co.baseUrl || null,
    },
  };

  return { signals };
}

module.exports = {
  filenames: ['tsconfig.json', 'jsconfig.json'],
  scan,
};
