#!/usr/bin/env node

/**
 * ShipFast FileChanged hook (Claude Code v2.1.83+).
 *
 * When Claude Code edits one of a project's manifest files (package.json,
 * Cargo.toml, go.mod, pyproject.toml, requirements.txt, Gemfile,
 * composer.json, pubspec.yaml, .nvmrc, tsconfig.json, etc.), this hook
 * triggers `shipfast refresh` in the project cwd so the brain's dependency
 * and framework signals stay current.
 *
 * Fail-closed: any parse error, missing cwd, or subprocess failure exits 0
 * so this hook never blocks Claude Code. Never returns exit code 2.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Keep this list in sync with brain/signals/ scanner filenames.
const MANIFESTS = new Set([
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'dev-requirements.txt',
  'Gemfile',
  'composer.json',
  'pubspec.yaml',
  'pubspec.yml',
  'mix.exs',
  'tsconfig.json',
  'jsconfig.json',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.ruby-version',
  '.tool-versions',
  'rust-toolchain',
  'rust-toolchain.toml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'lerna.json',
  '.env.example',
  '.env.sample',
  '.env.template',
]);

// Read stdin payload with a tight timeout so we never block Claude Code.
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buf += chunk; });
process.stdin.on('end', () => {
  try { handle(JSON.parse(buf || '{}')); } catch { /* silent */ }
  process.exit(0);
});
setTimeout(() => { try { handle(JSON.parse(buf || '{}')); } catch {} process.exit(0); }, 200);

function handle(payload) {
  // Claude Code FileChanged payload shape (documented):
  //   { hook_event_name: 'FileChanged', file_path: '...', cwd: '...' }
  const filePath = payload.file_path || (payload.tool_input && payload.tool_input.file_path) || '';
  const cwd = payload.cwd || process.cwd();
  if (!filePath) return;

  const base = path.basename(filePath);
  if (!MANIFESTS.has(base) && !/\.(csproj)$/i.test(base)) return;

  // Only refresh if the project has a brain.db — otherwise shipfast init
  // hasn't been run and there's nothing to refresh.
  if (!fs.existsSync(path.join(cwd, '.shipfast', 'brain.db'))) return;

  // Fire and forget. Detach so Claude Code doesn't wait on completion.
  const child = spawn('shipfast', ['refresh'], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => { /* shipfast not on PATH — silent */ });
  child.unref();
}
