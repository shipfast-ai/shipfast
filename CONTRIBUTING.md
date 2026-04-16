# Contributing to ShipFast

Thanks for your interest in contributing!

## Quick Start

```bash
git clone https://github.com/shipfast-ai/shipfast.git
cd shipfast
npm test  # 52 tests should pass
```

## How to Contribute

### Bug Reports
Open an issue using the bug report template. Include your OS, Node version, ShipFast version, and the AI tool you're using.

### Feature Requests
Open an issue using the feature request template. Describe the problem you're solving.

### Code Changes
1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make changes
4. Run tests: `npm test`
5. Commit with conventional format: `feat: add cool thing`
6. Open a PR

### Where to Help

- **Good first issues**: Look for the `good first issue` label
- **Core modules**: `core/*.cjs` — the engine
- **Commands**: `commands/sf/*.md` — add or improve commands
- **Agents**: `agents/*.md` — improve agent prompts
- **Tests**: `tests/` — more coverage is always welcome
- **Docs**: README, inline comments, examples

## Architecture

```
brain/       SQLite knowledge graph (index, schema, queries)
core/        Engine modules (18 files: ambiguity, verify, executor, etc.)
agents/      5 agent prompts (scout, architect, builder, critic, scribe)
commands/    20 slash commands
mcp/         MCP server (17 tools for IDE integration)
hooks/       Runtime hooks (4 files)
tests/       Unit tests (node:test)
```

## Code Style

- CommonJS (`.cjs`) — no ESM, no TypeScript
- Use `brain.esc()` for SQL escaping
- Use `safeExec` for `execFileSync` alias
- Use constants from `core/constants.cjs` — no magic numbers
- Keep functions small and focused
- Comments explain *why*, not *what*

## Testing

```bash
npm test  # runs all tests
```

Tests use Node's built-in `node:test` module. Add tests for any new core functionality.
