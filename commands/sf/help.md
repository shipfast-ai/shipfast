---
name: sf:help
description: "Show all ShipFast commands with descriptions."
allowed-tools: []
---

<objective>
Display all available ShipFast commands with brief descriptions.
</objective>

<process>

Print the following:

```
ShipFast — Autonomous Context-Engineered Development
=====================================================

CORE
  /sf-do <task>         The one command. Describe what you want in natural language.
                        Auto-detects complexity: trivial (3K tokens) → medium (15K) → complex (40K)

PLANNING
  /sf-discuss <task>    Detect ambiguity and ask targeted questions before planning.
                        Stores answers as locked decisions in brain.db.
  /sf-project <desc>    Decompose a large project into phases with REQ-ID tracing.
                        Each phase runs through /sf-do independently.

SHIPPING
  /sf-ship [branch]     Create branch, push, output PR link with auto-generated description.

SESSION
  /sf-status            Show brain stats, tasks, checkpoints.
  /sf-resume            Resume work from a previous session. Loads state from brain.db.
  /sf-undo [task-id]    Rollback a completed task via git revert or stash.

KNOWLEDGE
  /sf-brain <query>     Query the codebase knowledge graph directly.
                        Examples: "files like auth", "decisions", "hot files", "stats"
  /sf-learn <pattern>   Teach a reusable pattern. Persists across sessions.
                        Example: /sf-learn tailwind-v4: Use @import not @tailwind

CONFIG
  /sf-config [key val]  View or set model tiers and preferences.
  /sf-help              Show this help message.

WORKFLOW
  /sf-do runs a 9-step pipeline that adapts to task complexity:

  TRIVIAL (fix typo)     → Builder only, no planning, ~3K tokens
  MEDIUM (add feature)   → Scout → Architect → Builder → Critic, ~15K tokens
  COMPLEX (new system)   → Full pipeline + discussion + verification, ~40K tokens

  Steps: Analyze → Init Brain → Discuss → Plan → Checkpoint → Execute → Verify → Learn → Report
  Each step is skippable — the system only runs what's needed.

TIPS
  - Start simple: /sf-do fix the login bug
  - For big projects: /sf-project Build a billing system
  - Teach patterns: /sf-learn react-hooks: Always cleanup useEffect subscriptions
  - Check progress: /sf-status
  - Undo mistakes: /sf-undo
```

</process>
