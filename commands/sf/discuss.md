---
name: sf:discuss
description: "Detect ambiguity and ask targeted questions before planning. Stores answers as locked decisions."
argument-hint: "<task description>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Smart questioning system that detects ambiguity BEFORE planning.
Prevents wasting tokens on plans built from wrong assumptions.

Only asks questions for detected ambiguity types:
- WHERE: unclear which files/components to change
- WHAT: unclear expected behavior
- HOW: multiple valid approaches
- RISK: touches sensitive areas (auth/payment/data)
- SCOPE: request covers multiple features
</objective>

<process>

## Step 1: Detect Ambiguity (zero tokens — rule-based)

Analyze the user's input for ambiguity patterns:

**WHERE** — No file paths, component names, or locations mentioned
**WHAT** — No specific behavior/output described, request is very short
**HOW** — Contains "or", "either", "maybe", or describes a generic feature (auth, cache, search)
**RISK** — Mentions auth, payment, database, delete, production, deploy
**SCOPE** — More than 30 words with 2+ conjunctions (and, also, plus)

## Step 2: Check Locked Decisions

Query brain.db for existing decisions tagged with detected ambiguity types.
Skip any ambiguity that was already resolved in a previous session.

## Step 3: Generate Questions

For each remaining ambiguity, ask a targeted question:

**Multiple choice** (when possible — saves user effort):
```
How should authentication work?
  a) JWT tokens (stateless, good for APIs)
  b) Session cookies (stateful, good for web apps)
  c) OAuth (delegate to Google/GitHub)
  d) Other (describe)
```

**Confirmation** (for RISK):
```
This will modify the payment processing flow. Confirm:
  - Are you working in a development environment?
  - Should existing billing data be preserved?
```

**Free text** (only when choices aren't possible):
```
Where should the new component be placed?
(Hint: mention a directory or existing component to place it near)
```

## Step 4: Lock Decisions

After each answer, store in brain.db as a locked decision:
```
Question: "Auth approach?"
Decision: "JWT tokens — stateless"
Tags: "HOW"
Phase: current phase/task
```

These decisions are:
- Injected into all downstream agent contexts
- Never asked again (even across sessions)
- Visible via `/sf-brain decisions`

## Step 5: Report

```
Resolved [N] ambiguities:
  WHERE: [answer summary]
  HOW: [answer summary]
  RISK: [confirmed]

Ready for planning. Run /sf-do to continue.
```

If `--auto` flag was passed, auto-select recommended defaults instead of asking.

</process>

<context>
$ARGUMENTS
</context>
