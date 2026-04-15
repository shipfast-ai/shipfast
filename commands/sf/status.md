---
name: sf:status
description: "Show brain stats, tasks, and checkpoints."
allowed-tools:
  - Bash
---

Run this EXACT command. Do NOT modify it. Do NOT run any other commands. Do NOT add insights or commentary.

```bash
sqlite3 .shipfast/brain.db "SELECT 'nodes' as k, COUNT(*) as v FROM nodes UNION ALL SELECT 'edges', COUNT(*) FROM edges UNION ALL SELECT 'decisions', COUNT(*) FROM decisions UNION ALL SELECT 'learnings', COUNT(*) FROM learnings UNION ALL SELECT 'tasks', COUNT(*) FROM tasks UNION ALL SELECT 'checkpoints', COUNT(*) FROM checkpoints UNION ALL SELECT 'hot_files', COUNT(*) FROM hot_files UNION ALL SELECT 'active', (SELECT COUNT(*) FROM tasks WHERE status IN ('running','pending')) UNION ALL SELECT 'passed', (SELECT COUNT(*) FROM tasks WHERE status='passed');" 2>/dev/null || echo "No brain.db found. Run: shipfast init"
```

Also get the version:
```bash
cat $(find ~/.claude/shipfast ~/.cursor/shipfast ~/.gemini/shipfast -name "package.json" 2>/dev/null | head -1) 2>/dev/null | grep version || echo "version unknown"
```

Then output EXACTLY this format using the numbers from above. Nothing else:

```
ShipFast [version]
===============
Brain: [nodes] nodes | [edges] edges | [decisions] decisions | [learnings] learnings | [hot_files] hot files
Tasks: [active] active | [passed] completed
Checkpoints: [checkpoints] available
```

STOP after printing this. No analysis. No suggestions. No insights. Just the status block.
