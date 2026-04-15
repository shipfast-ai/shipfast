---
name: sf:config
description: "Set token budget, model tiers, and preferences."
argument-hint: "<key> <value>"
allowed-tools:
  - Read
  - Bash
---

<objective>
View or modify ShipFast configuration stored in brain.db.
</objective>

<process>

## If no arguments: show current config

Query brain.db config table and display:

```
ShipFast Configuration
======================

Token Budget:     [value]
Auto Checkpoint:  [true/false]
Auto Learn:       [true/false]

Model Tiers:
  Scout:     [haiku/sonnet/opus]
  Architect: [haiku/sonnet/opus]
  Builder:   [haiku/sonnet/opus]
  Critic:    [haiku/sonnet/opus]
  Scribe:    [haiku/sonnet/opus]

Context Warnings:
  Warning at:  [pct]%
  Critical at: [pct]%
```

## If arguments provided: update config

Parse `key value` from arguments. Valid keys:
- `token-budget` or `budget` -> config key `token_budget`
- `model-scout` -> `model_tier_scout`
- `model-architect` -> `model_tier_architect`
- `model-builder` -> `model_tier_builder`
- `model-critic` -> `model_tier_critic`
- `model-scribe` -> `model_tier_scribe`
- `auto-checkpoint` -> `auto_checkpoint` (true/false)
- `auto-learn` -> `auto_learn` (true/false)

Update brain.db config table. Confirm the change:

```
Updated: [key] = [value]
```

</process>

<context>
$ARGUMENTS
</context>
