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
This command loads that state, verifies commits exist, and continues.
</objective>

<process>

## Step 1: Load State

Query brain.db for the latest saved session state.
Show the user:

```
Session Recovery
================
Saved: 15 minutes ago
Stopped at: context exhaustion at 92%

Completed: 3 tasks
  task:auth:1 — Add JWT middleware [a1b2c3d]
  task:auth:2 — Add login endpoint [e4f5g6h]
  task:auth:3 — Add token refresh [i7j8k9l]

Pending: 2 tasks
  task:auth:4 — Add logout endpoint
  task:auth:5 — Add auth tests

Decisions carried forward: 4
```

## Step 2: Verify Commits

Check that all reported commit SHAs exist in git history.
If any are missing, warn the user before continuing.

## Step 3: Confirm and Continue

Ask: "Resume from task 4/5? (Completed tasks will not be redone)"

If confirmed:
1. Inject compressed state into Builder context (~300-500 tokens)
2. Skip completed tasks entirely
3. Continue with the next pending task
4. All previous decisions are automatically available via brain.db

## Step 4: Continue Pipeline

Resume the /sf-do pipeline from Step 6 (EXECUTE) with remaining tasks.
All brain.db context (decisions, learnings, conventions) carries forward automatically.

</process>
