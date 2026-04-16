---
name: sf:status
description: "Show brain stats, tasks, and checkpoints."
allowed-tools:
  - Bash
---

Run these EXACT commands. Do NOT modify them. Do NOT add insights or commentary.

Use the `brain_status` MCP tool (no parameters needed) — returns counts for nodes, edges, decisions, learnings, tasks, checkpoints, hot_files, active tasks, and passed tasks. If brain.db is not found, output: `No brain.db found. Run: shipfast init`

```bash
cat ~/.claude/shipfast/version 2>/dev/null || cat ~/.cursor/shipfast/version 2>/dev/null || cat ~/.gemini/shipfast/version 2>/dev/null || echo "unknown"
```

Then output EXACTLY this format. Nothing else:

```
ShipFast v[version]
===============
Brain: [nodes] nodes | [edges] edges | [decisions] decisions | [learnings] learnings | [hot_files] hot files
Tasks: [active] active | [passed] completed
Checkpoints: [checkpoints] available
```

STOP after printing this. No analysis. No suggestions. No insights.
