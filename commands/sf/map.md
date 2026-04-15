---
name: sf:map
description: "Generate human-readable codebase report from brain.db. Shows architecture, structure, hot files, conventions."
allowed-tools:
  - Bash
---

<objective>
Generate a readable codebase summary from brain.db data.
Unlike GSD's 7 markdown mapper agents, this queries the existing SQLite brain directly — zero LLM tokens for data retrieval.
</objective>

<process>

Run these queries and format the output. Do NOT modify the queries.

## File structure
```bash
sqlite3 .shipfast/brain.db "SELECT file_path FROM nodes WHERE kind = 'file' ORDER BY file_path;" 2>/dev/null | head -50
```

## Symbol counts by kind
```bash
sqlite3 .shipfast/brain.db "SELECT kind, COUNT(*) as count FROM nodes GROUP BY kind ORDER BY count DESC;" 2>/dev/null
```

## Top functions (most connected)
```bash
sqlite3 .shipfast/brain.db "SELECT n.name, n.file_path, n.signature, COUNT(e.target) as connections FROM nodes n LEFT JOIN edges e ON n.id = e.source WHERE n.kind = 'function' GROUP BY n.id ORDER BY connections DESC LIMIT 15;" 2>/dev/null
```

## Hot files (most changed)
```bash
sqlite3 .shipfast/brain.db "SELECT file_path, change_count FROM hot_files ORDER BY change_count DESC LIMIT 15;" 2>/dev/null
```

## Import graph (top connections)
```bash
sqlite3 .shipfast/brain.db "SELECT REPLACE(source,'file:','') as from_file, REPLACE(target,'file:','') as to_file, kind FROM edges WHERE kind = 'imports' LIMIT 20;" 2>/dev/null
```

## Co-change clusters
```bash
sqlite3 .shipfast/brain.db "SELECT REPLACE(source,'file:','') as file_a, REPLACE(target,'file:','') as file_b, weight FROM edges WHERE kind = 'co_changes' AND weight > 0.3 ORDER BY weight DESC LIMIT 15;" 2>/dev/null
```

## Decisions made
```bash
sqlite3 .shipfast/brain.db "SELECT question, decision, phase FROM decisions ORDER BY created_at DESC LIMIT 10;" 2>/dev/null
```

## Learnings
```bash
sqlite3 .shipfast/brain.db "SELECT pattern, problem, solution, confidence FROM learnings WHERE confidence > 0.3 ORDER BY confidence DESC LIMIT 10;" 2>/dev/null
```

Format as:

```
Codebase Map
============

Structure: [N] files | [N] functions | [N] types | [N] components

Top Functions (most connected):
  [name] in [file] — [connections] deps

Hot Files (most changed):
  [file] — [N] changes

Co-Change Clusters (files that change together):
  [file_a] ↔ [file_b] ([weight])

Decisions: [N] recorded
Learnings: [N] stored ([N] high confidence)
```

STOP after output. No analysis.

</process>

<context>
$ARGUMENTS
</context>
