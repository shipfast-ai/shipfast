---
name: sf:status
description: "Show current progress, token usage, and brain stats."
allowed-tools:
  - Bash
---

<objective>
Display ShipFast status. Run these exact queries — do NOT modify them.
</objective>

<process>

Run this single command to gather all stats:

```bash
sqlite3 .shipfast/brain.db "
SELECT 'nodes', COUNT(*) FROM nodes
UNION ALL SELECT 'edges', COUNT(*) FROM edges
UNION ALL SELECT 'decisions', COUNT(*) FROM decisions
UNION ALL SELECT 'learnings', COUNT(*) FROM learnings
UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL SELECT 'checkpoints', COUNT(*) FROM checkpoints
UNION ALL SELECT 'hot_files', COUNT(*) FROM hot_files;
" 2>/dev/null || echo "brain.db not found — run shipfast init"
```

Then run these for active/recent tasks:

```bash
sqlite3 .shipfast/brain.db "SELECT id, status, description FROM tasks WHERE status IN ('running','pending') ORDER BY created_at DESC LIMIT 5;" 2>/dev/null
sqlite3 .shipfast/brain.db "SELECT id, status, description, commit_sha FROM tasks WHERE status = 'passed' ORDER BY finished_at DESC LIMIT 5;" 2>/dev/null
sqlite3 .shipfast/brain.db "SELECT id, description FROM checkpoints ORDER BY created_at DESC LIMIT 5;" 2>/dev/null
```

Format the output as:

```
ShipFast Status
===============

Brain:
  [N] nodes | [N] edges | [N] decisions | [N] learnings | [N] hot files

Active Tasks: [list or "none"]
Recent: [list or "none"]
Checkpoints: [N] available
```

Keep the output short. No extra commentary unless the brain is empty.

</process>
