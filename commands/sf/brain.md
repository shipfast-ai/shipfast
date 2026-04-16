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

</process>

<context>
$ARGUMENTS
</context>
