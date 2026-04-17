---
name: sf:diff
description: "Smart diff viewer — changes grouped by task with file stats."
allowed-tools:
  - Bash
---

<objective>
Show recent changes organized by task, not by commit. Maps each file change
to the task that caused it, making it easy to review what was done.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:diff", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## Step 1: Get recent passed tasks

Use the `brain_tasks` MCP tool with: `{ "action": "list", "status": "passed", "has_commit_sha": true, "limit": 10 }` — returns passed tasks with commits ordered by finished_at descending.

## Step 2: For each task, get the diff stats

```bash
git show --stat --format='' [commit_sha]
```

## Step 3: Format as grouped report

```
Recent Changes by Task
======================

Task: [description]
  Commit: [sha] ([date])
  Files:
    M src/auth/login.ts       (+15 -3)
    A src/auth/validate.ts    (+42)
    M src/types/user.ts       (+5 -1)

Task: [description]
  Commit: [sha] ([date])
  Files:
    M src/api/billing.ts      (+28 -12)
    A src/hooks/usePayment.ts (+35)

Summary: [N] tasks | [M] files changed | +[additions] -[deletions]
```

If $ARGUMENTS contains a task ID or description, filter to show only that task's diff in full detail (`git show [sha]`).


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
