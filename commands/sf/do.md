---
name: sf:do
description: "The one command. Analyzes intent, selects workflow, executes autonomously with full pipeline."
argument-hint: "<describe what you want to do>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

<objective>
ShipFast's single entry point. Replaces GSD's 50+ commands with ONE natural language interface.
Runs a 9-step pipeline that adapts based on task complexity.
Every step is skippable — trivial tasks burn 3K tokens, complex tasks burn 30K.
</objective>

<pipeline>

## STEP -1: Session start (v1.9.0)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:do", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []`. Fill `classification` with `{intent, complexity}` after STEP 1.

Every exit path below — success, bail, redirect, error — MUST call `brain_sessions { action: "finish", run_id: RUN_ID, outcome: <outcome>, artifacts_written: <JSON array> }` as its last action. See "SESSION FINISH" block at the end of this pipeline.

## STEP 0: PARSE FLAGS (0 LLM tokens — string matching)

Extract flags from `$ARGUMENTS` before processing. Flags start with `--` and are composable.

**Supported flags:**
- `--discuss` — Force discuss step (Step 3) even for trivial tasks
- `--research` — Force Scout agent to run (override skip-scout heuristics)
- `--verify` — Force full verification (Step 7) even for trivial tasks
- `--tdd` — Enable TDD mode: Builder writes failing test first, verification checks commit sequence
- `--no-plan` — Skip discuss (Step 3) and plan (Step 4), go straight to execute
- `--cheap` — Force ALL agents to use haiku (fastest, cheapest, ~80% cost reduction)
- `--quality` — Force builder/architect to sonnet, architect to opus for complex tasks
- `--batch` — Batch all discussion questions into 1-2 AskUserQuestion calls
- `--chain` — After each step, auto-run the next (discuss → plan → check → execute)

**Flag precedence** (highest wins): `--no-plan` > `--discuss` > `--cheap/--quality` > `--tdd/--research/--verify` > `--batch/--chain`

**Parse procedure:**
1. Extract all `--flag` tokens from the input
2. Remove them from the task description (remaining text = task)
3. Store flags as a set for downstream steps to check

Example: `/sf-do --tdd --research add user avatars`
→ flags: `{tdd, research}`, task: `add user avatars`

If no flags provided, all steps use their default heuristic-based behavior.

---

## STEP 1: ANALYZE (0 LLM tokens — rule-based)

Classify the user's input using these heuristics:

**Intent** (regex pattern matching):
- fix/bug/broken/error/crash → `fix`
- add/create/build/implement/new → `feature`
- refactor/clean/simplify/extract → `refactor`
- update/upgrade/migrate/bump → `upgrade`
- test/spec/coverage → `test`
- deploy/ship/release/push/pr → `ship`
- optimize/performance/speed/cache → `perf`
- security/auth/permission/sanitize → `security`
- style/css/theme/layout/UI → `style`
- database/migration/schema/query → `data`
- remove/delete/drop → `remove`
- review/check/audit → `review`

**Complexity** (word count + conjunction count + area count):
- Score 0-2 → `trivial` (direct execute, no planning)
- Score 3-5 → `medium` (quick plan + execute + review)
- Score 6+ → `complex` (full pipeline)

**Report to user** (one line):
```
[intent] | [complexity] | [workflow] | Est: [token range]
```

---

## STEP 1.5: OPTIMIZE PIPELINE (0 tokens — brain.db queries only)

Call `applyGuardrails()` from `core/guardrails.cjs` to optimize the entire pipeline in one shot.

**Input**: Build a task object from Step 1's analysis:
```javascript
task = { intent, complexity, domain, affectedFiles, areas, input: taskDescription }
```

**What applyGuardrails() does** (already implemented):
1. **Skip logic** — Decides which agents to skip based on brain.db knowledge
2. **Learning acceleration** — If 3+ high-confidence learnings exist, skip scout+architect+critic
3. **Budget adjustment** — If budget low (<60%), downgrade models; if critical (<20%), builder-only + haiku
4. **Model selection** — Dynamic per-agent model based on task characteristics:
   - Builder → haiku when domain has 2+ high-confidence learnings, or trivial single-file fix
   - Architect → opus for complex multi-area tasks with no prior patterns
   - Critic → sonnet for security/auth tasks
5. **Predictive context** — Pre-loads co-change file signatures into context

**Output**: `{ pipeline, models, outputLevel, predictedContext, acceleration, budgetNotes }`

**Report model plan to user** (for medium/complex tasks):
```
Models: Scout=haiku, Architect=sonnet, Builder=sonnet, Critic=haiku
Pipeline: scout → architect → builder → critic (acceleration: partial, 35% cheaper)
```

