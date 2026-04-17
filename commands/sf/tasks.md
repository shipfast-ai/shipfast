---
name: sf:tasks
description: "Task CRUD — list, show, rename, edit, status, delete, restore. Soft-delete only (recoverable)."
argument-hint: "list [--all] [--phase P] [--status S] | show <id> | rename <id> <desc> | edit <id> <plan_text> | status <id> <new_status> | delete <id> | restore <id>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Direct CRUD access to the `tasks` table populated by /sf:plan and /sf:do.
Soft-delete by default (status='deleted') — recoverable via /sf:tasks restore.
</objective>

<process>

## Step 0: Session start

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Parse the first token of `$ARGUMENTS` as `SUBCOMMAND`.

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:tasks", args: "$ARGUMENTS", branch: BRANCH, classification: "{\"subcommand\":\"<SUBCOMMAND>\"}" }`

Initialize `artifacts = []`.

## Dispatch on SUBCOMMAND

### `list [--all] [--phase <P>] [--status <S>]`

Parse flags from `$ARGUMENTS`:
- `--all` → `include_deleted: true`
- `--phase <P>` → `phase: P`
- `--status <S>` → `status_filter: S`

Call: `brain_tasks { action: "list", include_deleted: <flag>, phase: <P?>, status_filter: <S?> }`

Render as a compact table (truncate description to ~60 chars):

```
ID            STATUS      PHASE           DESCRIPTION
task:1743...  pending     auth-phase      Add JWT middleware to API routes
task:1743...  deleted     -               Old attempt at caching layer
```

### `show <id>`

Call: `brain_tasks { action: "show", id: "<id>" }`

Print all fields. Wrap `plan_text` in a fenced markdown block:

```
ID:          <id>
Phase:       <phase>
Status:      <status>
Description: <description>
Commit:      <commit_sha or "-">
Attempts:    <attempts>
Created:     <unix ts as ISO date>
Started:     <started_at or "-">
Finished:    <finished_at or "-">
Error:       <error or "-">

Plan text:
    (fenced block here)
```

### `rename <id> <new description...>`

Parse `<id>` as the second token. Everything after is the new description.

Call: `brain_tasks { action: "rename", id: "<id>", description: "<new desc>" }`

Print: `Renamed <id>: <new desc>`.

### `edit <id> <new plan_text...>`

Parse `<id>` as the second token. Everything after is the new plan_text.

Call: `brain_tasks { action: "edit_plan", id: "<id>", plan_text: "<new plan>" }`

Print: `Plan updated for <id>.`

### `status <id> <new_status>`

Validate `<new_status>` against: `pending | running | passed | failed | rolled_back | blocked | skipped | deleted`. Reject anything else.

Call: `brain_tasks { action: "update", id: "<id>", status: "<new_status>" }`

Print: `Status of <id>: <new_status>`.

### `delete <id>`

Use AskUserQuestion to confirm:
```
Soft-delete task <id>? (recoverable with /sf:tasks restore <id>)
  a) Yes, soft-delete
  b) Cancel
```

If user picks "Yes":
- Call: `brain_tasks { action: "soft_delete", id: "<id>" }`
- Push `"task:<id>:deleted"` to `artifacts`.
- Print: `Task <id> soft-deleted. Restore with: /sf:tasks restore <id>`.

If canceled: print `Canceled.`.

### `restore <id>`

Call: `brain_tasks { action: "restore", id: "<id>" }`

If the response includes `status: "restored"` → print `Task <id> restored to pending.`
Otherwise → print `Nothing to restore (task not in deleted state).`

### (empty or unknown subcommand)

Print usage:
```
Usage:
  /sf:tasks list [--all] [--phase P] [--status S]
  /sf:tasks show <id>
  /sf:tasks rename <id> <new description>
  /sf:tasks edit <id> <new plan text>
  /sf:tasks status <id> <pending|running|passed|failed|rolled_back|blocked|skipped|deleted>
  /sf:tasks delete <id>     (soft-delete; recoverable)
  /sf:tasks restore <id>
```

Treat as outcome='bailed' in the session finish below (nothing was done).

## Step N: Session finish

Determine outcome:
- If subcommand ran successfully → `outcome: "completed"`
- If subcommand was unknown or empty → `outcome: "bailed"`
- If user canceled a `delete` → `outcome: "bailed"`

Call: `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<outcome>", artifacts_written: <JSON stringified artifacts array> }`

</process>

<context>
$ARGUMENTS
</context>
