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
  - Skill
---

<objective>
Dedicated planning command. Produces a precise task list stored in brain.db.
Does NOT execute — that's /sf-do's job.

Separation matters: planning uses different context than execution.
Fresh context for each phase = no degradation.
</objective>

<process>

## Step 0: Session start

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:plan", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []`.

## Step 1: Analyze

Classify intent and complexity (same as /sf-do Step 1):
- fix/feature/refactor/test/ship/perf/security/style/data/remove
- trivial/medium/complex

If trivial: **do not silently bail**. Call `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "redirected", redirect_to: "sf:do", artifacts_written: "[]" }`, print:

```
Classified as trivial — /sf:plan is for non-trivial change tasks.
Use /sf-do for direct execution. Or /sf:investigate for read-only research.
```

…and stop. Every exit MUST call session finish.

## Step 2: Scout (fresh agent)

Launch sf-scout agent to research the task:
- Provide: task description + brain.db context (decisions, learnings, hot files)
- Scout returns structured findings: `[{topic, summary, body, citations: [{file, line_start, line_end, sha, hash}]}]`
- Scout tags findings with confidence: [VERIFIED], [CITED], [ASSUMED]
- Hash format: sha256 of `sed -n "<line_start>,<line_end>p" <file>`, truncated to 16 hex chars.

**Scout runs in its own agent = fresh context, no pollution.**

Wait for Scout to complete, then persist each finding for this branch so `/sf:do` can reuse them:

For each Scout finding, call:
`brain_findings { action: "add", branch: BRANCH, topic: <topic>, summary: <summary>, body: <body>, citations: <JSON string>, session_id: RUN_ID }`
Push the returned `id` onto `artifacts` as `"finding:<id>"`.

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

Push each `"task:<id>"` onto `artifacts`.

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
```

## Step 7: Ask to execute

After showing the plan, ask the user:

Use AskUserQuestion: "Plan ready with [N] tasks. Execute now?"
- Options: "Yes, execute" / "No, I'll review first"

If user says yes → call session finish below with `outcome: "completed"` AND `redirect_to: "sf:do"`, then use the Skill tool with skill_name "sf:do" to start execution.
If user says no → call session finish below with `outcome: "completed"`. User can run `/sf-do` manually later.

## Step 8: Session finish

Call: `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|redirected|bailed|errored>", redirect_to: "<target or empty>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path (including early bails, redirects, errors) MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
