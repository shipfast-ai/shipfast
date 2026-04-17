---
name: sf:brain
description: "Query the knowledge graph directly."
argument-hint: "<query>"
allowed-tools:
  - Read
  - Bash
---

<objective>
Direct interface to brain.db for querying the codebase knowledge graph,
decisions, learnings, and task history.

This is the CANONICAL reference for brain.db queries. Other commands that need
brain data should use MCP tools (brain_decisions, brain_learnings, brain_search, etc.)
or reference the SQL patterns below — do not invent new queries.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:brain", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## Parse Query Type

Detect what the user wants from their natural language query:

### "files like X" or "find X"
```sql
SELECT file_path, name, kind, signature FROM nodes
WHERE name LIKE '%X%' OR file_path LIKE '%X%'
ORDER BY kind, name LIMIT 20
```

### "what calls X" or "who uses X"
```sql
SELECT n.file_path, n.name, e.kind FROM edges e
JOIN nodes n ON e.source = n.id
WHERE e.target LIKE '%X%'
ORDER BY e.kind LIMIT 20
```

### "decisions" or "what was decided"
```sql
SELECT question, decision, phase FROM decisions ORDER BY created_at DESC LIMIT 10
```

### "learnings" or "what did we learn"
```sql
SELECT pattern, problem, solution, confidence FROM learnings
WHERE confidence > 0.3 ORDER BY confidence DESC LIMIT 10
```

### "hot files" or "most changed"
```sql
SELECT file_path, change_count FROM hot_files ORDER BY change_count DESC LIMIT 15
```

### "seeds" or "ideas" or "future work"
```sql
SELECT id, idea, source_task, domain, priority, status FROM seeds
WHERE status = 'open'
ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'next' THEN 1 ELSE 2 END, created_at DESC
LIMIT 20
```

### "stats"
Show counts: nodes, edges, decisions, learnings, tasks, checkpoints

### Raw SQL (starts with SELECT/INSERT/UPDATE)
Execute directly against brain.db (read-only unless explicitly UPDATE).

## Display Results

Format as a clean table or list. Keep output under 50 lines.


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
