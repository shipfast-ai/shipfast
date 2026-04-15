<div align="center">

# ShipFast

**Autonomous context-engineered development system.**

**5 agents. 12 commands. SQLite brain. 70-90% less tokens than alternatives.**

Supports 14 runtimes: Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Cursor, Windsurf, Antigravity, Augment, Trae, Qwen Code, CodeBuddy, Cline

</div>

---

## Why ShipFast?

Traditional AI dev tools fight context rot by generating **more** context — 15+ markdown files per phase, 31 specialized agents, 50+ commands to memorize. That's bureaucracy, not engineering.

ShipFast flips the model:

> **Compute context on-demand. Never store what you can derive. Never ask what you can infer.**

| | Alternatives | ShipFast |
|---|---|---|
| **Commands** | 50+ | 12 |
| **Agents** | 31 specialized | 5 composable |
| **Context storage** | ~15 markdown files per phase | 1 SQLite database |
| **Tokens per feature** | 95K-150K | 3K-40K |
| **Trivial task overhead** | Full ceremony | Near-zero |
| **Cross-session memory** | Flat STATE.md | Weighted learnings with decay |
| **Staleness detection** | None | Content hash auto-detect |
| **Learning from mistakes** | None | Self-improving with confidence scoring |

---

## Install

```bash
npm i -g @shipfast-ai/shipfast
```

That's it. Auto-detects your AI tools (Claude Code, Cursor, Gemini, etc.) and installs for all of them.

Then index your repo:

```bash
cd your-project
shipfast init
```

### Commands

```bash
shipfast init         # index current repo into .shipfast/brain.db
shipfast update       # update to latest + re-detect new AI tools
shipfast uninstall    # remove from all AI tools
shipfast help         # show commands
```

---

## Commands

### `/sf-do` — The One Command

```
/sf-do Add Stripe billing with usage-based pricing
/sf-do Fix the login redirect bug
/sf-do Refactor the auth module to use jose
```

That's it. ShipFast analyzes your request, classifies intent and complexity, selects the right workflow depth, and executes autonomously.

**Workflow auto-selection:**
- **Trivial** (typo fix, add a spinner) — Direct execute. No planning. ~2K-5K tokens.
- **Medium** (add dark mode, paginate a table) — Quick plan, execute, review. ~10K-20K tokens.
- **Complex** (add Stripe billing, rewrite auth) — Full pipeline. ~40K-80K tokens.

### `/sf-status` — Progress Dashboard

```
ShipFast Status
===============
Brain: 342 nodes | 1,847 edges | 12 decisions | 8 learnings | 50 hot files
Tasks: 1 active | 5 completed
Checkpoints: 3 available
```

### `/sf-undo` — Safe Rollback

```
/sf-undo              # Shows recent tasks, pick one
/sf-undo task:auth:1  # Undo specific task
```

Uses `git revert` for committed work, stash-based rollback for uncommitted.

### `/sf-config` — Configuration

```
/sf-config                        # Show all config
/sf-config model-builder opus     # Use Opus for code writing
/sf-config model-critic haiku     # Use Haiku for reviews (cheap)
```

### `/sf-brain` — Query Knowledge Graph

```
/sf-brain files like auth         # Find auth-related files
/sf-brain what calls validateToken # Dependency tracing
/sf-brain decisions               # All decisions made
/sf-brain hot files               # Most frequently changed files
/sf-brain stats                   # Brain statistics
```

### `/sf-learn` — Teach Patterns

```
/sf-learn react-19-refs: Use callback refs, not string refs
/sf-learn tailwind-v4: Use @import not @tailwind directives
/sf-learn prisma-json: Always cast JSON fields with Prisma.JsonValue
```

Learnings start at 0.8 confidence, boost on reuse, decay with time.

---

## Architecture

```
+---------------------------------------------------+
|  Layer 1: BRAIN (SQLite Knowledge Graph)           |
|  .shipfast/brain.db — auto-indexed, queryable      |
+---------------------------------------------------+
|  Layer 2: AUTOPILOT (Intent Router)                |
|  Rule-based classification — zero LLM cost         |
+---------------------------------------------------+
|  Layer 3: SWARM (5 Composable Agents)              |
|  Scout, Architect, Builder, Critic, Scribe         |
+---------------------------------------------------+
```

### Brain (SQLite)

All project state lives in `.shipfast/brain.db`. Zero markdown files.

| Table | Purpose | Replaces |
|---|---|---|
| `nodes` | Functions, types, classes, components | codebase-mapper agents |
| `edges` | Import/call/dependency graph | manual dependency tracking |
| `decisions` | Compact Q&A pairs (~40 tokens each) | STATE.md (~500 tokens each) |
| `learnings` | Self-improving patterns with confidence | nothing (GSD doesn't learn) |
| `tasks` | Execution history with commit SHAs | PLAN.md + VERIFICATION.md |
| `checkpoints` | Git stash refs for rollback | nothing (GSD can't undo) |
| `token_usage` | Per-agent spending tracker | nothing (GSD doesn't track) |
| `hot_files` | Git-derived change frequency | nothing |

Auto-indexed on first run. Incremental re-indexing on file changes (~100ms).

### Autopilot

Zero-cost routing (no LLM tokens):

1. **Intent** — Regex matching: fix, feature, refactor, test, ship, perf, security, etc.
2. **Complexity** — Heuristic: word count + conjunction count + area count
3. **Workflow** — Auto-select: trivial (direct) / medium (quick) / complex (full)

### Agents

5 composable agents replace 31 specialized ones:

| Agent | Role | Default Model | Typical Cost |
|---|---|---|---|
| **Scout** | Read code, find files, fetch docs | Haiku | ~3K tokens |
| **Architect** | Plan tasks, order dependencies | Sonnet | ~5K tokens |
| **Builder** | Write code, run tests, commit | Sonnet | ~8K tokens |
| **Critic** | Review diffs for bugs/security | Haiku | ~2K tokens |
| **Scribe** | Record decisions, write PR desc | Haiku | ~1K tokens |

Each gets a tiny base prompt (~200 tokens) + targeted context from brain.db.

---

## Token Efficiency

### Blast Radius Context (not full files)

```sql
-- Instead of loading 20 full files (~15K tokens),
-- load only the dependency subgraph (~500 tokens)
WITH RECURSIVE affected AS (
  SELECT id FROM nodes WHERE file_path IN (...)
  UNION
  SELECT e.target FROM edges e
  JOIN affected a ON e.source = a.id
  WHERE depth < 3
)
SELECT signature FROM nodes JOIN affected ...
```

### Compressed Decisions

```
GSD STATE.md (~500 tokens per decision):
  "After discussing with the user, we decided to use jose..."

brain.db (~40 tokens per decision):
  Q: "JWT library?" -> "jose — Edge+Node, good TS types"
```

### Model Tiering

60% of LLM calls use Haiku (cheapest tier). Only Builder and Architect use Sonnet. Configurable per-agent.

---

## Self-Improving Memory

1. Task fails -> pattern + error recorded in `learnings` table
2. Next similar task -> learning injected into Builder context
3. Learning helps -> confidence increases (max 1.0)
4. Learning unused for 30 days -> auto-pruned
5. Users teach directly with `/sf-learn` (starts at 0.8 confidence)

---

## Configuration

Default model tiers (configurable with `/sf-config`):

```
Scout:     haiku    (reading is cheap)
Architect: sonnet   (planning needs reasoning)
Builder:   sonnet   (coding needs quality)
Critic:    haiku    (diff review is pattern matching)
Scribe:    haiku    (writing commit msgs is simple)
```

---

## License

MIT
