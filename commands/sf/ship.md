---
name: sf:ship
description: "Create a PR from completed work. Uses Scribe's PR description template."
argument-hint: "[branch-name]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
---

<objective>
Ship completed work: create branch, commit any uncommitted changes, push, and output PR link.
Uses brain.db to gather decisions and generate PR description.
</objective>

<process>

## Step 1: Check Status

Verify work is ready to ship:
- `git status` — check for uncommitted changes
- `git log --oneline -5` — check recent commits
- If uncommitted changes exist, ask: commit first or ship as-is?

## Step 2: Create Branch (if on main)

If currently on `main`:
1. Generate branch name from recent commits: `feat/[scope]` or `fix/[scope]`
2. Create branch: `git checkout -b [branch-name]`

If already on a feature branch, use it.

## Step 3: Build PR Description

Query brain.db for this session's work:

**Decisions made:**
```sql
SELECT question, decision FROM decisions ORDER BY created_at DESC LIMIT 10
```

**Tasks completed:**
```sql
SELECT description, commit_sha, status FROM tasks WHERE status = 'passed' ORDER BY created_at
```

**Requirements covered (if project has REQ-IDs):**
```sql
SELECT id, description FROM requirements WHERE status = 'done'
```

Build PR description using Scribe template:
```markdown
## Summary
- [main change bullet 1]
- [main change bullet 2]

## What Changed
- `file1.ts` — [what and why]
- `file2.ts` — [what and why]

## Decisions
- [decision 1]
- [decision 2]

## How to Test
1. [step 1]
2. [step 2]
3. [expected result]
```

## Step 4: Push

```bash
git push -u origin [branch-name]
```

## Step 5: Output PR Link

Detect repo from `git remote -v`, output:
```
PR ready: https://github.com/[org]/[repo]/compare/main...[branch]?expand=1

[PR description above — copy into the PR body]
```

## Step 6: Post-Ship Hook (optional)

Check brain.db for a configured post-ship hook:

Use the `brain_config` MCP tool with: `{ "action": "get", "key": "post_ship_hook" }`

If a hook is configured (e.g., `npm run deploy`, `./scripts/notify.sh`):
1. Report: `Running post-ship hook: [command]`
2. Execute the command
3. Report result: `Hook completed.` or `Hook failed: [error]`

Configure with: `/sf-config post-ship-hook <command>`

</process>

<context>
$ARGUMENTS
</context>
