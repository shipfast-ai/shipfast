---
name: sf:verify
description: "Verify completed work against must-haves. Checks artifacts, data flow, stubs, build, consumers."
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<objective>
Dedicated verification command. Runs AFTER /sf-do completes.
Checks the codebase delivers what was planned — not just "tests pass".

Separation matters: verification needs fresh context to see the code objectively,
without the biases accumulated during execution.
</objective>

<process>

## Step 1: Load must-haves from brain.db

```bash
sqlite3 -json .shipfast/brain.db "SELECT value FROM context WHERE key LIKE 'must_haves:%' ORDER BY updated_at DESC LIMIT 1;" 2>/dev/null
```

If no must-haves stored, extract from the task descriptions:
```bash
sqlite3 -json .shipfast/brain.db "SELECT description FROM tasks WHERE status = 'passed' ORDER BY created_at;" 2>/dev/null
```

## Step 2: Check observable truths

For each truth in must-haves, verify:
- Does the code actually implement this?
- Grep for the function/component/route that delivers it
- Is it wired (imported and used), not just existing?

Score: VERIFIED / FAILED / NEEDS_HUMAN

## Step 3: 3-Level artifact validation

For each artifact in must-haves:

**Level 1 — Exists**: `[ -f path ] && echo OK || echo MISSING`
**Level 2 — Substantive**: File has >3 non-comment lines (not empty/stub)
**Level 3 — Wired**: `grep -r "basename" --include="*.ts" .` shows imports from other files

Score per artifact: L1/L2/L3 or MISSING

## Step 4: Data flow check

For new components/APIs, check they receive real data:
- Not hardcoded empty arrays: `grep "data: \[\]" [file]`
- Not returning null: `grep "return null" [file]`
- Not empty handlers: `grep "() => {}" [file]`
- Fetch calls have response handling

## Step 5: Stub detection (deep)

Scan all files changed in this session:
```bash
git diff --name-only HEAD~[N commits]
```

Check each for:
- TODO, FIXME, HACK, "not implemented", "placeholder"
- Empty click/submit handlers
- console.log debug statements
- debugger statements
- Commented-out code blocks

## Step 6: Build verification

```bash
npm run build 2>&1 | tail -5
# or: tsc --noEmit
# or: cargo check
```

## Step 7: Consumer integrity

For every function/type/export that was modified or removed:
```bash
grep -r "removed_function_name" --include="*.ts" --include="*.tsx" .
```
Any remaining consumers = CRITICAL failure.

## Step 8: Score and report

```
Verification Results
====================

Truths: [N]/[M] verified
Artifacts: [N]/[M] at Level 3 (wired)
Data flow: [PASS/ISSUES]
Stubs: [N] found
Build: [PASS/FAIL]
Consumers: [CLEAN/BROKEN]

Verdict: PASS | PASS_WITH_WARNINGS | FAIL

[If FAIL:]
Failed items:
  - [truth/artifact]: [what's wrong]
  - [truth/artifact]: [what's wrong]

Fix with: /sf-do [fix description]
```

## Step 9: Store results

```bash
sqlite3 .shipfast/brain.db "INSERT OR REPLACE INTO context (id, scope, key, value, version, updated_at) VALUES ('verify:latest', 'session', 'verification', '[JSON results]', 1, strftime('%s', 'now'));"
```

## Step 10: Interactive UAT (if complex)

For complex features, offer manual testing:
```
Manual checks (answer pass/issue/skip):

Test 1: [what to test]
  Expected: [behavior]
  Result?

Test 2: [what to test]
  Expected: [behavior]
  Result?
```

For each issue reported, generate a fix task and store in brain.db.

</process>

<context>
$ARGUMENTS
</context>
