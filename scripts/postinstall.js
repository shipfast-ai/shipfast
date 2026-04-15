#!/usr/bin/env node

/**
 * Postinstall — auto-detect AI tools and install for all of them.
 * Only runs when installed globally (npm i -g). Skips for local project deps.
 */

// FIX #4: Only run auto-install when installed globally
const isGlobal = process.env.npm_config_global === 'true' ||
  (process.env.npm_lifecycle_event === 'postinstall' && !process.env.INIT_CWD);

if (isGlobal) {
  require('../bin/install.js');
} else {
  // Local install — just show a message
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';
  console.log(`\nShipFast installed locally. For global install: ${cyan}npm i -g @shipfast-ai/shipfast${reset}\n`);
}
