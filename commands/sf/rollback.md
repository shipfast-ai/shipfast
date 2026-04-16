---
name: sf:rollback
description: "Rollback the last task, last N tasks, or an entire session."
argument-hint: "[last | all | N]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

<objective>
Undo multiple tasks or an entire session's work. Different from /sf-undo which
reverts one specific task by ID. /sf-rollback works on the most recent session.
</objective>

<process>

## Step 1: Load session history

```bash
sqlite3 -json .shipfast/brain.db "SELECT id, description, status, commit_sha FROM tasks WHERE status = 'passed' ORDER BY finished_at DESC LIMIT 20;" 2>/dev/null
```

## Step 2: Determine scope

Parse $ARGUMENTS:
- `last` or empty → rollback the most recent passed task
- `all` → rollback ALL passed tasks from the current session
- A number N → rollback the last N passed tasks

## Step 3: Confirm with user

Show what will be rolled back:
```
Rolling back [N] task(s):
  1. [description] (commit: [sha])
  2. [description] (commit: [sha])

This will run `git revert` for each commit. Continue? [y/n]
```

Use AskUserQuestion if the scope is `all` (higher risk).

## Step 4: Execute rollbacks

For each task (in reverse order — newest first):
```bash
git revert --no-edit [commit_sha]
sqlite3 .shipfast/brain.db "UPDATE tasks SET status='rolled_back' WHERE id='[id]';"
```

If a revert conflicts:
```
Revert of [description] has conflicts.
Resolve manually, then run: git revert --continue
```
Stop further rollbacks — don't cascade conflicts.

## Step 5: Report

```
Rolled back [N] task(s):
  ↩ [description] — reverted
  ↩ [description] — reverted

Run /sf-status to see current state.
```

</process>

<context>
$ARGUMENTS
</context>
