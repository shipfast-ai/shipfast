<div align="center">

# ShipFast

**Autonomous context-engineered development system with SQLite brain.**

**5 agents. 17 commands. Per-task fresh context. 70-90% fewer tokens.**

Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Cursor, Windsurf, Antigravity, Augment, Trae, Qwen Code, CodeBuddy, Cline

```
npm i -g @shipfast-ai/shipfast
```

Works on Mac, Windows, and Linux.

</div>

---

## Why ShipFast?

Context rot kills AI coding quality. As the context window fills up, output degrades.

ShipFast fixes this with a **SQLite knowledge graph** that gives each agent fresh context and gets smarter every session.

- **17 commands, 5 composable agents** — simple to learn, covers the full workflow
- **SQLite brain** — queryable knowledge graph, zero markdown files
- **3K-40K tokens per feature** — 70-90% less than typical AI dev workflows
- **Fresh context per task** — no accumulated garbage between tasks
- **Cross-session learning** — records decisions and patterns, gets cheaper over time
- **Codebase indexing in <1 second** — 973 files indexed in 636ms
- **Graph-derived architecture** — auto-detects layers from import graph
- **Cross-repo linking** — search across multiple repos with `shipfast link`
- **17 MCP tools** — structured brain access, no SQL improvisation
- **Works with 14 AI coding tools** — auto-detects and installs for all

---

## Getting Started

```bash
npm i -g @shipfast-ai/shipfast
```

Auto-detects your AI tools and installs for all of them. Then index your repo:

```bash
cd your-project
shipfast init
```

Verify: run `/sf-help` in your AI tool.

### Staying Updated

```bash
shipfast update
```

Updates the package and re-detects runtimes (catches newly installed AI tools).

### Terminal Commands

```bash
shipfast init           # Index current repo into .shipfast/brain.db
shipfast init --fresh   # Full reindex (clears existing brain)
shipfast link <path>    # Link another repo for cross-repo search
shipfast unlink [path]  # Unlink a repo (or all)
shipfast status         # Show installed runtimes + brain + links
shipfast update         # Update + re-detect runtimes
shipfast uninstall      # Remove from all AI tools
shipfast help           # Show all commands
```

---

## How It Works

Already have code? `shipfast init` indexes your codebase in under 1 second — functions, types, imports, git history. No parallel agents, no markdown files. Just a SQLite database.

### 1. Plan Phase

```
/sf-plan Add Stripe billing with webhooks
```

Spawns two agents in fresh contexts:

**Scout** — Researches the codebase. Finds relevant files, functions, consumers. Tags findings with confidence levels: [VERIFIED], [CITED], [ASSUMED].

**Architect** — Creates a precise task list using goal-backward methodology. Starts from "what does done look like" and works backward to tasks. Each task has exact file paths, consumer lists, verify commands, and measurable done criteria.

Tasks are stored in brain.db. No PLAN.md files.

### 2. Execute

```
/sf-do
```

Reads tasks from brain.db and executes them.

**Trivial tasks** (fix a typo, add an import) — executes inline. No agents, no planning. ~3K tokens.

**Medium tasks** (add a component, refactor a module) — one Builder agent with all tasks batched. ~15K tokens.

**Complex tasks** (new feature across multiple files) — **per-task Builder agents with fresh context each.** No accumulated garbage between tasks. Each Builder:

1. Reads files + greps for consumers of anything it'll change
2. Implements following existing patterns
3. Runs build/typecheck — fixes errors before committing
4. Commits with conventional format
5. Updates task status in brain.db

After all tasks: Critic reviews the diff. Scribe records decisions and learnings to brain.db.

### 3. Verify

```
/sf-verify
```

Separate verification in fresh context:

- **3-level artifact validation**: exists → substantive (not stubs) → wired (imported and used)
- **Data flow tracing**: components receive real data, not hardcoded empty arrays
- **Consumer integrity**: removed exports have zero remaining consumers
- **Stub detection**: TODO, FIXME, placeholder, empty handlers, console.log, debugger
- **Build verification**: runs build command, reports pass/fail

Scores: PASS / PASS_WITH_WARNINGS / FAIL with specific failure details.

### 4. Discuss (when needed)

```
/sf-discuss Add authentication
```

