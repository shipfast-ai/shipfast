---
name: sf:discuss
description: "Detect ambiguity and ask domain-specific questions before planning. Stores answers as locked decisions."
argument-hint: "<task description> [--batch] [--chain] [--assume]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
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

For each remaining ambiguity, ask a **domain-specific** question using multiple choice (HOW), free text (WHERE), or confirmation (RISK):

| Domain | Type | Question |
|---|---|---|
| **UI** | HOW | Layout density? [Compact \| Comfortable \| Spacious] |
| UI | HOW | Interaction pattern? [Inline editing \| Modal dialogs \| Page navigation \| Drawer panels] |
| UI | HOW | Empty state behavior? [Placeholder \| Onboarding CTA \| Hide section] |
| UI | WHERE | Which page/route should this appear on? |
| UI | RISK | Does this affect existing UI users rely on? |
| **API** | HOW | Response format? [JSON REST \| GraphQL \| tRPC \| JSON-RPC] |
| API | HOW | Error handling? [HTTP status codes \| Always 200 \| RFC 7807] |
| API | HOW | Auth mechanism? [Bearer token \| API key \| Session cookie \| Public] |
| API | WHERE | Which endpoint prefix? (e.g., /api/v1/users) |
| API | RISK | Public-facing or internal API? |
| **Database** | HOW | ORM? [Prisma \| Drizzle \| TypeORM \| Knex \| Raw SQL \| Match existing] |
| Database | HOW | Migration strategy? [Auto-generate \| Manual \| Schema push] |
| Database | WHERE | Which table/model? |
| Database | RISK | Data migration needed? Existing production data? |
| **Auth** | HOW | Auth approach? [JWT \| Session cookies \| OAuth2 \| API keys] |
| Auth | HOW | Token storage? [httpOnly cookie \| localStorage \| Memory \| Secure cookie + CSRF] |
| Auth | HOW | Role model? [Simple roles \| RBAC \| ABAC \| No roles] |
| Auth | RISK | Affects existing user sessions? |
| **Content** | HOW | Format? [Markdown \| Rich text \| Structured JSON \| Plain text] |
| Content | HOW | Tone? [Technical \| Casual \| Formal \| Match existing] |
| Content | HOW | i18n? [English only \| Multi-language \| i18n-ready] |
| **Infra** | HOW | Deploy target? [Vercel \| AWS \| Docker \| Self-hosted \| Match existing] |
| Infra | HOW | CI/CD? [GitHub Actions \| GitLab CI \| CircleCI \| None \| Match existing] |

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

`brain_decisions: { action: add, question: [question], decision: [answer], reasoning: "User-provided via discussion", phase: discuss, tags: [TYPE],[domain] }`

These decisions are:
- Injected into all downstream agent contexts
- Never asked again (even across sessions)
- Visible via `/sf-brain decisions`

## Step 6: Report + Ask Next Step

```
Resolved [N] ambiguities (domains: [ui, auth]):
  HOW (auth): JWT stateless tokens
  HOW (ui): Compact layout, modal dialogs
  WHERE: /app/auth/login page
  RISK: Development only — confirmed
```

If `--chain` flag is NOT set:
  Use AskUserQuestion: "Decisions locked. Plan and execute this task?"
  - Options: "Yes, plan now" / "No, I'll do it later"
  If yes → use the Skill tool with skill_name "sf:plan" and the original task description.

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
