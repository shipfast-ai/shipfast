---
name: sf:milestone
description: "Complete current milestone or start a new one. Archives phases and tracks versions."
argument-hint: "complete | new <name>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - Skill
---

<objective>
Manage project milestones. Complete the current milestone (archive phases, tag release)
or start a new one (reset phases, increment version).
All state tracked in brain.db.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:milestone", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## If argument is "complete" — Archive Current Milestone

### Step 1: Check Completion

Query brain.db for project phase status:
```sql
SELECT * FROM context WHERE scope = 'project' AND key = 'phases'
```

Check that all phases are done. If pending phases remain:
```
Cannot complete milestone: [N] phases still pending.
  Phase 3: Webhook handling [IN PROGRESS]
  Phase 4: Admin dashboard [PENDING]

Complete remaining phases first, or use "complete --force" to archive as-is.
```

### Step 2: Check Requirement Coverage

Query brain.db for requirement status:
```sql
SELECT id, description, status, verified FROM requirements WHERE priority = 'v1'
```

Report:
```
Requirements: 10/12 v1 done (83%)
  Missing: PAY-03 (usage billing), UI-02 (settings page)
```

If below 80%, warn before completing.

### Step 3: Archive

1. Store milestone record in brain.db:
```
scope: 'milestone'
key: 'v1.0'
value: {
  name: "v1.0",
  completedAt: timestamp,
  phases: [phase summaries],
  requirements: { total, done, verified },
  commits: total commit count,
  decisions: [key decisions list]
}
```

2. Create git tag:
```bash
git tag -a v1.0 -m "Milestone v1.0 complete"
```

3. Report:
```
Milestone v1.0 complete!
========================
Phases: 5/5 done
Requirements: 10/12 v1 covered
Decisions: 8 recorded
Learnings: 12 captured

Tagged: v1.0
```

Use AskUserQuestion: "Milestone complete. Start next milestone?"
- Options: "Yes, start new milestone" / "No, done for now"
If yes → use the Skill tool with skill_name "sf:milestone" and argument "new [next version]".

---

## If argument is "new <name>" — Start New Milestone

### Step 1: Reset Phase Tracking

1. Archive current phases to milestone record (if not already archived)
2. Clear active phases in brain.db context
3. Move unfinished v1 requirements to v2 (carry forward)

### Step 2: Promote v2 Requirements

Query brain.db for v2 requirements:
```sql
SELECT id, description FROM requirements WHERE priority = 'v2'
```

Ask user: "Which v2 requirements should be promoted to v2 milestone?"
Present as checklist. Selected items become the new v1 requirements.

### Step 3: Initialize New Milestone

Store new milestone context:
```
scope: 'project'
key: 'milestone'
value: { name: "v2.0", startedAt: timestamp, status: "active" }
```

Report:
```
Milestone v2.0 started!
=======================
Carried forward: 2 unfinished requirements from v1
Promoted: 4 requirements from v2 backlog
Total v2 scope: 6 requirements

```

Use AskUserQuestion: "New milestone ready. What's next?"
- Options: "Decompose into phases (/sf-project)" / "Start working directly (/sf-do)" / "Stop here"
If decompose → use the Skill tool with skill_name "sf:project".
If start working → use the Skill tool with skill_name "sf:do".


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