Detects ambiguity before planning (zero LLM tokens — rule-based):

- **WHERE**: No file paths mentioned
- **WHAT**: No behavior described
- **HOW**: Multiple approaches possible
- **RISK**: Touches auth/payment/data
- **SCOPE**: Broad request with conjunctions

Asks 2-5 targeted questions. Stores answers as locked decisions in brain.db. Never asks the same question twice (even across sessions).

### 5. Ship

```
/sf-ship
```

Creates branch, generates PR description from brain.db (decisions, tasks, changes), pushes, outputs PR link.

### 6. Repeat → Complete → Next Milestone

```
/sf-discuss Phase 2
/sf-plan Phase 2: Payment webhooks
/sf-do
/sf-verify
/sf-ship
...
/sf-milestone complete
/sf-milestone new v2.0
```

Or for simple tasks, skip the ceremony:

```
/sf-do fix the login bug
```

ShipFast auto-detects complexity and runs the right workflow.

---

## Why Fresh Context Matters

Context rot is the #1 quality killer. As the context window fills with file reads, error messages, and previous task artifacts, Claude's output quality degrades.

ShipFast solves this:

| Phase | Agent | Context |
|---|---|---|
| Research | Scout (Haiku) | Fresh — only brain.db context |
| Planning | Architect (Sonnet) | Fresh — Scout findings + brain.db |
| Execution | Builder (Sonnet) × N | Fresh per task — task plan + brain.db |
| Review | Critic (Haiku) | Fresh — git diff only |
| Documentation | Scribe (Haiku) | Fresh — session summary |

Each agent starts clean. No accumulated garbage. Quality stays consistent from first task to last.

---

## Brain (SQLite Knowledge Graph)

All state lives in `.shipfast/brain.db`. Zero markdown files.

| Table | What it stores |
|---|---|
| `nodes` | Functions, types, classes, components (auto-extracted) |
| `edges` | Import/call/dependency relationships + git co-change patterns |
| `decisions` | Compact Q&A pairs (~40 tokens each, not ~500 like markdown) |
| `learnings` | Error→fix patterns with confidence scoring |
| `tasks` | Execution history with commit SHAs |
| `requirements` | REQ-IDs mapped to phases for tracing |
| `checkpoints` | Git stash refs for rollback |
| `hot_files` | Most frequently changed files from git history |
| `architecture` | Auto-computed layers from import graph (zero hardcoding) |
| `folders` | Directory roles auto-detected from import patterns |

**Incremental indexing**: only re-indexes changed files (~300ms). Deleted files auto-cleaned.

**MCP Server**: brain.db is exposed as 17 structured MCP tools. LLMs call these instead of improvising SQL.

---

## Architecture Intelligence

ShipFast auto-derives architecture layers from the import graph — **zero hardcoded folder patterns**. Works with any project structure, any language.

**How it works**:
1. BFS from entry points (files nothing imports) assigns layer depth
2. Fuzzy import resolution handles `@/`, `~/`, and alias paths
3. Folder roles detected from aggregate import/export ratios
4. Recomputed on every `shipfast init` (instant)

**What it produces**:

- **Layer 0** (entry): files nothing imports — pages, routes, App.tsx
- **Layer 1-N** (deeper): each layer imported by the layer above
- **Leaf layer**: files that import nothing — types, constants
- **Folder roles**: entry (imports many), shared (imported by many), consumer, leaf, foundation

**Why it matters**: Scout knows which layer a file lives in. Builder knows to check upstream consumers before modifying a shared layer. Critic can detect skip-layer violations. Verifier traces data flow from entry to data source.

All exposed as MCP tools: `brain_arch_layers`, `brain_arch_folders`, `brain_arch_file`, `brain_arch_data_flow`, `brain_arch_most_connected`.

---

## Agents

5 composable agents replace 31 specialized ones. Same behavioral rules, 90% fewer tokens.

| Agent | Role | Model | Key Rules |
|---|---|---|---|
| **Scout** | Research | Haiku | Confidence tagging, 12-call limit, architecture mapping, consumer lists |
| **Architect** | Planning | Sonnet | Goal-backward, exact file paths, consumer checks, scope prohibition, must-haves |
| **Builder** | Execution | Sonnet | Impact analysis before every change, per-task build verify, 3-attempt limit, deviation tracking, threat scan |
| **Critic** | Review | Haiku | 3 depths (quick/standard/deep), import graph tracing, consumer integrity check |
| **Scribe** | Documentation | Haiku | Records decisions + learnings to brain.db via sqlite3, PR descriptions |

