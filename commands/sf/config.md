---
name: sf:config
description: "Set model tiers and preferences."
argument-hint: "<key> <value>"
allowed-tools:
  - Read
  - Bash
---

<objective>
View or modify ShipFast configuration stored in brain.db.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:config", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## If no arguments: show current config

Query brain.db config table and display:

```
ShipFast Configuration
======================

Auto Checkpoint:  [true/false]
Auto Learn:       [true/false]

Model Tiers:
  Scout:     [haiku/sonnet/opus]
  Architect: [haiku/sonnet/opus]
  Builder:   [haiku/sonnet/opus]
  Critic:    [haiku/sonnet/opus]
  Scribe:    [haiku/sonnet/opus]
```

## If arguments provided: update config

Parse `key value` from arguments. Valid keys:
- `model-scout` -> `model_tier_scout`
- `model-architect` -> `model_tier_architect`
- `model-builder` -> `model_tier_builder`
- `model-critic` -> `model_tier_critic`
- `model-scribe` -> `model_tier_scribe`
- `auto-checkpoint` -> `auto_checkpoint` (true/false)
- `auto-learn` -> `auto_learn` (true/false)
- `post-ship-hook` -> `post_ship_hook` (shell command to run after /sf-ship)

Update brain.db config table. Confirm the change:

```
Updated: [key] = [value]
```


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
