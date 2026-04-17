---
name: sf:enable
description: "Enable auto-routing — every plain prompt in Claude Code gets routed through /sf:do."
allowed-tools:
  - Bash
---

<objective>
Enable the ShipFast UserPromptSubmit auto-router. Creates the flag file
that `hooks/sf-prompt-router.js` checks on every prompt. Once enabled, the
hook injects a directive steering the model toward `sf:do` instead of
editing directly.

Bypass rules stay in effect: messages starting with `/`, `!`, or `?`, or
shorter than 4 characters, pass through untouched.

Disable any time with `/sf:disable`.
</objective>

<process>

## Step 0: Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:enable", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []`.

## Step 1: Create the flag file

Run exactly:

```bash
mkdir -p ~/.shipfast && touch ~/.shipfast/auto-route.enabled
```

If the command succeeds, print exactly:

```
Auto-route: ENABLED

Every plain prompt will now route through /sf:do.
Bypass: /sf:…, !<raw>, ?<question>, or short messages (<4 chars).
Disable: /sf:disable
```

If the command fails, print the error and set session outcome to `errored`.

## Step 2: Session finish (v1.9.0 — session finish)

Call: `brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path MUST hit this call.

</process>

<context>
$ARGUMENTS
</context>