### Builder's Rule Zero

Before deleting, removing, or modifying ANY function, type, or export:

```bash
grep -r "functionName" --include="*.ts" --include="*.tsx" .
```

If other files use it → update them or keep it. **NEVER remove without checking consumers.** This single rule prevents 80% of refactoring bugs.

---

## Commands

### Core Workflow

| Command | What it does |
|---|---|
| `/sf-do <task>` | Execute a task. Auto-detects complexity: trivial → medium → complex |
| `/sf-plan <task>` | Research (Scout) + Plan (Architect). Stores tasks in brain.db |
| `/sf-check-plan` | Verify plan before execution: scope, consumers, deps, STRIDE threats |
| `/sf-verify` | Verify completed work: artifacts, data flow, stubs, build, consumers |
| `/sf-discuss <task>` | Detect ambiguity, ask targeted questions, lock decisions |

### Projects

| Command | What it does |
|---|---|
| `/sf-project <desc>` | Decompose large project into phases with REQ-ID tracing + 4 parallel researchers |
| `/sf-milestone [complete\|new]` | Complete current milestone or start next version |
| `/sf-workstream <action>` | Parallel feature branches: create, list, switch, complete |

### Shipping

| Command | What it does |
|---|---|
| `/sf-ship` | Create branch, push, output PR link with auto-generated description |

### Session

| Command | What it does |
|---|---|
| `/sf-status` | Show brain stats, tasks, checkpoints, version |
| `/sf-resume` | Resume from previous session (loads state from brain.db) |
| `/sf-undo [task-id]` | Rollback a completed task via git revert |

### Knowledge

| Command | What it does |
|---|---|
| `/sf-brain <query>` | Query knowledge graph: files, decisions, learnings, hot files |
| `/sf-learn <pattern>` | Teach a reusable pattern (persists across sessions) |
| `/sf-map` | Generate codebase report: architecture layers, hot files, co-change clusters |

### Config

| Command | What it does |
|---|---|
| `/sf-config` | View or set model tiers and preferences |
| `/sf-help` | Show all commands with workflows |

---

## Workflows

```
Simple:     /sf-do fix the typo in header
Standard:   /sf-plan add dark mode → /sf-check-plan → /sf-do → /sf-verify
Complex:    /sf-project Build billing → /sf-discuss → /sf-plan → /sf-check-plan → /sf-do → /sf-verify → /sf-ship
```

---

## Self-Improving Memory

ShipFast gets cheaper and smarter every session:

1. **First time** doing X → full pipeline (scout + architect + builder + critic)
2. **Second time** → skip scout + architect (brain has the patterns)
3. **Third time** → skip critic too (high confidence learnings)

Learnings are confidence-weighted (0.0-1.0). Boost on successful reuse. Auto-prune after 30 days of non-use. Users teach directly with `/sf-learn`.

---

## Configuration

Model tiers per agent (configurable with `/sf-config`):

```
Scout:     haiku    (reading is cheap)
Architect: sonnet   (planning needs reasoning)
Builder:   sonnet   (coding needs quality)
Critic:    haiku    (diff review is pattern matching)
Scribe:    haiku    (writing commit msgs is simple)
```

---

## Supported Languages

22 languages indexed: JavaScript, TypeScript, Rust, Python, Go, Java, Kotlin, Swift, C, C++, Ruby, PHP, Dart, Elixir, Scala, Zig, Lua, R, Julia, C#, F#, Vue/Svelte/Astro.

50+ directories skipped (node_modules, dist, target, __pycache__, .venv, Pods, etc.) sourced from GitHub's official gitignore templates.

25+ lock files skipped (package-lock.json, Cargo.lock, poetry.lock, go.sum, etc.).

---

## Uninstalling

```bash
shipfast uninstall
npm uninstall -g @shipfast-ai/shipfast
```

Auto-detects and removes from all runtimes. Cleans settings.json hooks.

---

## License

MIT

Inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done). Built from scratch.
