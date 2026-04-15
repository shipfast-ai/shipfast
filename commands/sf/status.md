---
name: sf:status
description: "Show current progress, token usage, and brain stats."
allowed-tools:
  - Read
  - Bash
---

<objective>
Display the current ShipFast session status: tasks in progress, token budget usage,
brain.db stats, and recent activity.
</objective>

<process>

## Gather Status

1. **Token Budget**: Query brain.db for token usage this session
2. **Active Tasks**: Query brain.db for tasks with status 'running' or 'pending'
3. **Recent Completions**: Last 5 completed tasks
4. **Brain Stats**: Count of nodes, edges, decisions, learnings
5. **Checkpoints**: List available rollback points

## Display

```
ShipFast Status
===============

Token Budget: [used]/[budget] ([pct]%)  [status bar]
Session: [session_id]

Active Tasks:
  [task_id] [status] [description]

Recent:
  [task_id] passed [description] ([commit_sha])

Brain: [N] files indexed | [N] symbols | [N] decisions | [N] learnings

Checkpoints: [N] available (/undo to rollback)
```

</process>
