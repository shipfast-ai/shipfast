---
name: sf:worktree
description: "Manage parallel worktrees — create, list, switch, status, check, complete. Uses git worktree for true parallel development."
argument-hint: "list | create <task> | switch <name> | status <name> | check [name] | complete <name>"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - AskUserQuestion
---

<objective>
Worktrees let you work on multiple features truly in parallel, each with its own
working directory, branch, and task tracking. Unlike branches, worktrees don't
require switching — each lives in its own folder so multiple Claude sessions
can work simultaneously.
</objective>

<process>

## Parse subcommand from $ARGUMENTS

### list
```bash
git worktree list
```
Use the `brain_context` MCP tool with: `{ "action": "list", "scope": "worktree" }` — returns all worktree context entries ordered by updated_at descending.
Show all worktrees with path, branch, status (active/complete), and task counts.

### create <task description or name>

**Step 1: Smart branch name suggestion**

Detect intent prefix from the input:
- fix/bug/broken/error/crash → `fix/`
- refactor/clean/simplify/extract → `refactor/`
- add/create/build/implement/new/feat → `feat/`
- update/upgrade/migrate/bump/chore → `chore/`
- test/spec/coverage → `test/`
- docs/readme/document → `docs/`
- Default (no match) → `feat/`

Generate branch name:
1. Extract the intent prefix
2. Strip the intent keyword + filler words (the, a, an, for, with, and, to, in, on)
3. Lowercase, hyphenate remaining words
4. Truncate to 40 chars total

Examples:
- `add user authentication` → `feat/user-authentication`
- `fix payment webhook timeout` → `fix/payment-webhook-timeout`
- `refactor database layer` → `refactor/database-layer`
- `update dependencies` → `chore/dependencies`

**Step 2: Ask user to confirm or customize**

Use AskUserQuestion:
```
Branch name for this worktree?
  a) feat/user-authentication (Recommended)
  b) Enter custom name
```

**Step 3: Multi-repo check**

Query brain.db for linked repos:

Use the `brain_config` MCP tool with: `{ "action": "get", "key": "linked_repos" }`

If linked repos exist, ask which repos need this worktree (AskUserQuestion):
```
Linked repos detected. Create worktree in:
  a) This repo only (Recommended)
  b) This repo + [linked-repo-name]
  c) All linked repos
```

**Step 4: Create worktree(s)**

For the current repo:
```bash
git worktree add .shipfast/worktrees/[name] -b [branch-name]
mkdir -p .shipfast/worktrees/[name]/.shipfast
ln -sf "$(pwd)/.shipfast/brain.db" .shipfast/worktrees/[name]/.shipfast/brain.db
```

For each selected linked repo:
```bash
git -C [linked-path] worktree add [linked-path]/.shipfast/worktrees/[name] -b [branch-name]
```

**Step 5: Store metadata**

Use the `brain_context` MCP tool with: `{ "action": "set", "id": "worktree:[name]", "scope": "worktree", "key": "[name]", "value": "{\"status\":\"active\",\"branch\":\"[branch-name]\",\"path\":\".shipfast/worktrees/[name]\",\"repos\":[\".\"],\"created\":\"[timestamp]\"}" }`

**Step 6: Report**
```
Worktree created.
  Name:   [name]
  Branch: [branch-name]
  Path:   .shipfast/worktrees/[name]/

To work in this worktree:
  cd .shipfast/worktrees/[name]
  # Then use /sf-do, /sf-plan, etc. as normal
```

### switch <name>
1. Verify worktree exists:
```bash
[ -d ".shipfast/worktrees/[name]" ] && echo OK || echo MISSING
```
2. If exists, report:
```
Worktree [name] is at: .shipfast/worktrees/[name]/

To work in it:
  cd .shipfast/worktrees/[name]

Or open a new terminal:
  cd [full path]/.shipfast/worktrees/[name]
```
Note: Unlike branches, worktrees don't need `git checkout`. Just `cd` into the directory.

### status <name>
```bash
git -C .shipfast/worktrees/[name] status --short
git -C .shipfast/worktrees/[name] log --oneline -5
```
Use the `brain_tasks` MCP tool with: `{ "action": "list", "phase_contains": "[name]" }` — returns tasks for this worktree ordered by created_at.
Show: uncommitted changes, recent commits, and pending tasks for this worktree.

### check [name]

Structured migration audit comparing worktree branch (or current branch) against the default branch.

If `[name]` is provided, check that worktree's branch. If omitted, check the current branch.

**Step 1: Resolve branches**

Use the `brain_config` MCP tool with: `{ "action": "get", "key": "default_branch" }` — if empty, fall back to `"main"` as `$DEFAULT`.

Get worktree's branch: if `[name]` is provided, use the `brain_context` MCP tool with: `{ "action": "get", "scope": "worktree", "key": "[name]" }` and parse the `branch` field. Otherwise, run `git branch --show-current` to get `$BRANCH`.

