---
name: sf:undo
description: "Rollback the last task or a specific task by ID."
argument-hint: "[task-id]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Safely rollback a completed task using git revert or stash-based checkpoints.
If no task ID provided, shows recent tasks and asks which to undo.
</objective>

<process>

## Step 1: Identify Target

If a task ID was provided as argument, use that.
Otherwise, query brain.db for recent completed tasks and display them:

```
Recent tasks (pick one to undo):
  1. [task_id] - [description] ([commit_sha])
  2. [task_id] - [description] ([commit_sha])
  3. [task_id] - [description] ([commit_sha])
```

Ask the user which to undo.

## Step 2: Check Safety

- Is this task a dependency for other completed tasks?
- Does the commit have downstream commits that depend on it?
- If yes, warn the user and ask for confirmation.

## Step 3: Execute Rollback

If task has a commit_sha:
- `git revert --no-commit [sha]`
- `git commit -m "revert: undo [task description]"`

If task has a stash checkpoint:
- `git stash apply [ref]`

Update task status to 'rolled_back' in brain.db.

## Step 4: Confirm

```
Rolled back: [task description]
Method: [git revert | stash apply]
```

</process>

<context>
$ARGUMENTS
</context>
