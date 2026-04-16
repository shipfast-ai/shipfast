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

## Assumptions Mode (when `--assume` flag is set)

Instead of asking questions, auto-resolve ambiguities using codebase patterns:

1. For each detected ambiguity, query brain.db for matching patterns:
   - **WHERE**: Search nodes table for files matching task keywords
   - **HOW**: Reuse past HOW decisions or domain learnings
   - **WHAT**: Infer from task description
   - **RISK**: Auto-confirm if `.env.local` or `.env.development` exists
   - **SCOPE**: Default to "tackle all at once" for medium complexity

2. Each auto-resolution has a confidence score (0-1):
   - Confidence >= 0.5: Accept and lock as decision
   - Confidence < 0.5: Fall back to asking the user

3. Present assumptions to user before proceeding:
```
Assuming (based on codebase patterns):
  WHERE: src/auth/login.ts, src/auth/session.ts (confidence: 0.8)
  HOW: Follow existing pattern: jwt-auth (confidence: 0.7)
  RISK: Confirmed — development environment detected (confidence: 0.7)

Say 'no' to override any of these, or press Enter to continue.
```

4. Lock accepted assumptions as decisions in brain.db.

</process>

<context>
$ARGUMENTS
</context>
