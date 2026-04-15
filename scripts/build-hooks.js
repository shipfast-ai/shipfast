#!/usr/bin/env node
/**
 * Build hooks — replaces template placeholders with version info.
 * Run before publish.
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version;

const hooksDir = path.join(__dirname, '..', 'hooks');

for (const file of fs.readdirSync(hooksDir)) {
  if (!file.endsWith('.js')) continue;
  const filePath = path.join(hooksDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/\{\{SF_VERSION\}\}/g, version);
  fs.writeFileSync(filePath, content);
}

console.log(`Built hooks with version ${version}`);
