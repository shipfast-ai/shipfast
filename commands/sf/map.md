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

Use the `brain_search` MCP tool with: `{ "query": "kind:file", "limit": 50 }` — list all file nodes ordered by path.

## Symbol counts by kind

Use the `brain_search` MCP tool with: `{ "query": "group_by:kind" }` — get node counts grouped by kind.

## Top functions (most connected)

Use the `brain_search` MCP tool with: `{ "query": "kind:function order_by:connections", "limit": 15 }` — get functions with their connection counts.

## Hot files (most changed)

Use the `brain_hot_files` MCP tool with: `{ "limit": 15 }` — returns files ordered by change_count descending.

## Import graph (top connections)

Use the `brain_graph_cochanges` MCP tool with: `{ "kind": "imports", "limit": 20 }` — get top import edges between files.

## Co-change clusters

Use the `brain_graph_cochanges` MCP tool with: `{ "min_weight": 0.3, "limit": 15 }` — get co-change pairs with weight > 0.3 ordered by weight descending.

## Decisions made

Use the `brain_decisions` MCP tool with: `{ "action": "list", "limit": 10 }` — returns decisions ordered by created_at descending.

## Learnings

Use the `brain_learnings` MCP tool with: `{ "action": "list", "min_confidence": 0.3, "limit": 10 }` — returns learnings with confidence > 0.3 ordered by confidence descending.

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