**Step 2: Get changed files**
```bash
git diff $DEFAULT...$BRANCH --diff-filter=D --name-only   # deleted files
git diff $DEFAULT...$BRANCH --diff-filter=A --name-only   # added files
git diff $DEFAULT...$BRANCH --diff-filter=M --name-only   # modified files
```

**Step 3: Extract removed symbols**

For each deleted or modified file, compare the default branch version vs worktree version:
```bash
git show $DEFAULT:<file>    # main's version
git show $BRANCH:<file>     # worktree's version (may not exist if deleted)
```

Extract exported symbols from main's version:
- Functions: `export function NAME`, `export const NAME =`, `module.exports.NAME`
- Types: `export type NAME`, `export interface NAME`
- Classes: `export class NAME`
- Fields in types/interfaces: lines inside `interface X { ... }` or `type X = { ... }`

Check which of these are absent from worktree's version.

**Step 4: Classify each removed symbol**

For each symbol removed from main:

1. **Search worktree for the symbol name** (was it moved/renamed?):
```bash
grep -rl "SYMBOL_NAME" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" .
```
   - Found in a DIFFERENT file → **MIGRATED** (show `old_path → new_path`)

2. **Check consumers via brain.db**:

   Use the `brain_search` MCP tool with: `{ "query": "consumers:SYMBOL_NAME kind:imports,calls,depends" }` — returns files that consume the given symbol.

   - Has consumers AND not found elsewhere → **MISSING** (show consumers)
   - Zero consumers AND not found elsewhere → **SAFELY REMOVED**

**Step 5: Detect shape changes**

For modified files that still exist in both branches:
- Extract type/interface field lists from both versions
- Compare fields: which were added, which were removed
- For removed fields, check consumers → **MODIFIED** with consumer count

**Step 6: Collect additions**

All symbols in added files → **ADDED**

**Step 7: Format report**
```
Migration Audit: [BRANCH] vs [DEFAULT]
==========================================

MIGRATED (moved/renamed — present in both)
  ✓ symbolName()             old/path.ts → new/path.ts
  ✓ TypeName                 old/types.ts → new/types.ts

MISSING (removed but still has consumers — ACTION NEEDED)
  ✗ symbolName()             was in: src/file.ts
                             consumers: src/a.ts, src/b.ts
  ✗ Type.fieldName           was in: src/types.ts
                             consumers: src/c.ts

SAFELY REMOVED (removed, zero consumers)
  ○ oldHelper()              was in: src/utils.ts
  ○ TempType                 was in: src/types.ts

MODIFIED (shape changed — REVIEW NEEDED)
  ~ TypeName                 [DEFAULT]: N fields → [BRANCH]: M fields
                             removed fields: fieldA, fieldB
                             consumers to update: K files
  ~ functionName()           signature changed
                             consumers to update: K files

ADDED (new in this branch)
  + NewSymbol                src/new-file.ts
  + AnotherSymbol            src/another.ts

Summary
  Migrated:       N
  Missing:        N  ← ACTION NEEDED
  Safely removed: N
  Modified:       N  ← REVIEW NEEDED
  Added:          N
```

### complete <name>
1. Check for uncommitted changes:
```bash
git -C .shipfast/worktrees/[name] status --porcelain
```
If dirty, warn: "Worktree has uncommitted changes. Commit or stash first."

2. **Auto-run migration audit** before merging:
Run the `check` steps above. If MISSING items found, warn:
```
Warning: [N] missing items with active consumers. Merge anyway?
  a) Yes, merge (I handled these separately)
  b) No, go back and fix
```

3. Get the default branch:

   Use the `brain_config` MCP tool with: `{ "action": "get", "key": "default_branch" }` — if empty, fall back to `"main"` as `$DEFAULT`.

4. Ask: "Merge [branch] into $DEFAULT and remove worktree? [y/n]"

5. If yes, also check multi-repo:

   Use the `brain_context` MCP tool with: `{ "action": "get", "id": "worktree:[name]" }` — parse the `repos` field from the returned value.

For current repo:
```bash
git checkout $DEFAULT
git merge [branch-name]
git worktree remove .shipfast/worktrees/[name]
git branch -d [branch-name]
```

For each linked repo in metadata:
```bash
git -C [linked-path] checkout $DEFAULT
git -C [linked-path] merge [branch-name]
git -C [linked-path] worktree remove [linked-path]/.shipfast/worktrees/[name]
git -C [linked-path] branch -d [branch-name]
```

6. Update brain.db:

   Use the `brain_context` MCP tool with: `{ "action": "set", "id": "worktree:[name]", "scope": "worktree", "key": "[name]", "value": "<previous value with 'active' replaced by 'complete'>" }`

7. Report: `Worktree [name] merged into $DEFAULT and removed.`

</process>

<context>
$ARGUMENTS
</context>
