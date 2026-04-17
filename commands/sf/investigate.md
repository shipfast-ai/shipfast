---
name: sf:investigate
description: "Scout-only research with per-citation validation. Stores findings per-branch so /sf:do can reuse them without re-Scouting."
argument-hint: "<what to investigate>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<objective>
Dedicated read-only investigation command. Produces structured, cited findings
stored in brain.db (table: findings), keyed by the current git branch.

Does NOT execute changes — that's /sf-do's job.
Does NOT plan — that's /sf-plan's job.

`/sf:do` on the same branch will call `brain_findings { action: list_fresh }`
to reuse these findings. Citations pointing at unchanged code remain valid;
changed code invalidates individual citations, enabling partial reuse.
</objective>

<process>

## Step 0: Session start

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:investigate", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []`.

## Step 1: Launch Scout (fresh agent)

Launch sf-scout agent with the investigation topic from `$ARGUMENTS`.

Scout MUST return findings as a JSON array. Each finding has this shape:

```json
{
  "topic": "flow-map | consumers | risks | config | key-fns | ...",
  "summary": "one-line headline",
  "body": "markdown details",
  "citations": [
    {
      "file": "path/relative/to/repo.ts",
      "line_start": 42,
      "line_end": 68,
      "sha": "<current HEAD sha>",
      "hash": "<sha256 of lines[line_start..line_end], truncated to 16 hex chars>"
    }
  ]
}
```

Citations are how `/sf:do` decides whether findings are still fresh. Scout must include at least one citation per finding.

Hash is computed as:
```bash
sed -n "<line_start>,<line_end>p" <file> | shasum -a 256 | cut -c1-16
```

## Step 2: Supersede prior findings for this branch

Before storing new findings, mark any prior findings on the same branch as stale:

Call: `brain_findings { action: "clear_branch", branch: BRANCH }`

This is a soft operation — old rows stay in the DB with `status='stale'` for audit. They no longer appear in `list_fresh`.

## Step 3: Persist each new finding

For each Scout finding, call:

`brain_findings { action: "add", branch: BRANCH, topic: <topic>, summary: <summary>, body: <body>, citations: <JSON stringified citations array>, session_id: RUN_ID }`

Push the returned `id` onto `artifacts`.

## Step 4: Report

Print a compact summary:

```
Investigated: <topic from $ARGUMENTS>
Branch:       <BRANCH>
Findings:     <N> stored

Topics covered:
  - <topic1>: <summary1>
  - <topic2>: <summary2>
  ...

Next: /sf:do on this branch will reuse these findings until the cited
files/lines change. Citation-based validation — partial changes cause
partial re-Scout, not full invalidation.
```

## Step 5: Session finish

Call: `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "completed", artifacts_written: <JSON stringified artifacts array> }`

</process>

<context>
$ARGUMENTS
</context>
