---
name: sf:cost
description: "Show token usage breakdown by agent, domain, and model."
allowed-tools:
  - Bash
---

<objective>
Analyze token spending to identify expensive patterns and optimize model selection.
</objective>

<process>

## Query token_usage and model_performance tables

### By agent
```sql
SELECT agent, SUM(input_tokens + output_tokens) as total_tokens, COUNT(*) as calls
FROM token_usage GROUP BY agent ORDER BY total_tokens DESC;
```

### By model
```sql
SELECT model, SUM(input_tokens + output_tokens) as total_tokens, COUNT(*) as calls
FROM token_usage WHERE model != '' GROUP BY model ORDER BY total_tokens DESC;
```

### By domain (from model_performance)
```sql
SELECT domain, COUNT(*) as tasks,
  SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END) as successes,
  SUM(CASE WHEN outcome='failure' THEN 1 ELSE 0 END) as failures
FROM model_performance WHERE domain != '' GROUP BY domain ORDER BY tasks DESC;
```

### Model success rates
```sql
SELECT agent, model, outcome, COUNT(*) as count
FROM model_performance GROUP BY agent, model, outcome ORDER BY agent, model;
```

### Budget status
```sql
SELECT value FROM config WHERE key = 'token_budget';
```
```sql
SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as used FROM token_usage;
```

## Format report

```
Token Cost Analysis
===================

Budget: [used]/[total] ([pct]%)

By Agent:
  builder   [tokens] tokens  ([calls] calls)
  scout     [tokens] tokens  ([calls] calls)
  architect [tokens] tokens  ([calls] calls)
  critic    [tokens] tokens  ([calls] calls)
  scribe    [tokens] tokens  ([calls] calls)

By Model:
  sonnet  [tokens] tokens  ([calls] calls)
  haiku   [tokens] tokens  ([calls] calls)
  opus    [tokens] tokens  ([calls] calls)

By Domain:
  auth      [tasks] tasks  [successes]✓ [failures]✗
  database  [tasks] tasks  [successes]✓ [failures]✗

Model Success Rates:
  builder/haiku:   [success]/[total] ([pct]%)
  builder/sonnet:  [success]/[total] ([pct]%)
```

</process>

<context>
$ARGUMENTS
</context>
