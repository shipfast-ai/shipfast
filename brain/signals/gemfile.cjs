/**
 * Gemfile scanner — Ruby Bundler manifest.
 *
 * Patterns:
 *   gem 'rails', '7.1.0'
 *   gem "rspec", "~> 3.12", group: :test
 *   group :development do
 *     gem "pry"
 *   end
 */

'use strict';

function scan(contents /*, filePath, cwd */) {
  if (!contents) return {};
  const deps = [];
  const signals = {};

  const rubyVerMatch = contents.match(/^ruby\s+['"]([^'"]+)['"]/m);
  if (rubyVerMatch) signals.ruby_required = rubyVerMatch[1];

  // Track current group context via line-by-line sweep
  const groupStack = [];

  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const groupOpen = line.match(/^group\s+([:\w, ]+?)\s+do\b/);
    if (groupOpen) {
      const groups = groupOpen[1].split(',').map(s => s.replace(/:/g, '').trim());
      groupStack.push(groups);
      continue;
    }
    if (/^end\b/.test(line) && groupStack.length) { groupStack.pop(); continue; }

    const gemMatch = line.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
    if (gemMatch) {
      const name = gemMatch[1];
      const version = gemMatch[2] || '';
      const kind = groupStack.some(g => g.some(x => /^(dev|development|test)$/.test(x))) ? 'dev' : 'runtime';
      deps.push({ ecosystem: 'rubygems', name, version, kind });
    }
  }

  return { deps, signals };
}

module.exports = {
  filenames: ['Gemfile'],
  scan,
};
