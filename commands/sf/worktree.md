---
name: sf:worktree
description: "Manage parallel worktrees — create, list, switch, status, complete. Uses git worktree for true parallel development."
argument-hint: "list | create <name> | switch <name> | status <name> | complete <name>"
allowed-tools:
  - Bash
  - AskUserQuestion
---

<objective>
Worktrees let you work on multiple features truly in parallel, each with its own
working directory, branch, and task tracking. Unlike branches, worktrees don't
require switching — each lives in its own folder so multiple Claude sessions
can work simultaneously.
</objective>

<process>

## Parse subcommand from $ARGUMENTS

### list
```bash
git worktree list
sqlite3 -json .shipfast/brain.db "SELECT key, value FROM context WHERE scope = 'worktree' ORDER BY updated_at DESC;" 2>/dev/null
```
Show all worktrees with path, branch, status (active/complete), and task counts.

### create <name>
1. Create worktree with new branch:
```bash
git worktree add .shipfast/worktrees/[name] -b sf/[name]
```
2. Ensure brain.db is accessible from the worktree (symlink):
```bash
mkdir -p .shipfast/worktrees/[name]/.shipfast
ln -sf "$(pwd)/.shipfast/brain.db" .shipfast/worktrees/[name]/.shipfast/brain.db
```
3. Store metadata in brain.db:
```bash
sqlite3 .shipfast/brain.db "INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at) VALUES ('worktree:[name]', 'worktree', '[name]', '{\"status\":\"active\",\"branch\":\"sf/[name]\",\"path\":\".shipfast/worktrees/[name]\",\"created\":\"[timestamp]\"}', 1, strftime('%s', 'now'));"
```
4. Report:
```
Worktree [name] created.
  Branch: sf/[name]
  Path:   .shipfast/worktrees/[name]/

To work in this worktree:
  cd .shipfast/worktrees/[name]
  # Then use /sf-do, /sf-plan, etc. as normal
```

### switch <name>
1. Verify worktree exists:
```bash
[ -d ".shipfast/worktrees/[name]" ] && echo OK || echo MISSING
```
2. If exists, report:
```
Worktree [name] is at: .shipfast/worktrees/[name]/

To work in it:
  cd .shipfast/worktrees/[name]

Or open a new terminal:
  cd [full path]/.shipfast/worktrees/[name]
```
Note: Unlike branches, worktrees don't need `git checkout`. Just `cd` into the directory.

### status <name>
```bash
git -C .shipfast/worktrees/[name] status --short
git -C .shipfast/worktrees/[name] log --oneline -5
sqlite3 -json .shipfast/brain.db "SELECT id, description, status FROM tasks WHERE phase LIKE '%[name]%' ORDER BY created_at;" 2>/dev/null
```
Show: uncommitted changes, recent commits, and pending tasks for this worktree.

### complete <name>
1. Check for uncommitted changes:
```bash
git -C .shipfast/worktrees/[name] status --porcelain
```
If dirty, warn: "Worktree has uncommitted changes. Commit or stash first."

2. Ask: "Merge sf/[name] into main and remove worktree? [y/n]"

3. If yes:
```bash
git checkout main
git merge sf/[name]
git worktree remove .shipfast/worktrees/[name]
git branch -d sf/[name]
```

4. Update brain.db:
```bash
sqlite3 .shipfast/brain.db "UPDATE context SET value = replace(value, '\"active\"', '\"complete\"'), updated_at = strftime('%s', 'now') WHERE id = 'worktree:[name]';"
```

5. Report: `Worktree [name] merged into main and removed.`

</process>

<context>
$ARGUMENTS
</context>
