---
name: sf:check-plan
description: "Verify planned tasks before execution. Checks scope, consumers, dependencies, must-haves coverage."
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Skill
---

<objective>
Plan-checker: verifies tasks in brain.db are safe to execute before /sf-do runs them.
Catches scope creep, missing consumers, broken dependencies, and uncovered must-haves.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:check-plan", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## Step 1: Load tasks and must-haves

Use the `brain_tasks` MCP tool with: `{ "action": "list", "status": "pending" }` — returns pending tasks ordered by created_at.

Use the `brain_context` MCP tool with: `{ "action": "get", "key_like": "must_haves:%", "limit": 1 }` — returns the most recent must-haves entry.

## Step 2: Check each task

For each task, verify:

**Files exist**: every file path mentioned in plan_text exists on disk (or is marked as "create")
**Consumers checked**: if task removes/modifies exports, grep confirms consumer list is complete
**Dependencies**: if task depends on another task, that task is also pending (not missing)
**Scope**: no banned words (v1, simplified, placeholder, hardcoded for now)
**Verify command**: task has a concrete verify command (not vague)

## Step 3: Check must-haves coverage

Every truth in must-haves must be addressed by at least one task.
Every artifact must have a task that creates/modifies it.
Flag orphaned must-haves (not covered by any task).

## Step 4: STRIDE threat check (Feature #1)

For tasks that create new endpoints, auth flows, or data access:

| Threat | Check |
|---|---|
| **S**poofing | Does the task include auth/identity verification? |
| **T**ampering | Is input validated before processing? |
| **R**epudiation | Are actions logged/auditable? |
| **I**nformation disclosure | Are errors sanitized (no stack traces to users)? |
| **D**enial of service | Is there rate limiting or input size validation? |
| **E**levation of privilege | Are permissions checked before sensitive operations? |

For each applicable threat, output: `THREAT: [S/T/R/I/D/E] [component] — [mitigation needed]`

## Step 5: Report

```
Plan Check: [PASS / ISSUES FOUND]

Tasks: [N] pending
Must-haves: [N]/[M] covered
Threats: [N] flagged

[If issues:]
  ISSUE: Task [id] — [file not found / missing consumer / scope creep / etc.]
  THREAT: [S/T/R/I/D/E] [component] — [what's needed]

```

## Step 6: Ask next step

If PASS:
  Use AskUserQuestion: "Plan verified — no issues. Execute now?"
  - Options: "Yes, execute" / "No, I'll review first"
  If yes → use the Skill tool with skill_name "sf:do" to start execution.

If ISSUES FOUND:
  Use AskUserQuestion: "[N] issues found. What do you want to do?"
  - Options: "Re-plan (fix issues first)" / "Execute anyway" / "Stop"
  If re-plan → use Skill tool with skill_name "sf:plan" and the original task.
  If execute anyway → use Skill tool with skill_name "sf:do".


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
