---
name: sf:discuss
description: "Detect ambiguity and ask domain-specific questions before planning. Stores answers as locked decisions."
argument-hint: "<task description> [--batch] [--chain] [--assume]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - Skill
---

<objective>
Domain-aware questioning system that detects ambiguity BEFORE planning.
Prevents wasting tokens on plans built from wrong assumptions.

Detects 6 domains automatically: UI, API, Database, Auth, Content, Infra.
Asks domain-specific questions (not generic ones).

Flags:
- `--batch` — Group all questions into 1-2 AskUserQuestion calls
- `--chain` — After discussion, auto-run /sf-plan → /sf-check-plan → ask to execute
- `--assume` — Auto-resolve using brain.db patterns (no questions)
</objective>

<process>

## Step 1: Detect Domain + Ambiguity (zero tokens — rule-based)

**Auto-detect domain** from task keywords:
- **UI**: style, layout, component, page, form, button, modal, responsive, dark mode
- **API**: endpoint, route, handler, webhook, rest, graphql, middleware
- **Database**: migration, schema, model, table, orm, prisma, drizzle
- **Auth**: login, signup, password, permission, role, token, session, oauth, jwt
- **Content**: docs, blog, email, notification, i18n, template
- **Infra**: deploy, ci/cd, docker, k8s, monitoring, terraform

Then detect ambiguity types:
- **WHERE**: No file paths, component names, or locations mentioned
- **WHAT**: No specific behavior described, very short input
- **HOW**: Contains alternatives or describes a generic feature
- **RISK**: Mentions auth/payment/database/delete/production
- **SCOPE**: More than 30 words with 2+ conjunctions

Report domain detection: `Domain: [ui, auth] | Ambiguities: [HOW, WHERE, RISK]`

## Step 2: Check Locked Decisions

Query brain.db for existing decisions tagged with detected ambiguity types.
Skip any ambiguity that was already resolved in a previous session.

## Step 3: Ask Domain-Specific Questions

**If `--batch` flag is set**: Group all questions into AskUserQuestion calls (max 4 per call).

**If `--assume` flag is set**: Auto-resolve and present assumptions (see Assumptions Mode below).

For each remaining ambiguity, ask a **domain-specific** question:

### UI Domain
- HOW: "Layout density? [Compact | Comfortable | Spacious]"
- HOW: "Interaction pattern? [Inline editing | Modal dialogs | Page navigation | Drawer panels]"
- HOW: "Empty state behavior? [Placeholder | Onboarding CTA | Hide section]"
- WHERE: "Which page/route should this appear on?"
- RISK: "Does this affect existing UI users rely on?"

### API Domain
- HOW: "Response format? [JSON REST | GraphQL | tRPC | JSON-RPC]"
- HOW: "Error handling? [HTTP status codes | Always 200 | RFC 7807]"
- HOW: "Auth mechanism? [Bearer token | API key | Session cookie | Public]"
- WHERE: "Which endpoint prefix? (e.g., /api/v1/users)"
- RISK: "Public-facing or internal API?"

### Database Domain
- HOW: "ORM? [Prisma | Drizzle | TypeORM | Knex | Raw SQL | Match existing]"
- HOW: "Migration strategy? [Auto-generate | Manual | Schema push]"
- WHERE: "Which table/model?"
- RISK: "Data migration needed? Existing production data?"

### Auth Domain
- HOW: "Auth approach? [JWT | Session cookies | OAuth2 | API keys]"
- HOW: "Token storage? [httpOnly cookie | localStorage | Memory | Secure cookie + CSRF]"
- HOW: "Role model? [Simple roles | RBAC | ABAC | No roles]"
- RISK: "Affects existing user sessions?"

### Content Domain
- HOW: "Format? [Markdown | Rich text | Structured JSON | Plain text]"
- HOW: "Tone? [Technical | Casual | Formal | Match existing]"
- HOW: "i18n? [English only | Multi-language | i18n-ready]"

### Infra Domain
- HOW: "Deploy target? [Vercel | AWS | Docker | Self-hosted | Match existing]"
- HOW: "CI/CD? [GitHub Actions | GitLab CI | CircleCI | None | Match existing]"

Use **multiple choice** for HOW questions (saves user effort).
Use **free text** for WHERE questions.
Use **confirmation** for RISK questions.

## Step 4: Follow-Up Depth

After each answer, score it:
- Multiple choice selection → sufficient (1.0)
- Short free text (<3 words) → needs follow-up (0.5)
- "I don't know" / "not sure" → needs follow-up (0.0)

**If score < 0.5**: Ask ONE follow-up:
- WHERE: "You mentioned [answer]. Can you be more specific — which file or directory?"
- WHAT: "You said [answer]. What should the user see when this is done?"
- HOW: "You picked [answer]. Any specific library or pattern to follow?"

**Max 2 follow-up rounds per ambiguity**. After that, lock whatever we have.

## Step 5: Lock Decisions

Store each answer in brain.db with domain tag:
```bash
sqlite3 .shipfast/brain.db "INSERT INTO decisions (question, decision, reasoning, phase, tags) VALUES ('[question]', '[answer]', 'User-provided via discussion', 'discuss', '[TYPE],[domain]');"
```

These decisions are:
- Injected into all downstream agent contexts
- Never asked again (even across sessions)
- Visible via `/sf-brain decisions`

## Step 6: Report

```
Resolved [N] ambiguities (domains: [ui, auth]):
  HOW (auth): JWT stateless tokens
  HOW (ui): Compact layout, modal dialogs
  WHERE: /app/auth/login page
  RISK: Development only — confirmed

Ready for planning. Run /sf-do to continue.
```

## Step 7: Chain Mode (when `--chain` flag is set)

After all decisions locked:
1. Auto-run `/sf-plan` with the task description + locked decisions
2. After planning completes, auto-run `/sf-check-plan`
3. If check passes, ask: "Plan ready. Execute now? [y/n]"
4. If yes, auto-run `/sf-do`

## Assumptions Mode (when `--assume` flag is set)

Auto-resolve ambiguities using codebase patterns:
1. **WHERE**: Search brain.db nodes for files matching task keywords
2. **HOW**: Reuse past HOW decisions from same domain, or domain learnings
3. **WHAT**: Infer from task description
4. **RISK**: Auto-confirm if `.env.local` or `.env.development` exists
5. **SCOPE**: Default to "tackle all at once"

Each resolution has a confidence score (0-1):
- >= 0.5: Accept and lock
- < 0.5: Fall back to asking

Present assumptions:
```
Assuming (based on codebase patterns):
  HOW (auth): JWT — reusing previous decision (confidence: 0.8)
  WHERE: src/auth/login.ts — matched keyword "login" (confidence: 0.7)
  RISK: Development env detected (confidence: 0.7)

Say 'no' to override, or Enter to continue.
```

</process>

<context>
$ARGUMENTS
</context>
