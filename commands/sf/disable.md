---
name: sf:disable
description: "Disable auto-routing — plain prompts stop getting rewritten to /sf:do."
allowed-tools:
  - Bash
---

<objective>
Disable the ShipFast UserPromptSubmit auto-router by removing the flag file
that `hooks/sf-prompt-router.js` checks on every prompt. Once disabled,
prompts go to Claude Code untouched.

Re-enable any time with `/sf:enable`.
</objective>

<process>

## Step 0: Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:disable", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []`.

## Step 1: Remove the flag file

Run exactly:

```bash
rm -f ~/.shipfast/auto-route.enabled
```

If the command succeeds, print exactly:

```
Auto-route: DISABLED

Plain prompts now go straight to Claude Code untouched.
Re-enable: /sf:enable
```

## Step 2: Session finish (v1.9.0 — session finish)

Call: `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path MUST hit this call.

</process>

<context>
$ARGUMENTS
</context>
