---
name: sf:milestone
description: "Complete current milestone or start a new one. Archives phases and tracks versions."
argument-hint: "complete | new <name>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

<objective>
Manage project milestones. Complete the current milestone (archive phases, tag release)
or start a new one (reset phases, increment version).
All state tracked in brain.db — no markdown files.
</objective>

<process>

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
Run /sf-milestone new v2.0 to start next cycle.
```

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

Run /sf-project to decompose into phases, or /sf-do to start working.
```

</process>

<context>
$ARGUMENTS
</context>
