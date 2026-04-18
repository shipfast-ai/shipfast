# Changelog

All notable changes to ShipFast are tracked here. Releases follow [SemVer](https://semver.org/).

## [2.0.0] — 2026-04-18

Major release. Full AST-based code understanding, cross-file call resolution for every language, and an auto-routing layer that puts `brain.db` on every prompt.

### Added

- **Tree-sitter AST extractors** for JavaScript, TypeScript, TSX, PHP, Python, Java, Go.
  - Strict parsing (no false positives from strings / comments / template literals)
  - Method dispatch resolution (`x.method()` → `fn:file:method` when `x = new Foo()` is tracked)
  - `mutates` edges for `this.field = …`, `self.field = …`, `$this->field = …`, module-level writes
  - Go receiver-method dispatch (`c := &Counter{}; c.Inc()` resolves via receiver type)
  - PHP scoped-call resolution (`Class::method`, `$x->method()` via `use`-aliased classes)
- **Project-wide symbol resolver** (`core/resolver.cjs`). After all files are extracted, rewrites every `unresolved:<name>` edge against a cross-file symbol index.
  - Single match → concrete edge (weight 1.0)
  - 2-5 matches → ambiguous edges (weight = 1/N — filter `>= 0.9` for high-confidence only)
  - `> 5` matches dropped (name too generic)
  - Closes the cross-file gap for Swift, Ruby, Lua, C, C++, and any other language without named imports
- **`brain_impact` MCP tool** — walks edges upstream (consumers) or downstream (dependencies) with depth + kind filters.
- **`brain_trace` MCP tool** — BFS pathfinding between two nodes.
- **`brain_findings` MCP tool** + `/sf:investigate` skill — per-branch Scout output with citation verification (file / line range / content hash). `/sf:do` skips re-Scouting when citations still resolve.
- **`brain_sessions` MCP tool** — every `/sf:*` invocation emits a start/finish row including silent bail-outs and redirects. Powers `/sf:status` audit trail.
- **`brain_tasks` CRUD actions** — `show`, `rename`, `edit_plan`, `soft_delete`, `restore`. Default `list` excludes soft-deleted rows; `include_deleted: true` surfaces them.
- **Auto-router** — `UserPromptSubmit` hook routes plain prompts through `/sf:do` when `/sf:enable` is active. `/sf:disable` turns it off. Status surfaces as a `SF⚡` badge on the Claude Code statusbar.
- **Brain snapshot injection on every prompt** — node/edge counts, hot files, recent decisions/learnings/findings/sessions, plus the list of `brain_*` tools and edge kinds. Cached for 30 s keyed on `brain.db` mtime.
- **`statusLine` config** — proper Claude Code status-line command registered in `settings.json`. Shows `SF[⚡] · <model>[ · !ctx]`.
- **Markdown extractor** — YAML frontmatter (skill name + description → `skill:` nodes), headings as nodes, markdown links as `imports` edges.
- **`/sf:enable` / `/sf:disable` skills** — toggle the auto-router flag file.
- **Laravel `resources/views/vendor/` exception** — explicit `PATH_EXCEPTIONS` entry preserves view overrides despite the general `vendor/` skip rule.
- **Incremental reindex on file edits** — `FileChanged` hook triggers `--changed-only` indexer run when any indexed-extension file changes (not just manifests).
- **Same-file `calls` edges for 10 regex languages** — Go, Rust, Ruby, C, C++, Swift, Dart, Scala, Elixir, Lua (same pattern as the JS/TS/PHP/Python extractors that already had it).
- **Rust cross-file calls** via `use`-path tracking.
- **Dart / Scala / Elixir cross-file calls** via `show` / `import {…}` / `alias` patterns.
- **Go AST cross-package calls** via import-alias resolution.
- **Java + Kotlin `implements` edges** via AST parsing.

### Changed

- `shipfast init` now defaults to AST mode. `--regex` opts out to the legacy extractors.
- Indexer directory-skip rules split into `SKIP_DIRS_ANYWHERE` (always skip — `node_modules`, `.git`, `target`, `.venv`, etc.) and `SKIP_DIRS_AT_ROOT` (`dist`, `build`, `spec`, `vendor`, `tmp`, `logs` — only skipped at the repo root so nested dirs with those names stay indexed).
- `co_changes` edge cap raised from 100 → 300 per repo.
- MCP `brain_context` gains a `branch` scope for cached findings.

### Fixed

- Minified `vendor/**/*.js` (e.g. Laravel Horizon / Telescope dashboards) no longer explode the call graph — guard in the JS AST extractor skips `calls` extraction on minified-looking files.
- Orphan file detection reliably removes deleted-file nodes on full reindex.
- `scala.cjs` regression from earlier refactor: full module path preserved in `module:` edge targets.

### Install size

This release vendors tree-sitter grammars (~4.3 MB) + the web-tree-sitter runtime (~200 KB) directly in the npm tarball, bringing install size from ~153 KB to ~5 MB. Grammar loading is lazy — no runtime cost unless `--ast` runs. A future release may split grammars into a peer package to shrink the base install.

### Breaking changes

None. `--regex` preserves the v1.x extraction behavior. All existing MCP tools keep their signatures. Brain-db schema additions are new tables only; existing tables unchanged.

---

## [1.9.2] — earlier (never published to npm)

- Statusline / statusbar + `UserPromptSubmit` hook foundation.
- `brain_impact` introduced, `brain_trace` pathfinding.
- Cross-file calls for JS/TS via imported-symbol tables.
- PHP calls + implements edges via AST.

(The v1.9.2 tag was cut pre-publish; everything in that release shipped as part of v2.0.)

## [1.9.1] — auto-router toggle via slash commands

- `/sf:enable` / `/sf:disable` skills toggle auto-route via a flag file.
- Replaced the short-lived `SF_AUTO_ROUTE=1` env-var mechanism.

## [1.9.0] — session persistence, cited findings, task CRUD

- `skill_sessions` + `findings` tables.
- GitHub-Copilot-inspired citation validation on findings (partial reuse).
- Task CRUD actions via extended `brain_tasks` MCP tool.

## [1.8.2] — fix: install `brain/{extractors,signals}` so indexer runs

`cmdInstall` copied only `brain/{schema.sql, index.cjs, indexer.cjs}`; the indexer's `require('./extractors/index.cjs')` lookup crashed. Subdirectories now mirrored.

## [1.8.1] — re-exec after update so new version's code runs

`shipfast update` reported the pre-update version in its banner because the running Node process had already loaded the old install.js. After `npm install -g` overwrites the files on disk, the CLI now re-execs itself.

## [1.8.0] — AI platform integration upgrades

## [1.7.0] — project signals: indexed manifests, auto-inject stack context

## [1.6.x] — Astro SFC extractor; native MCP config registration

## [1.5.x] — ShipFast brain v1 (SQLite knowledge graph); MCP server

## [1.0] — initial public release

---

**Full history:** https://github.com/shipfast-ai/shipfast/commits/main
