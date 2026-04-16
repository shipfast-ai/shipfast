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

## Step 1: Get recent passed tasks

```bash
sqlite3 -json .shipfast/brain.db "SELECT id, description, commit_sha, status FROM tasks WHERE status = 'passed' AND commit_sha IS NOT NULL ORDER BY finished_at DESC LIMIT 10;" 2>/dev/null
```

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

</process>

<context>
$ARGUMENTS
</context>
