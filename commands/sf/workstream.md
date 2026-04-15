---
name: sf:workstream
description: "Manage parallel workstreams — create, list, switch, complete."
argument-hint: "list | create <name> | switch <name> | complete <name>"
allowed-tools:
  - Bash
  - AskUserQuestion
---

<objective>
Workstreams let you work on multiple features in parallel, each with its own branch and task tracking.
Each workstream gets a namespaced set of tasks in brain.db.
</objective>

<process>

## Parse subcommand from $ARGUMENTS

### list
```bash
sqlite3 -json .shipfast/brain.db "SELECT key, value FROM context WHERE scope = 'workstream' ORDER BY updated_at DESC;" 2>/dev/null
git branch --list "sf/*" 2>/dev/null
```
Show all workstreams with status (active/complete) and branch name.

### create <name>
1. Create git branch: `git checkout -b sf/[name]`
2. Store in brain.db:
```bash
sqlite3 .shipfast/brain.db "INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at) VALUES ('workstream:[name]', 'workstream', '[name]', '{\"status\":\"active\",\"branch\":\"sf/[name]\",\"created\":\"[timestamp]\"}', 1, strftime('%s', 'now'));"
```
3. Report: `Workstream [name] created on branch sf/[name]`

### switch <name>
1. `git checkout sf/[name]`
2. Report: `Switched to workstream [name]`

### complete <name>
1. Ask: "Merge sf/[name] into current branch? [y/n]"
2. If yes: `git merge sf/[name]` then `git branch -d sf/[name]`
3. Update brain.db:
```bash
sqlite3 .shipfast/brain.db "UPDATE context SET value = replace(value, 'active', 'complete') WHERE id = 'workstream:[name]';"
```
4. Report: `Workstream [name] completed and merged.`

</process>

<context>
$ARGUMENTS
</context>