**Flag overrides for model selection:**
- If `--cheap` flag: Override ALL models to `haiku` regardless of guardrails output
- If `--quality` flag: Override `builder` to `sonnet`, `architect` to `opus` (for complex) or `sonnet` (for medium)

**Use the output for ALL downstream steps:**
- Steps 3-4: Use `pipeline` to decide which agents run (replaces scattered skip-if checks)
- Step 6: Use `models[agent]` when spawning each agent
- Step 9: Use `outputLevel` for report format

---

## STEP 2: CONTEXT GATHERING (0 tokens)

**Branch detection (v1.9.0)** — Run once, reuse across steps:
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

**Git diff awareness** — Run `git diff --name-only HEAD` to see what files changed since last commit. Pass this list to Scout so it focuses on recent changes instead of searching blindly.

**Cached findings lookup (v1.9.0)** — Before deciding whether to run Scout, query cached findings for the current branch:

`brain_findings { action: "list_fresh", branch: BRANCH }`

The MCP tool verifies each finding's citations against current file contents and returns only findings whose citations still resolve (status `fresh` or `partial`). Store the returned array as `FRESH_FINDINGS`.

- If `FRESH_FINDINGS` is non-empty and the task intent matches the cached topics, Scout can be skipped — pass the findings straight to Architect.
- If entries have `status: "partial"`, Scout can still run but should be given the valid findings as prior context so it focuses on the regions whose citations went stale.

See STEP 4 "Skip Scout if" for the full skip logic.

If `.shipfast/brain.db` does not exist, tell user to run `shipfast init` first.

