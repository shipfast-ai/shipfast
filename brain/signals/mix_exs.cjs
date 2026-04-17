/**
 * mix.exs scanner — Elixir project manifest.
 *
 * Regex-extracts deps from the typical deps function:
 *   defp deps do
 *     [
 *       {:phoenix, "~> 1.7"},
 *       {:ecto,    "~> 3.10", only: :dev},
 *       {:plug,    "~> 1.14", optional: true},
 *     ]
 *   end
 */

'use strict';

function scan(contents /*, filePath, cwd */) {
  if (!contents) return {};
  const deps = [];
  const signals = {};

  // project.name / version from "defp project"
  const appMatch = contents.match(/app:\s*:([a-z_]\w*)/);
  if (appMatch) signals.project_name = appMatch[1];
  const verMatch = contents.match(/version:\s*["']([^"']+)["']/);
  if (verMatch) signals.project_version = verMatch[1];

  const depsFnMatch = contents.match(/def(?:p)?\s+deps\b[\s\S]*?\[([\s\S]*?)\]\s*end/);
  const body = depsFnMatch ? depsFnMatch[1] : contents;

  const depRe = /\{:([a-z_]\w*)\s*,\s*["']([^"']+)["']([^}]*)\}/g;
  let m;
  while ((m = depRe.exec(body)) !== null) {
    const rest = m[3];
    const kind = /\bonly:\s*(?::dev|\[[^\]]*dev[^\]]*\]|:test|\[[^\]]*test[^\]]*\])/.test(rest)
      ? 'dev' : (/\boptional:\s*true/.test(rest) ? 'optional' : 'runtime');
    deps.push({ ecosystem: 'hex', name: m[1], version: m[2], kind });
  }

  return { deps, signals };
}

module.exports = {
  filenames: ['mix.exs'],
  scan,
};
