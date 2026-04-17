---
name: sf:status
description: "Show brain stats, tasks, and checkpoints."
allowed-tools:
  - Bash
---

## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:status", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.


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


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

