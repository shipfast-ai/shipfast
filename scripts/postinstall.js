#!/usr/bin/env node

/**
 * Postinstall — auto-detect AI tools and install for all of them.
 * Runs automatically after `npm i -g @shipfast-ai/shipfast`
 */

// Just run the main CLI with no args — it auto-detects and installs
require('../bin/install.js');
