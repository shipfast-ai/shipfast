<div align="center">

# ShipFast

**Autonomous context-engineered development system with SQLite brain.**

**5 agents. 20 commands. Per-task fresh context. 70-90% fewer tokens.**

[![npm version](https://img.shields.io/npm/v/@shipfast-ai/shipfast)](https://www.npmjs.com/package/@shipfast-ai/shipfast)
[![npm downloads](https://img.shields.io/npm/dw/@shipfast-ai/shipfast)](https://www.npmjs.com/package/@shipfast-ai/shipfast)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://github.com/shipfast-ai/shipfast/actions/workflows/test.yml/badge.svg)](https://github.com/shipfast-ai/shipfast/actions/workflows/test.yml)

Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Cursor, Windsurf, Antigravity, Augment, Trae, Qwen Code, CodeBuddy, Cline

```
npm i -g @shipfast-ai/shipfast
```

Works on Mac, Windows, and Linux.

</div>

---

## Why ShipFast?

Context rot kills AI coding quality. As the context window fills up, output degrades — Task 5 is worse than Task 1.

ShipFast fixes this with a **SQLite knowledge graph** that gives each agent fresh context and gets smarter every session.

- **SQLite brain** — queryable knowledge graph replaces markdown state files
- **Fresh context per task** — each Builder agent starts clean, quality stays consistent
- **3K-40K tokens per feature** — 70-90% less than typical AI dev workflows
- **Self-improving** — records patterns and decisions, gets cheaper over time
- **Smart model selection** — dynamically picks haiku/sonnet/opus based on task + feedback loop
- **Domain-aware questioning** — 6 domains, 20+ question templates, zero LLM cost
- **Wave-based execution** — independent tasks run in parallel, dependent tasks run sequentially
- **Cross-repo support** — link repos, search across brains, cross-repo blast radius
- **22 languages indexed** in <1 second — architecture layers auto-derived from import graph
- **Works with 14 AI coding tools** — auto-detects and installs for all

---

## Getting Started

```bash
npm i -g @shipfast-ai/shipfast
cd your-project
shipfast init
```

Auto-detects your AI tools and installs for all of them. Verify: run `/sf-help` in your AI tool.

### Terminal Commands

```bash
shipfast init           # Index repo + auto-configure permissions (no --dangerously-skip-permissions needed)
shipfast init --fresh   # Full reindex (clears existing brain)
shipfast link <path>    # Link another repo for cross-repo search
shipfast unlink [path]  # Unlink a repo (or all)
shipfast doctor         # Check brain.db health + diagnose issues
shipfast permissions    # Show configured permission allowlist
shipfast status         # Show installed runtimes + brain + links
shipfast update         # Update + re-detect runtimes
shipfast uninstall      # Remove from all AI tools
```

### Permissions (Zero Prompts)

`shipfast init` auto-configures safe permission rules in `.claude/settings.json`. ShipFast operations (Read, Edit, Write, git, build, test, grep) run without permission prompts. Destructive commands (rm, curl, ssh, sudo) still require approval.

No `--dangerously-skip-permissions` needed. Run `shipfast permissions` to view the allowlist.

If auto-configured permissions don't work for your setup, you can fall back to:
```bash
claude --dangerously-skip-permissions
```
This skips ALL permission checks — use only in trusted environments.

---

## How It Works

### 1. Discuss (when needed)

```
/sf-discuss Add authentication
```

**Domain-aware** ambiguity detection — zero LLM tokens:

| Domain | Example Questions |
|--------|-------------------|
| **UI** | Layout density? Interaction pattern? Empty state? Responsive approach? |
| **API** | Response format? Error handling? Auth mechanism? Versioning? |
| **Database** | ORM? Migration strategy? Data access pattern? |
| **Auth** | JWT/session/OAuth? Token storage? Role model? |
| **Content** | Markdown/rich text? Tone? i18n? |
| **Infra** | Deploy target? CI/CD pipeline? |

Auto-detects domain from task keywords. Answers stored as locked decisions — never asked again, even across sessions.

**Flags**: `--batch` (group questions), `--chain` (auto-run discuss → plan → check → execute), `--assume` (auto-resolve from brain.db patterns)

### 2. Plan

```
/sf-plan Add Stripe billing with webhooks
```

Spawns two agents in fresh contexts:

**Scout** — Researches the codebase. Finds relevant files, functions, consumers. Tags findings: [VERIFIED], [CITED], [ASSUMED].

**Architect** — Creates tasks using goal-backward methodology. Each task has exact file paths, consumer lists, verify commands, and done criteria. Sets dependency graph for wave grouping.

Tasks stored in brain.db.

### 3. Execute

```
/sf-do
```

**Complexity auto-detection** routes to the right workflow:

**Trivial** (fix a typo) — executes inline, no agents. ~3K tokens.

**Medium** (add a component) — one Builder agent with all tasks batched. ~15K tokens.

**Complex** (new feature across files) — per-task Builder agents with **fresh context each**:

```
[1/6] Building: Split LocationList into layouts...
[1/6] ✓ Split LocationList (commit: a1b2c3d)

[2/6] Building: Extract RectangleTile sub-components...
[2/6] ✓ Extract RectangleTile (commit: e4f5g6h)

...

[6/6] ✓ Extract Featured hooks (commit: m7n8o9p)
```

Each Builder gets fresh context — no accumulated garbage from previous tasks. Quality stays consistent from Task 1 to Task 6.

**Wave-based parallel execution:**

```
Independent tasks (no shared files) → same wave → run in parallel
Dependent tasks (shared files/imports) → separate waves → run sequentially
```

The Architect sets the dependency graph. `groupIntoWaves()` computes waves. Independent tasks in the same wave launch simultaneously — multiple Builder agents at once.

**After all tasks complete:**
- **Critic** agent (fresh context) reviews the entire `git diff` — checks consumer integrity, import consistency, security
- **Scribe** agent (fresh context) records decisions + learnings to brain.db
- **Branch audit** (automatic on non-default branches) — reports MIGRATED / MISSING / SAFELY REMOVED vs default branch

**Dynamic model selection** per agent:

| Condition | Model |
|-----------|-------|
| Well-known domain (2+ high-confidence learnings) | **Haiku** (cheapest) |
| Standard task | **Sonnet** (default) |
| Complex multi-area, no prior patterns | **Opus** (best reasoning) |
| Budget low (<40%) | **All Haiku** (degradation) |
| `--cheap` flag | **All Haiku** |
| `--quality` flag | **Sonnet/Opus** |

Models auto-adjust via feedback loop — tracks success/failure rates per model+domain, upgrades haiku→sonnet when failing, downgrades when consistently succeeding.

**All execution flags**: `--tdd` (test-first), `--research` (force Scout), `--verify` (force verification), `--no-plan` (skip planning), `--discuss` (force discussion), `--cheap` (all haiku), `--quality` (sonnet/opus)

### 4. Verify

```
/sf-verify
```

Fresh context verification:

- **3-level artifact validation**: exists → substantive (not stubs) → wired (imported and used)
- **Data flow tracing**: components receive real data, not hardcoded empty arrays
- **Consumer integrity**: removed exports have zero remaining consumers
- **Stub detection**: TODO, FIXME, placeholder, empty handlers, console.log, debugger
- **Schema drift detection**: warns when ORM models change without migrations (Prisma, Drizzle, TypeORM, Django, Rails, Knex)
- **TDD sequence check**: verifies test(...) commits before feat(...) commits
- **Build verification**: runs build command, reports pass/fail
- **Branch audit**: compares changes vs default branch, flags missing migrations

Scores: **PASS** / **PASS_WITH_WARNINGS** / **FAIL** with specific details.

### 5. Ship

```
/sf-ship
```

Creates branch, generates PR description from brain.db (decisions, tasks, changes), pushes, outputs PR link. Runs configurable post-ship hook if set.

### 6. Workflows

```
Simple:     /sf-do fix the typo in header
Standard:   /sf-plan add dark mode → /sf-check-plan → /sf-do → /sf-verify
Complex:    /sf-project Build billing → /sf-discuss → /sf-plan → /sf-do → /sf-verify → /sf-ship
```

---

## Brain (SQLite Knowledge Graph)

All state lives in `.shipfast/brain.db`. Zero markdown files.

| Table | What it stores |
|---|---|
| `nodes` | Functions, types, classes, components (auto-extracted, 22 languages) |
| `edges` | Import/call/dependency relationships + git co-change patterns |
| `decisions` | Locked Q&A pairs with domain tags (~40 tokens each) |
| `learnings` | Error→fix patterns with confidence scoring (0.0-1.0) |
| `tasks` | Execution history with commit SHAs, tokens used, duration |
| `seeds` | Forward ideas captured during work for future milestones |
| `model_performance` | Success/failure tracking per model+domain (feedback loop) |
| `checkpoints` | Git stash refs for rollback |
| `requirements` | REQ-IDs mapped to phases for tracing |
| `architecture` | Auto-computed layers from import graph (zero hardcoding) |
| `folders` | Directory roles: entry, shared, consumer, leaf, foundation |
| `hot_files` | Most frequently changed files from git history |
| `config` | Token budget, model tiers, post-ship hooks, default branch |

**Incremental indexing**: ~300ms for changed files. Deleted files auto-cleaned. Stale learnings auto-pruned.

**MCP Server**: 23 structured tools for IDE integration. Commands and agents use MCP tools — no raw SQL.

---

## Agents

| Agent | Role | Default Model | Key Behaviors |
|---|---|---|---|
| **Scout** | Research | Haiku | 6-direction flow tracing, confidence tagging, consumer discovery |
| **Architect** | Planning | Sonnet (Opus for complex) | Goal-backward, dependency graph, STRIDE threats, scope guard |
| **Builder** | Execution | Sonnet (Haiku if learned) | Impact analysis before every change, per-task build verify, 3-attempt limit |
| **Critic** | Review | Haiku (Sonnet for security) | Auto-depth (quick/standard/deep), import graph tracing, consumer integrity |
| **Scribe** | Documentation | Haiku | Records decisions + learnings to brain.db, generates PR descriptions |

Models are **dynamically selected** — not fixed. The feedback loop tracks which model succeeds for which domain and auto-adjusts.

---

## Commands

### Core

| Command | What it does |
|---|---|
| `/sf-do <task>` | The one command. Auto-detects complexity, runs the right workflow. |
| `/sf-plan <task>` | Research (Scout) + Plan (Architect). Stores tasks in brain.db. |
| `/sf-discuss <task>` | Domain-aware questioning. 6 domains, 20+ templates, zero LLM cost. |
| `/sf-check-plan` | Validate plan: scope, consumers, dependencies, STRIDE threats. |
| `/sf-verify` | Verify: artifacts, data flow, stubs, schema drift, build, consumers. |

### Projects & Worktrees

| Command | What it does |
|---|---|
| `/sf-project <desc>` | Decompose large project into phases with REQ-ID tracing. |
| `/sf-milestone` | Complete current milestone or start next version. |
| `/sf-worktree create` | Create isolated worktree with smart branch naming + multi-repo support. |
| `/sf-worktree check` | Migration audit: MIGRATED / MISSING / SAFELY REMOVED / MODIFIED / ADDED. |
| `/sf-worktree list\|switch\|status\|complete` | Manage parallel worktrees. |

### Shipping & Session

| Command | What it does |
|---|---|
| `/sf-ship` | Create branch, push, PR link + post-ship hook. |
| `/sf-status` | Brain stats, tasks, checkpoints, version. |
| `/sf-resume` | Resume from previous session. |
| `/sf-undo [task-id]` | Rollback a specific task. |
| `/sf-rollback [last\|all\|N]` | Rollback last task, last N, or entire session. |

### Knowledge & Analysis

| Command | What it does |
|---|---|
| `/sf-brain <query>` | Query knowledge graph: files, decisions, learnings, seeds, hot files. |
| `/sf-learn <pattern>` | Teach a reusable pattern (persists across sessions). |
| `/sf-map` | Codebase report: architecture layers, hot files, co-change clusters. |
| `/sf-cost` | Token usage breakdown by agent, domain, model + success rates. |
| `/sf-diff` | Smart diff — changes grouped by task with file stats. |

### Config

| Command | What it does |
|---|---|
| `/sf-config` | View or set model tiers, token budget, post-ship hooks. |
| `/sf-help` | Show all commands. |

---

## Self-Improving Memory

ShipFast gets cheaper every session:

1. **First time** doing X → full pipeline (scout + architect + builder + critic). ~30K tokens.
2. **Second time** → skip scout + architect (brain has the patterns). ~15K tokens.
3. **Third time** → skip critic too (high confidence). ~8K tokens.

Learnings are confidence-weighted (0.0-1.0). Boosted on successful reuse. Auto-pruned after 30 days of non-use.

**Seeds**: Ideas surfaced during work are captured for future milestones — not lost, not distracting.

---

## Supported Languages

22 languages indexed: JavaScript, TypeScript, Rust, Python, Go, Java, Kotlin, Swift, C, C++, Ruby, PHP, Dart, Elixir, Scala, Zig, Lua, R, Julia, C#, F#, Vue/Svelte/Astro.

50+ directories skipped. 25+ lock files skipped.

---

## Uninstalling

```bash
shipfast uninstall
npm uninstall -g @shipfast-ai/shipfast
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview, code style, and how to help.

---

## License

MIT

Inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done). Built from scratch.
