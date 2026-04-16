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

**FIX #5: Git diff awareness** — Run `git diff --name-only HEAD` to see what files changed since last commit. Pass this list to Scout so it focuses on recent changes instead of searching blindly.

If `.shipfast/brain.db` does not exist, tell user to run `shipfast init` first.

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
- All affected files already indexed in brain.db AND
- We have high-confidence learnings for this domain AND
- Intent is `fix` with explicit file paths

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

### Medium workflow (1 Builder agent):
Launch ONE Builder agent with ALL tasks batched and `model: models.builder` from Step 1.5:
- Agent gets: base prompt + brain context + all task descriptions
- If `--tdd` flag is set, prepend to Builder context: `MODE: TDD (red→green→refactor). Write failing test FIRST. See <tdd_mode> in builder prompt.`
- Agent executes tasks sequentially within its context
- One agent call instead of one per task = token savings
- If Critic is not skipped, launch Critic with `model: models.critic` after Builder completes

### Complex workflow (per-task agents, fresh context each):

**Check brain.db first** — if `/sf-plan` was run, tasks already exist:
```bash
sqlite3 -json .shipfast/brain.db "SELECT id, description, plan_text FROM tasks WHERE status = 'pending' ORDER BY created_at;" 2>/dev/null
```

If tasks found in brain.db, execute them. If not, run inline planning first.

**Per-task execution (fresh context per task):**
For each pending task in brain.db:
1. Launch a SEPARATE sf-builder agent with ONLY that task + brain context + `model: models.builder` from Step 1.5. If `--tdd` flag is set, prepend `MODE: TDD (red→green→refactor). Write failing test FIRST.` to the task context.
2. Builder gets fresh context — no accumulated garbage from previous tasks
3. Builder executes: read → grep consumers → implement → build → verify → commit
4. After Builder completes, update task status and record model outcome:
   ```bash
   sqlite3 .shipfast/brain.db "UPDATE tasks SET status='passed', commit_sha='[sha]' WHERE id='[id]';"
   sqlite3 .shipfast/brain.db "INSERT INTO model_performance (agent, model, domain, task_id, outcome) VALUES ('builder', '[model used]', '[domain]', '[id]', 'success');"
   ```
5. If Builder fails after 3 attempts:
   ```bash
   sqlite3 .shipfast/brain.db "UPDATE tasks SET status='failed', error='[error]' WHERE id='[id]';"
   sqlite3 .shipfast/brain.db "INSERT INTO model_performance (agent, model, domain, task_id, outcome) VALUES ('builder', '[model used]', '[domain]', '[id]', 'failure');"
   ```
6. Continue to next task regardless

**Wave grouping:**
- Independent tasks (no `depends`) → same wave → launch Builder agents in parallel
- Dependent tasks → later wave → wait for dependencies to complete
- Tasks touching same files → sequential (never parallel)

**After all tasks:**
- Launch Critic agent (fresh context) with `model: models.critic` to review ALL changes: `git diff HEAD~N`
- Launch Scribe agent (fresh context) with `model: models.scribe` to record decisions + learnings to brain.db
- Save session state for `/sf-resume`

**After execution, run `/sf-verify` for thorough verification.**

### Builder behavior:
- Follows deviation tiers: auto-fix bugs (T1-3), STOP for architecture changes (T4)
- Analysis paralysis guard: 5+ reads without writing = STOP
- 3-attempt fix limit: document and move on after 3 failures
- Stub detection before commit: scan for TODO/FIXME/placeholder
- Commit hygiene: stage specific files, never `git add .`

### If Critic finds CRITICAL issues:
Send the issue back to Builder for fix (1 additional agent call, not a full re-run).

---

## STEP 7: VERIFY (0-3K tokens)

**Skip if**: trivial tasks with passing build, UNLESS `--verify` flag is set
**Force if**: `--verify` flag is set, regardless of complexity

Run goal-backward verification:
1. Extract done-criteria from the original request + plan
2. Check each criterion:
   - File exists? → filesystem check
   - Symbol exists? → grep check
   - Build passes? → run build command
   - No stubs? → scan changed files for TODO/FIXME/placeholder
   - Behavior works? → mark as "manual verification needed"
3. Score: N/M criteria met
   - 100% → PASS
   - 80%+ → PASS_WITH_WARNINGS (list gaps)
   - Below 80% → FAIL (list what's missing)

Store verification results in brain.db.

### Auto-Fix on Failure
If verification returns FAIL:
1. Generate targeted fix tasks from each failure (~200 tokens each, not a fresh agent)
2. Send fix tasks to Builder for one retry attempt
3. Re-verify after fixes
4. If still failing, report as DEFERRED — do not loop further

### TDD Verification (when --tdd flag is set)
After all tasks complete, verify git log contains the correct commit sequence:
1. `test(...)` commit (RED phase) — must exist
2. `feat(...)` commit after it (GREEN phase) — must exist
3. Optional `refactor(...)` commit
If sequence is violated, flag as TDD VIOLATION in the report.

### Requirement Verification (when project has REQ-IDs)
If brain.db has requirements for this phase:
1. Check each v1 requirement mapped to this phase
2. Mark as done/pending based on verification results
3. Report coverage: "Requirements: N/M covered"

---

## STEP 8: LEARN

**FIX #9/#10: Explicitly record decisions and learnings using these exact commands:**

If you made any architectural decisions during this task, record each one:
```bash
sqlite3 .shipfast/brain.db "INSERT INTO decisions (question, decision, reasoning, phase) VALUES ('[what was decided]', '[the choice]', '[why]', '[current task]');"
```

If you encountered and fixed any errors, record the pattern:
```bash
sqlite3 .shipfast/brain.db "INSERT INTO learnings (pattern, problem, solution, domain, source, confidence) VALUES ('[short pattern name]', '[what went wrong]', '[what fixed it]', '[domain]', 'auto', 0.5);"
```

If any improvement ideas, future features, or tech debt were surfaced during this task (including OUT_OF_SCOPE items), record them as seeds:
```bash
sqlite3 .shipfast/brain.db "INSERT INTO seeds (idea, source_task, domain, priority) VALUES ('[idea]', '[current task]', '[domain]', 'someday');"
```

**These are not optional.** If decisions were made, errors were fixed, or ideas were surfaced, you MUST record them. This is how ShipFast gets smarter over time.

---

## STEP 9: REPORT

**Trivial tasks** (progressive disclosure — minimal output):
```
Done: [one sentence summary]
```

**Medium tasks**:
```
Done: [summary]
Commits: [N] | Verification: [PASS/WARN/FAIL]
```

**Complex tasks** (full dashboard):
```
Done: [summary]
Commits: [N] | Tasks: [completed]/[total] | Verification: [PASS/WARN/FAIL]
Tokens: ~[estimate] | Time: [duration]
Deferred: [list of issues that need manual attention, if any]
```

**If session state was saved** (context getting low):
```
Progress saved. [N]/[M] tasks completed.
Run /sf-resume to continue in a new session.
```

</pipeline>

<context_exhaustion>
Monitor context usage throughout execution:
- At 65%: inject "be concise" guidance to agents
- At 80%: skip Scribe, use cheapest model for all agents
- At 90%: STOP new work, save state, commit current work
- At 95%: emergency state dump, notify user to run /sf-resume
</context_exhaustion>

<context>
$ARGUMENTS
</context>
