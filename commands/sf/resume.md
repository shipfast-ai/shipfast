---
name: sf:resume
description: "Resume work from a previous session. Loads state from brain.db, verifies commits, continues where you left off."
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Resume interrupted work from a previous session.
State is automatically saved to brain.db when context runs low or work is paused.
This command loads that state, verifies commits exist, and continues with fresh context per task.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:resume", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## Step 1: Load Saved Progress

Check for lock file indicating crashed session:
```bash
[ -f .shipfast/lock ] && cat .shipfast/lock
```
If found: "Detected interrupted session. Recovering..."

Query brain.db for the latest saved session progress:

`brain_context: { action: get, scope: session, key: progress }`

Show the user:

```
Session Recovery
================
Resuming from task [N+1]/[M].

Previously completed: [N] tasks
  [task ID 1] — [task description] [commit sha]
  [task ID 2] — [task description] [commit sha]
  ...

Pending: [M-N] tasks
  [task ID N+1] — [task description]
  ...

Decisions carried forward: [count]
Learnings available: [count]
```

Also load decisions and learnings from brain.db for context:
- `brain_decisions: { action: list }` — architectural decisions from prior session
- `brain_learnings: { action: list }` — error/fix patterns recorded

## Step 2: Verify Commits

Check that all reported commit SHAs for completed tasks exist in git history:

```bash
git log --oneline -20
```

If any completed task's commit SHA is missing, warn the user before continuing:
`WARN: Commit [sha] for task [id] not found in git history. Task may need to be redone.`

## Step 3: Confirm and Continue

Show: "Resuming from task [N+1]/[M]. Previously completed tasks will not be redone."

If no pending tasks remain:
`All [M] tasks were completed in the previous session. Nothing to resume.`

Otherwise proceed automatically (no confirmation prompt needed unless there are missing commits).

## Step 4: Continue Pipeline

Resume execution using the **complex workflow** (per-task fresh agents) for all pending tasks:

**REQUIRED — output progress for EVERY task:**

Before each task:
```
[N/M] Building: [task description]...
```
After each task:
```
[N/M] Done: [task description] (commit: [sha])
```

For each pending task:
1. Launch a SEPARATE sf-builder agent with ONLY that task + brain context
2. Builder gets fresh context — no accumulated state from previous tasks
3. Builder executes: read → grep consumers → implement → build → verify → commit
4. Update task status in brain.db: `brain_tasks: { action: update, id: [id], status: passed, commit_sha: [sha] }`
5. Update saved progress: `brain_context: { action: set, scope: session, key: progress, value: { completed: [...updated list], pending: [...remaining], next_task: [next id] } }`
6. Continue to next task

All brain.db context (decisions, learnings, conventions) carries forward automatically.

## Step 5: Complete

After all pending tasks are done, run post-execution verification (Steps 7A-7H from /sf-do):
- Launch Critic agent
- Build verification
- Consumer integrity check
- Stub scan
- Launch Scribe to record any new decisions/learnings

Report:
```
Resume complete. [M]/[M] tasks done.
Commits: [N] | Build: [PASS/FAIL] | Critic: [verdict]
```


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>