**Fresh project detection**: Check if brain.db has any decisions:
`brain_decisions: { action: list }`
If zero decisions AND the task is complex (not a simple fix):
- This is a fresh project — run 1 quick discovery round before planning
- Ask 2-4 questions about: PROBLEM (what does this solve?), USERS (who uses it?), BOUNDARIES (what's v1?), TECH (if no existing code detected)
- Store answers as locked decisions. Then continue with normal pipeline.
- This prevents building on wrong assumptions for fresh projects.

**Crash recovery**: Check for stale lock file:
```bash
[ -f .shipfast/lock ] && cat .shipfast/lock
```
If `.shipfast/lock` exists and is older than 30 minutes:
- Previous session was interrupted
- Read lock to find which task was in progress
- Check brain.db for task statuses: brain_tasks: { action: list }
- Report: "Recovered from interrupted session. [N]/[M] tasks completed. Resuming from task [N+1]."
- Continue with pending tasks (skip already-passed ones)
- Delete the stale lock file

**Store the changed files list** — use it in Step 4 (Scout) and Step 6 (Builder) for targeted context.

---

## STEP 3: DISCUSS (0-3K tokens) — Complex or ambiguous tasks only

**Skip if**: `--no-plan` flag is set, OR (trivial tasks AND `--discuss` flag is NOT set), OR all ambiguity types already have locked decisions in brain.db.
**Force if**: `--discuss` flag is set, regardless of complexity.

**Detect ambiguity** (zero tokens — rule-based):
- **WHERE**: No file paths or component names mentioned
- **WHAT**: No specific behavior described, very short input
- **HOW**: Contains "or"/"either"/"maybe", or describes a generic system (auth, cache, billing)
- **RISK**: Mentions auth/payment/database/delete/production
- **SCOPE**: More than 30 words with 2+ conjunctions

**For each detected ambiguity**:
1. Check brain.db for existing locked decisions
2. If `--discuss` flag is set explicitly, ask the user interactively
3. For medium tasks (auto-triggered discuss), use assumptions mode: auto-resolve using brain.db patterns, present assumptions, fall back to asking only if confidence < 0.5
4. Store answer as locked decision in brain.db (never asked again)

---

## STEP 4: PLAN (0-5K tokens) — Medium/complex only

**Skip if**: `--no-plan` flag is set (go directly to Step 6), OR trivial tasks (go directly to Step 6)

**Get plan template** based on intent:
- `fix` → locate, diagnose, fix, verify
- `feature` → interface, implement, integrate, test
- `refactor` → identify, extract, update callers, verify
- etc. (14 templates pre-computed in core/templates.cjs)

**Skip Scout if** (`--research` flag overrides — if set, Scout always runs):
- **Cached findings cover the task (v1.9.0)**: `FRESH_FINDINGS` from Step 2 is non-empty AND the returned topics match the task intent (e.g. intent=feature and we have `flow-map` + `consumers`). Pass `FRESH_FINDINGS` straight to Architect. Print: `Scout skipped — reusing N cached findings from /sf:investigate or a prior /sf:plan on branch <BRANCH>.`
- All affected files already indexed in brain.db AND we have high-confidence learnings for this domain AND intent is `fix` with explicit file paths

**Partial cache (v1.9.0)**: If `FRESH_FINDINGS` has entries with `status: "partial"`, Scout runs but receives the valid findings as prior context. Print: `Scout augmenting N partially-stale findings — only re-checking changed regions.`

**Skip Architect if**:
- Single-file change
- Intent is fix/remove/docs/style
- Task description is under 15 words

**If Scout runs**: Launch Scout agent with brain context and `model: models.scout` from Step 1.5. Get compact findings (~3K tokens max).

**If Architect runs**: Launch Architect agent with Scout findings + template and `model: models.architect` from Step 1.5. Get task list (~3K tokens max).
- Architect uses goal-backward methodology: define "done" first, derive tasks from that
- Maximum 6 tasks. Each with specific file paths and verify steps.
- Flag scope creep and irreversible operations.

**Store tasks in brain.db** for tracking.

---

## STEP 5: CHECKPOINT (0 tokens)

**Skip if**: trivial tasks

Before execution:
1. Create git stash checkpoint: `git stash create`
2. Save pre-execution state to brain.db
3. This enables /sf-undo rollback if things go wrong

---

## STEP 6: EXECUTE (2-30K tokens)

**Create lock file** before starting execution:
```bash
echo '{"task":"[current_task_id]","started":'$(date +%s)'}' > .shipfast/lock
```

**CRITICAL RULE FOR ALL WORKFLOWS:**
Before removing, deleting, or modifying any function/type/selector/export/component:
1. `grep -r "name" --include="*.ts" --include="*.tsx" .` to find ALL consumers
2. If other files use it, update them or keep it
3. NEVER remove without checking consumers first
4. Run build/typecheck AFTER each task, BEFORE committing

### Trivial workflow (fast-mode, ≤3 edits, no agent spawn):
Execute inline. No planning, no Scout, no Architect, no Critic.
1. Read the file(s) + grep for consumers of what you'll change
2. Make the change (match existing patterns)
3. Run build: `tsc --noEmit` / `npm run build` / `cargo check`
4. If build fails, fix (up to 3 attempts)
5. Commit with conventional format
6. Done. No SUMMARY, no verification.
**Redirect**: if work exceeds 3 file edits or needs research → upgrade to medium workflow.

**Trivial done**: files changed | build passes | committed | no stubs

### Medium workflow (1 Builder agent):
If task count > 5: auto-upgrade to complex workflow (per-task fresh agents) to prevent context filling.
Launch ONE Builder agent with ALL tasks batched and `model: models.builder` from Step 1.5:
- Agent gets: base prompt + brain context + all task descriptions
- If `--tdd` flag is set, prepend to Builder context: `MODE: TDD (red→green→refactor). Write failing test FIRST. See <tdd_mode> in builder prompt.`
- Agent executes tasks sequentially within its context
- One agent call instead of one per task = token savings
- If Critic is not skipped, launch Critic with `model: models.critic` after Builder completes

**Medium done**: all tasks complete | build passes | committed | critic reviewed

### Complex workflow (per-task agents, fresh context each):

**Check brain.db first** — if `/sf-plan` was run, tasks already exist:

`brain_tasks: { action: list, status: pending }`

If tasks found in brain.db, execute them. If not, run inline planning first.

**Per-task execution (fresh context per task):**

**REQUIRED — output progress for EVERY task (do NOT batch or skip):**

Before each task:
```
[N/M] Building: [task description]...
```
After each task:
```
[N/M] ✓ [task description] (commit: [sha])
```
Or on failure:
```
[N/M] ✗ [task description] (error: [first 80 chars])
```
If you did not output these lines, this is a process failure.

For each pending task in brain.db:
1. Launch a SEPARATE sf-builder agent with ONLY that task + brain context + `model: models.builder` from Step 1.5. If `--tdd` flag is set, prepend `MODE: TDD (red→green→refactor). Write failing test FIRST.` to the task context.
2. Builder gets fresh context — no accumulated garbage from previous tasks
3. Builder executes: read → grep consumers → implement → build → verify → commit
4. After Builder completes, update task status and record model outcome:
   - `brain_tasks: { action: update, id: [id], status: passed, commit_sha: [sha] }`
   - `brain_model_outcome: { agent: builder, model: [model used], domain: [domain], task_id: [id], outcome: success }`
5. If Builder fails after 3 attempts:
   - `brain_tasks: { action: update, id: [id], status: failed, error: [error] }`
   - `brain_model_outcome: { agent: builder, model: [model used], domain: [domain], task_id: [id], outcome: failure }`
   If Builder reports STUCK (same error pattern repeated):
   - Do NOT retry with same approach
   - Record: brain_learnings: { action: add, pattern: stuck-[domain], problem: [repeated error], solution: null }
   - Use AskUserQuestion: "Builder is stuck on [task]. What to do?"
     Options: "Skip this task" / "Try different approach" / "I'll fix manually"
   - If skip → mark task as skipped, continue to next
   - If different approach → re-run Builder with hint: "Previous approach failed: [error]. Try a different approach."
   - If manual → save state, STOP
6. Continue to next task regardless

**Wave grouping + parallel execution:**
- Independent tasks (no `depends`) → same wave
- Dependent tasks → later wave → wait for dependencies to complete
- Tasks touching same files → sequential (never parallel)

**Parallel execution within waves:**
If a wave has 2+ tasks, launch ALL Builder agents in that wave simultaneously using multiple Agent tool calls in a single response. Wait for all to complete before starting the next wave. This is safe because wave tasks are independent by definition.

### Builder behavior:
- Follows deviation tiers: auto-fix bugs (T1-3), STOP for architecture changes (T4)
- Analysis paralysis guard: 5+ reads without writing = STOP
- 3-attempt fix limit: document and move on after 3 failures
- Stub detection before commit: scan for TODO/FIXME/placeholder
- Commit hygiene: stage specific files, never `git add .`

**Complex done**: all tasks [N/M] | build | critic | consumers clean | stubs clean | branch audit

---

## STEP 7: MANDATORY POST-EXECUTION VERIFICATION

STOP-GATE: Do NOT output the final report or say "Done" until ALL checks below are complete. If you skip verification, the task is FAILED regardless of whether the code works. This is not optional.

You MUST complete **ALL** of the following in order. Check each off as you go.

### 7A. Launch Critic agent (REQUIRED for medium/complex)

Launch sf-critic agent with `model: models.critic` and the full diff:
```bash
git diff HEAD~[N commits]
```
Wait for Critic to return its verdict. If Critic finds CRITICAL issues → send to Builder for fix (1 additional agent call, not a full re-run).

Report: `Critic: [PASS/PASS_WITH_WARNINGS/FAIL] — [N] findings`

### 7B. Build verification (REQUIRED)

Run the project's build/typecheck command:
```bash
npm run build  # or tsc --noEmit / cargo check
```
Report: `Build: [PASS/FAIL]`

### 7C. Consumer integrity check (REQUIRED)

For every function/type/export that was modified or removed across all tasks:
```bash
grep -r "removed_symbol" --include="*.ts" --include="*.tsx" --include="*.js" .
```
Any remaining consumers = CRITICAL failure. Report: `Consumers: [CLEAN/N broken]`

### 7D. Stub scan (REQUIRED)

Scan all changed files for incomplete work:
```bash
git diff HEAD~[N] --name-only
```
Then grep each for: TODO, FIXME, HACK, placeholder, console.log, debugger

Report: `Stubs: [CLEAN/N found]`

### 7E. Branch audit (REQUIRED when on non-default branch)

```bash
CURRENT=$(git branch --show-current)
```
`brain_config: { action: get, key: default_branch }` — fall back to `"main"`.

If `$CURRENT` ≠ `$DEFAULT`:
- `git diff $DEFAULT...$CURRENT --diff-filter=D --name-only` → deleted files
- For removed exports, check consumers via brain.db
- Report: `Branch audit: [N] migrated | [N] missing | [N] safe`

### 7F. TDD check (when --tdd flag is set)

Verify `test(...)` commits come before `feat(...)` commits. Report: `TDD: [VALID/VIOLATION]`

### 7G. Launch Scribe agent (REQUIRED for complex)

Launch sf-scribe agent with `model: models.scribe` to record decisions + learnings to brain.db.

### 7H. Score results

Combine all checks:
- All pass → **PASS**
- Minor issues → **PASS_WITH_WARNINGS** (list them)
- Critical issues → **FAIL** (list them, attempt auto-fix)

### Auto-Fix on Failure
If FAIL:
1. Generate targeted fix tasks (~200 tokens each)
2. Send to Builder for one retry
3. Re-verify
4. If still failing → DEFERRED

Store verification results:
`brain_context: { action: set, scope: session, key: verification, value: [JSON results] }`

**Delete lock file** after all tasks complete:
```bash
rm -f .shipfast/lock
```

Only AFTER 7A-7H are complete, proceed to STEP 8.

---

## STEP 8: LEARN

**This step is REQUIRED for every non-trivial run. Not a judgment call.**

### 8a. Decisions — auto-record per classification

For every run where intent classification in STEP 1 was `medium` or `complex`, record AT LEAST ONE decision row BEFORE exiting this step. The decision can be about:

- The approach Architect picked (and what alternatives were considered)
- Any irreversible operation Critic flagged and how it was handled
- A non-obvious tradeoff you made during Builder execution
- A library / pattern you chose when multiple would have worked

Use `brain_decisions { action: "add", question: "[what had to be decided]", decision: "[the choice]", reasoning: "[why — 1-2 sentences]", phase: "[current task id or branch name]" }`.

If genuinely no meaningful decision was made (rare — usually only for `trivial` classification), record:

`brain_decisions { action: "add", question: "Approach for [task]", decision: "Direct implementation — no significant choice required", reasoning: "Task was [trivial/single-file/already-obvious]", phase: "[task id]" }`

The point is to build up a history that later runs can consult via `brain_decisions { action: "list" }`.

### 8b. Learnings — auto-record from failures + successes

Any retry, any error that was fixed, any "I didn't expect that" moment:

`brain_learnings { action: "add", pattern: "[short kebab-case pattern name]", problem: "[what went wrong]", solution: "[what fixed it]", domain: "[auth/db/ui/api/…]", source: "auto", confidence: 0.5 }`

If a pattern from an EARLIER learning helped this run (i.e. you pulled from `brain_learnings` and it was useful), boost its confidence:

`brain_learnings { action: "boost", pattern: "[pattern]" }`

### 8c. Seeds — forward ideas

Any OUT_OF_SCOPE, future-work, or "we should also…" thought:

`brain_seeds { action: "add", idea: "[idea]", source_task: "[current task]", domain: "[domain]", priority: "someday" }`

**These records are not optional — they're how `brain.db`'s decisions/learnings tables actually populate. Empty tables across runs mean this step is being skipped.**

---

## STEP 9: REPORT

**Before reporting, confirm all post-execution steps completed (complex tasks):**
- [ ] Progress lines shown [N/M] for every task
- [ ] Critic reviewed — verdict: ___
- [ ] Build: ___
- [ ] Consumer integrity: ___
- [ ] Stubs: ___
- [ ] Branch audit (if non-default): ___
- [ ] Scribe recorded decisions/learnings

**If any checkbox is unchecked, go back and complete it now. Do NOT report with incomplete verification.**

**Trivial tasks**:
```
Done: [one sentence summary]
```

**Medium tasks**:
```
Done: [summary]
Commits: [N] | Build: [PASS/FAIL] | Critic: [verdict] | Consumers: [clean/N broken]
```

**Complex tasks** (full dashboard):
```
Done: [summary]
Commits: [N] | Tasks: [completed]/[total]

Verification:
  Critic:    [PASS/WARNINGS/FAIL] — [N findings]
  Build:     [PASS/FAIL]
  Consumers: [CLEAN/N broken]
  Stubs:     [CLEAN/N found]
  Branch:    [N migrated, N missing, N safe] (or N/A if default branch)

Deferred: [issues needing manual attention, if any]
```

**If session state was saved** (context getting low):
```
Progress saved. [N]/[M] tasks completed.
Run /sf-resume to continue in a new session.
```

## SESSION FINISH (v1.9.0 — MUST run on every exit)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Outcome rules:
- All tasks passed / user declined execution → `completed`
- Bailed early (e.g. not a git repo, missing brain.db) → `bailed`
- Agent crashed or fatal error → `errored`

`artifacts` should include every `task:<id>` and `finding:<id>` produced this run.

</pipeline>

<context_management>
## Context Management (ENFORCED — NEVER degrade quality)

Between tasks, assess: can you complete the next task at FULL quality?
If NO (context running low, responses getting long, repeated tool failures):

1. Commit any uncommitted work
2. Save progress: brain_context: { action: set, scope: session, key: progress, value: { completed: [task IDs], pending: [task IDs], next_task: [id] } }
3. Output:
   Context save point. [N]/[M] tasks completed.
   Progress saved to brain.db.
   Run /sf-resume in a new session to continue with fresh context.
4. STOP. Do not start the next task.

NEVER: reduce quality, skip verification, use grep instead of read, or rush to finish.
Rule: save and resume > degrade and continue.
</context_management>

<context>
$ARGUMENTS
</context>
