---
name: sf:project
description: "Decompose a large project into phases with requirement tracing. Each phase runs through /sf-do independently."
argument-hint: "<describe the full project>"
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
Handle multi-day, multi-phase projects. Decomposes a large request into ordered phases,
assigns REQ-IDs to every requirement, maps them to phases, and tracks coverage across sessions.

Each phase runs through the /sf-do pipeline independently.
Cross-phase context (decisions, learnings, conventions) carries forward automatically via brain.db.
</objective>

<process>


## Session start (v1.9.0 — session start)

Generate `RUN_ID` (format `run:<unix-ms>:<rand4>`) and detect branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
```

Call: `brain_sessions { action: "start", run_id: RUN_ID, command: "sf:project", args: "$ARGUMENTS", branch: BRANCH, classification: "{}" }`

Initialize `artifacts = []` for tracking ids produced by this run.

## Step 0: Project Discovery (REQUIRED before planning)

You are a senior technical discovery lead. Your job is to understand this project deeply enough to write complete requirements — every API endpoint, every data model, every user flow, every edge case.

Read the user's description. Then identify what you DON'T know.

### Coverage framework — you MUST understand ALL 10 categories before proceeding:

1. **PROBLEM** — What pain point does this solve? For whom?
2. **USERS** — Who uses it? What are their distinct needs/roles?
3. **CORE FLOW** — What is the primary user journey? (step by step)
4. **DATA** — What data is created, stored, queried? Relationships?
5. **BOUNDARIES** — What is v1? What is explicitly NOT v1?
6. **TECH** — Stack decisions (or detect from existing code via package.json/Cargo.toml/etc.)
7. **AUTH** — Who can do what? Access control model?
8. **INTEGRATIONS** — External services, APIs, third-party dependencies?
9. **CONSTRAINTS** — Timeline, team, budget, compliance, performance?
10. **RISKS** — What could go wrong? What's the hardest part?

### How to ask:

- Ask 2-4 questions per round using AskUserQuestion
- Make questions specific to THIS project — not generic templates
- Use multiple choice when there are known options, free text when open-ended
- NEVER ask questions the description already answers
- NEVER ask generic questions like "what's your vision?" — be specific to what's missing

### Sufficiency check (after each round):

Score each category: CLEAR (user answered) / ASSUMED (safe default) / UNKNOWN (gap).

- 8+ categories CLEAR or ASSUMED → STOP asking, proceed to Step 1
- 6-7 clear → one more round targeting gaps
- <6 clear after Round 2 → ask: "I still have gaps in [X, Y, Z]. Clarify or should I assume?"
- After Round 4 → STOP regardless, list all assumptions, proceed

### Safe assumptions (don't need to ask):

The LLM CAN assume when: tech choice has 80%+ market default (e.g., PostgreSQL for web apps), existing codebase already uses it, or user mentioned a related technology that implies it.

The LLM MUST ask about: business logic decisions, integration choices, scope boundaries, anything with security/compliance implications.

### User escape hatches:

- "enough" / "just build it" / "start" → STOP immediately, proceed with assumptions
- "I don't know" / "decide for me" → use safe default, mark as ASSUMED
- "come back to this later" → mark as UNKNOWN, flag in requirements as TBD

### Hard limits (prevent infinite loops):

- Maximum 4 rounds (16 questions total)
- Round 1 is REQUIRED. Rounds 2-4 are optional.
- NEVER re-ask something already answered or locked in brain.db

### Store discoveries:

After each round, store answers as locked decisions:
`brain_decisions: { action: add, question: [what was asked], decision: [user's answer], reasoning: "Discovery phase", phase: "discovery", tags: "[CATEGORY]" }`

When assumptions are made, also store them:
`brain_decisions: { action: add, question: [category], decision: "[ASSUMED] [default]", reasoning: "Safe default — user did not specify", phase: "discovery", tags: "[CATEGORY],assumed" }`

### Present summary before proceeding:

```
Discovery Complete — [N] decisions locked

CLEAR:
  PROBLEM: [summary]
  USERS: [summary]
  TECH: [summary]
  ...

ASSUMED (override with /sf-brain decisions):
  DATABASE: PostgreSQL (market default)
  AUTH: JWT (implied by "API")

UNKNOWN (flagged as TBD in requirements):
  CONSTRAINTS: Timeline not specified
```

Use AskUserQuestion: "Discovery complete. Proceed to research + planning?"
If no → user can add more context or override assumptions.

---

## Step 1: Understand the Project

Load all discovery decisions from brain.db. If brain.db has existing context, also load:
- Tech stack context
- Previous decisions
- Codebase conventions

## Step 1.5: Parallel Domain Research (for new/complex projects)

If the project involves unfamiliar technology or external integrations, launch **up to 4 Scout agents in parallel** to research:

1. **Stack Scout** — What's the standard stack for this domain? Libraries, versions, frameworks.
2. **Architecture Scout** — How are similar systems typically structured? Patterns, tiers, boundaries.
3. **Pitfalls Scout** — What do projects like this commonly get wrong? Gotchas, anti-patterns.
4. **Integration Scout** — What external services/APIs are needed? Auth, webhooks, SDKs.

Each Scout runs in its own context. Findings are stored in brain.db:

Use the `brain_context` MCP tool with: `{ "action": "set", "id": "project:research:[topic]", "scope": "project", "key": "research:[topic]", "value": "[findings JSON]" }`

Skip this step for simple projects or projects where brain.db already has relevant decisions.

### Multi-Repo Detection
Check if the workspace contains multiple git repositories (submodules, monorepo packages):
```bash
find . -name ".git" -maxdepth 3 -type d
```
If multiple repos found, ask which ones this project touches. Store as locked decision.
Track which phases target which repo.

## Step 2: Extract Requirements

Before decomposing into phases, extract **every** requirement from the description.

Assign REQ-IDs using the pattern `CATEGORY-NUMBER`:
```
AUTH-01: User login with email/password
AUTH-02: JWT token refresh
AUTH-03: Role-based access control
PAY-01:  Stripe checkout integration
PAY-02:  Webhook handling for subscription events
PAY-03:  Usage-based billing calculation
UI-01:   Admin dashboard for plan management
UI-02:   User billing settings page
```

Categorize each requirement:
- **v1**: Must have for launch
- **v2**: Nice to have, do after launch
- **out_of_scope**: Explicitly excluded

Store ALL requirements in brain.db requirements table.

## Step 3: Decompose into Phases

Break the project into 3-8 ordered phases. Each phase should be:
- **Independently deliverable** — produces working code that can be tested
- **Logically grouped** — related changes together
- **Dependency-ordered** — later phases build on earlier ones

Guidelines for phase ordering:
1. Data model / schema first (everything depends on this)
2. Core business logic second
3. API / integration layer third
4. UI / frontend fourth
5. Polish, optimization, testing last

**Map every v1 requirement to exactly one phase.** No requirement left unmapped.

## Step 4: Store in brain.db

Store phases:
```
scope: 'project'
key: 'phases'
value: [
  { id: 1, name: "Database schema", description: "...", status: "pending", depends: [], reqs: ["AUTH-01", "PAY-01"] },
  { id: 2, name: "Core API", description: "...", status: "pending", depends: [1], reqs: ["AUTH-02", "AUTH-03"] },
  ...
]
```

Store project overview:
```
scope: 'project'
key: 'overview'
value: { name: "...", goal: "...", totalPhases: N, totalReqs: N }
```

Store each requirement (MUST execute — this powers /sf-verify requirement coverage):
```sql
INSERT INTO requirements (id, category, description, priority, phase)
VALUES ('AUTH-01', 'auth', 'User login with email/password', 'v1', 'Phase 1');
```
**Do not skip this step.** Requirements in brain.db are used by /sf-verify for coverage tracking and by /sf-status for progress reporting.

## Step 5: Validate Coverage

Before presenting to user, verify:
1. **Every v1 requirement** is mapped to a phase (100% coverage required)
2. **No phase** has more than 8 requirements (split if too many)
3. **Dependencies** are acyclic (no circular deps between phases)

If validation fails, fix the mapping before presenting.

## Step 6: Present to User

```
Project: [name]
=============

Requirements: [N] total ([M] v1, [K] v2, [J] out of scope)

Phase 1: [name] — [1-line description]
  Requirements: AUTH-01, PAY-01, DATA-01
Phase 2: [name] — [1-line description] (depends on Phase 1)
  Requirements: AUTH-02, AUTH-03, API-01
Phase 3: [name] — [1-line description] (depends on Phase 1)
  Requirements: PAY-02, PAY-03
Phase 4: [name] — [1-line description] (depends on Phase 2, 3)
  Requirements: UI-01, UI-02

Coverage: [M]/[M] v1 requirements mapped (100%)

```

Use AskUserQuestion: "Project decomposed into [N] phases. Start Phase 1: [name]?"
- Options: "Yes, start Phase 1" / "No, I'll review first"

If yes → use the Skill tool with skill_name "sf:do" and argument "Phase 1: [description]".

## Step 7: Execution

User runs `/sf-do Phase 1: [description]` for each phase.
Or runs `/sf-do next` to automatically pick the next pending phase.

After each phase completes:
- Update phase status in brain.db
- Mark requirements as done when their verification passes
- Decisions carry forward to next phase
- Learnings carry forward
- /sf-status shows project-level + requirement-level progress

## Phase Status Tracking

```
/sf-status shows:

Project: SaaS Billing System
=============================
Phase 1: Database schema      [DONE]  3 commits    AUTH-01 PAY-01 DATA-01
Phase 2: Stripe integration   [DONE]  5 commits    AUTH-02 AUTH-03 API-01
Phase 3: Webhook handling      [IN PROGRESS]  2/4   PAY-02 PAY-03
Phase 4: Admin dashboard       [PENDING]            UI-01 UI-02
Phase 5: Usage tracking        [PENDING]            METRIC-01 METRIC-02

Progress: 2/5 phases (40%) | Requirements: 6/12 v1 done (50%)
```

## Interactive UAT (after each phase)

After a phase completes and automated verification passes, offer interactive testing:

```
Phase 2 complete. Run quick manual checks?

Test 1/3: Login with email/password
  Expected: Redirect to dashboard after successful login
  Result? [pass/issue/skip]:

Test 2/3: Token refresh on page reload
  Expected: User stays logged in, no re-authentication needed
  Result? [pass/issue/skip]:
```

For each test:
- **pass** (or empty/yes/ok) → mark requirement as verified
- **issue** → record failure, infer severity, generate fix task
- **skip** → mark as unverified with reason

Store results in brain.db. Update requirement `verified` flag.


## Session finish (v1.9.0 — session finish)

Before returning control to the user, call:

`brain_sessions { action: "finish", run_id: RUN_ID, outcome: "<completed|bailed|errored>", artifacts_written: <JSON stringified artifacts array> }`

Every exit path — normal end, early bail, error — MUST hit this call. Never exit without finishing the session.

</process>

<context>
$ARGUMENTS
</context>
