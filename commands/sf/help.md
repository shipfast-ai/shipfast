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
  /sf-do <task>            Execute a task. Auto-detects complexity.
                           Trivial: inline (~3K) | Medium: 1 agent (~15K) | Complex: per-task (~40K)

PLANNING
  /sf-discuss <task>       Detect ambiguity, ask questions, lock decisions.
  /sf-plan <task>          Research (Scout) + Plan (Architect). Stores tasks in brain.db.
  /sf-check-plan           Verify plan before execution: scope, consumers, STRIDE threats.
  /sf-project <desc>       Decompose large project into phases with REQ-ID tracing.

EXECUTION
  /sf-do                   Execute tasks from brain.db. Per-task fresh context for complex.
  /sf-verify               Verify: 3-level artifacts, data flow, stubs, build, consumers.

SHIPPING
  /sf-ship [branch]        Create branch, push, output PR link.
  /sf-milestone            Complete or start a milestone.

SESSION
  /sf-status               Brain stats, tasks, checkpoints, version.
  /sf-resume               Resume from previous session.
  /sf-undo [task-id]       Rollback a completed task.

KNOWLEDGE
  /sf-brain <query>        Query knowledge graph: files, decisions, learnings, hot files.
  /sf-learn <pattern>      Teach a reusable pattern.
  /sf-map                  Generate codebase report from brain.db.

PARALLEL WORK
  /sf-workstream list      Show all workstreams.
  /sf-workstream create    Create namespaced workstream with branch.
  /sf-workstream switch    Switch active workstream.
  /sf-workstream complete  Complete and merge workstream.

CONFIG
  /sf-config               View or set model tiers and preferences.
  /sf-help                 Show this help.

WORKFLOWS
  Simple:     /sf-do fix the typo in header
  Standard:   /sf-plan add dark mode → /sf-check-plan → /sf-do → /sf-verify
  Complex:    /sf-project → /sf-discuss → /sf-plan → /sf-check-plan → /sf-do → /sf-verify → /sf-ship

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
