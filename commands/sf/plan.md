---
name: sf:plan
description: "Research and plan a phase. Scout gathers findings, Architect creates task list. Stores tasks in brain.db."
argument-hint: "<describe what to build>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<objective>
Dedicated planning command. Produces a precise task list stored in brain.db.
Does NOT execute — that's /sf-do's job.

Separation matters: planning uses different context than execution.
Fresh context for each phase = no degradation.
</objective>

<process>

## Step 1: Analyze

Classify intent and complexity (same as /sf-do Step 1):
- fix/feature/refactor/test/ship/perf/security/style/data/remove
- trivial/medium/complex

If trivial: skip planning. Tell user to run `/sf-do` directly.

## Step 2: Scout (fresh agent)

Launch sf-scout agent to research the task:
- Provide: task description + brain.db context (decisions, learnings, hot files)
- Scout returns: files, functions, consumers, conventions, risks, recommendation
- Scout tags findings with confidence: [VERIFIED], [CITED], [ASSUMED]

**Scout runs in its own agent = fresh context, no pollution.**

Wait for Scout to complete before proceeding.

## Step 3: Discuss (if complex or ambiguous)

Check for ambiguity (rule-based, zero tokens):
- WHERE: no file paths mentioned
- WHAT: no behavior described
- HOW: multiple approaches possible
- RISK: touches auth/payment/data
- SCOPE: >30 words with conjunctions

If ambiguous: ask 2-5 targeted questions. Store answers as locked decisions in brain.db:

Use the `brain_decisions` MCP tool with: `{ "action": "add", "question": "[Q]", "decision": "[A]", "reasoning": "[why]", "phase": "[phase]" }`

## Step 4: Architect (fresh agent)

Launch sf-architect agent to create task list:
- Provide: task description + Scout findings + locked decisions from brain.db
- Architect returns: must-haves (truths/artifacts/links) + ordered task list

**Architect runs in its own agent = fresh context, no pollution.**

Architect's output must include for EACH task:
- Exact file paths
- Consumer list (who uses what's being changed)
- Specific action instructions
- Verify command
- Measurable done criteria

## Step 5: Store tasks in brain.db

For each task from Architect, store in brain.db:

Use the `brain_tasks` MCP tool with: `{ "action": "add", "id": "[id]", "phase": "[phase]", "description": "[description]", "plan_text": "[full task details]", "status": "pending" }`

Also store must-haves:

Use the `brain_context` MCP tool with: `{ "action": "set", "id": "phase:[name]:must_haves", "scope": "phase", "key": "must_haves:[name]", "value": "[JSON must-haves]" }`

## Step 6: Report

```
Plan ready: [N] tasks stored in brain.db

Must-haves:
  Truths: [list]
  Artifacts: [list]
  Key links: [list]

Tasks:
  1. [description] — [files] — [size]
  2. [description] — [files] — [size]
  ...

Run /sf-do to execute. Tasks will run with fresh context per task.
```

</process>

<context>
$ARGUMENTS
</context>
