/**
 * Runtime version files: .nvmrc, .node-version, .python-version,
 * .ruby-version, .tool-versions (asdf), rust-toolchain[.toml].
 *
 * Each is usually one or two lines — we just capture the declared version.
 */

'use strict';

function scan(contents, filePath /*, cwd */) {
  const name = filePath.split('/').pop();
  const first = (contents || '').split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#'));
  const signals = {};

  if (!first) return {};

  const trimmed = first.trim();

  if (name === '.nvmrc' || name === '.node-version') {
    signals.node_version = trimmed.replace(/^v/, '');
  } else if (name === '.python-version') {
    signals.python_version = trimmed;
  } else if (name === '.ruby-version') {
    signals.ruby_version = trimmed;
  } else if (name === 'rust-toolchain') {
    signals.rust_toolchain = trimmed;
  } else if (name === 'rust-toolchain.toml') {
    const m = contents.match(/channel\s*=\s*["']([^"']+)["']/);
    if (m) signals.rust_toolchain = m[1];
  } else if (name === '.tool-versions') {
    // asdf format: "nodejs 20.11.0" per line
    const tools = {};
    for (const line of contents.split(/\r?\n/)) {
      const m = line.trim().match(/^([a-zA-Z0-9_-]+)\s+(\S+)/);
      if (m) tools[m[1]] = m[2];
    }
    if (Object.keys(tools).length) signals.tool_versions = tools;
  }

  return { signals };
}

module.exports = {
  filenames: [
    '.nvmrc', '.node-version', '.python-version', '.ruby-version',
    'rust-toolchain', 'rust-toolchain.toml', '.tool-versions',
  ],
  scan,
};
