# ShipFast Improvement Roadmap

## Token Waste Analysis: Where GSD Burns Tokens

| GSD Stage | Tokens Burned | Root Cause |
|---|---|---|
| `/gsd-discuss-phase` pre-work | 7K-26K | Loads PROJECT.md + REQUIREMENTS.md + STATE.md + codebase scout BEFORE asking a single question |
| Planner system prompt | 12.2K | Redundant rules stated 3x, narrative prose instead of tables |
| Executor system prompt | 8.5K | Loaded per-plan (6 plans = 51K just in prompts) |
| Verifier agent | 5K-10K | Re-reads all PLANs + SUMMARYs already processed |
| Discussion (4-8 questions) | 10K-20K | Multi-turn conversation with full context reload each turn |
| Execute phase orchestrator | 10K-15K | Maintains full phase state + dispatches 7+ agents |
| **Total per feature** | **95K-150K** | |

## Improvements (Priority Order)

---

### P0: Diff-Streaming Execution (saves ~40K tokens)

**Problem**: GSD spawns a fresh executor agent per plan. Each gets the full workflow prompt (8.5K) + loads REQUIREMENTS.md + STATE.md + PLAN.md. For 6 plans = 51K in system prompts alone.

**Solution**: Stream execution inline. Don't spawn separate executor agents for simple/medium tasks.

```
TRIVIAL: Builder runs inline in main context (0 agent overhead)
MEDIUM:  Builder runs as 1 agent with ALL tasks batched (1x prompt cost)
COMPLEX: Builder runs per-wave, not per-task (wave cost, not task cost)
```

**Implementation**:
- Add `core/executor.cjs` — batch task runner
- `/sf-do` for trivial/medium: execute inline, no agent spawn
- `/sf-do` for complex: spawn 1 Builder per wave with all wave tasks concatenated
- Each Builder gets: base prompt (200 tokens) + brain context (~500 tokens) + task list

**Token math**:
- GSD: 6 tasks × 8.5K prompt = 51K
- ShipFast: 1 agent × 200 base + 500 context + 2K tasks = 2.7K
- **Savings: ~48K tokens per feature**

---

### P1: Lazy Context Loading (saves ~15K tokens)

**Problem**: GSD loads REQUIREMENTS.md + STATE.md + PROJECT.md + CONTEXT.md upfront for every operation. Most of it is irrelevant to the current task.

**Solution**: Never load full files. Query brain.db for ONLY relevant rows.

**Implementation**:
- Enhance `buildAgentContext()` in `brain/index.cjs`:
  - Add `getRequirements(cwd, phase)` — returns only requirements tagged to this phase
  - Add `getTechStack(cwd)` — returns one-liner tech stack summary
  - Add `getConventions(cwd, fileType)` — returns conventions for .ts vs .rs vs .py
- Add `brain/context-builder.cjs` — smart context assembly:
  ```
  function buildContext(task) {
    if (task.complexity === 'trivial') return '';  // zero context
    if (task.complexity === 'medium') return decisionsOnly();  // ~200 tokens
    return fullContext();  // ~800 tokens (still 10x less than GSD)
  }
  ```

**Token math**:
- GSD: loads ~5K-15K of markdown per agent
- ShipFast: queries ~200-800 tokens of targeted context
- **Savings: ~10-15K per feature**

---

### P2: Pre-Computed Plan Templates (saves ~8K tokens)

**Problem**: GSD's Architect/Planner spends ~12K tokens figuring out HOW to plan, reading anti-patterns, format templates, etc.

**Solution**: Pre-compute plan templates based on intent. The Architect only fills in the specifics.

**Implementation**:
- Add `brain/templates.cjs` — intent-to-template mapping:
  ```javascript
  const TEMPLATES = {
    fix: {
      steps: ['locate bug', 'write fix', 'add test', 'verify'],
      typical_files: 1-3,
      needs_scout: false  // for simple fixes, skip research
    },
    feature: {
      steps: ['define interface', 'implement', 'wire up', 'test'],
      typical_files: 3-8,
      needs_scout: true
    },
    refactor: {
      steps: ['identify pattern', 'extract', 'update callers', 'verify'],
      typical_files: 2-5,
      needs_scout: true
    }
  };
  ```
- Architect receives pre-filled template → only needs to fill file paths and specifics
- **Reduces Architect prompt from ~5K to ~1.5K tokens**

---

### P3: Incremental Indexer with Batch SQL (10x faster indexing)

**Problem**: Current indexer calls sqlite3 CLI per-insert. 815 files = 815+ subprocess calls = 49 seconds.

**Solution**: Batch all inserts into a single SQL transaction.

**Implementation**:
- Rewrite `indexer.cjs` to collect all INSERTs in memory
- Write one big `.sql` file with `BEGIN TRANSACTION; ... COMMIT;`
- Single `sqlite3` call
- **Expected: 815 files in ~3-5 seconds instead of 49 seconds**

Also add:
- `--changed-only` flag: only re-index git-dirty files
- `git diff --name-only HEAD~1` to detect changed files
- Incremental mode: ~100ms for typical edit-save-index cycle

---

### P4: Smart Skip Logic (saves ~20K tokens on trivial tasks)

**Problem**: Even with complexity detection, we still spawn Scout for medium tasks. Many medium tasks don't need research.

**Solution**: Skip agents based on brain.db knowledge.

**Implementation**:
- Add `core/skip-logic.cjs`:
  ```javascript
  function shouldSkipScout(cwd, task) {
    // Skip if all affected files are already indexed in brain.db
    const indexed = brain.query(cwd, `SELECT COUNT(*) as c FROM nodes
      WHERE file_path IN (${task.affectedFiles.map(f => `'${f}'`)})`);
    if (indexed[0].c === task.affectedFiles.length) return true;

    // Skip if we have recent learnings for this domain
    const learnings = brain.findLearnings(cwd, task.domain);
    if (learnings.length >= 2 && learnings[0].confidence > 0.7) return true;

    return false;
  }

  function shouldSkipArchitect(task) {
    // Single-file changes don't need planning
    if (task.affectedFiles.length <= 1) return true;
    // Known patterns don't need planning
    if (task.template && task.template.confidence > 0.8) return true;
    return false;
  }

  function shouldSkipCritic(task) {
    // Trivial changes (< 20 lines) don't need review
    if (task.estimatedLines < 20) return true;
    // Documentation-only changes
    if (task.intent === 'docs') return true;
    return false;
  }
  ```

**Token math**:
- Medium task with all skips: Builder only = ~5K tokens
- Medium task no skips: Scout + Architect + Builder + Critic = ~18K tokens
- **Savings: ~13K per qualifying task**

---

### P5: Conversation Compression (saves ~10K on multi-turn)

**Problem**: Multi-turn conversations reload full context each turn. If user asks 3 follow-up questions, that's 3x context loading.

**Solution**: Compress conversation history into brain.db between turns.

**Implementation**:
- Add `core/conversation.cjs`:
  ```javascript
  function compressHistory(messages) {
    // Keep only: user requests + final decisions + errors
    // Drop: intermediate exploration, rejected approaches, thinking
    return messages.filter(m =>
      m.role === 'user' ||
      m.type === 'decision' ||
      m.type === 'error'
    ).map(m => ({
      role: m.role,
      content: m.content.slice(0, 200)  // truncate to 200 chars
    }));
  }
  ```
- Store compressed history in brain.db `context` table
- On next turn: load compressed history (~500 tokens) instead of full transcript (~5K tokens)

---

### P6: Parallel Wave Execution with Shared Context

**Problem**: GSD spawns separate agents for parallel tasks. Each agent loads its own context independently.

**Solution**: For tasks in the same wave, share a single context load.

**Implementation**:
- Add `core/wave-executor.cjs`:
  ```javascript
  function executeWave(cwd, tasks) {
    // Build context ONCE for the wave
    const sharedContext = brain.buildAgentContext(cwd, {
      affectedFiles: tasks.flatMap(t => t.affectedFiles),
      phase: tasks[0].phase,
      domain: tasks[0].domain
    });

    // Each Builder task gets: shared context + its specific task description
    // NOT: independent context per task
    return tasks.map(task => ({
      agent: 'builder',
      prompt: sharedContext + '\n\nTask: ' + task.description
    }));
  }
  ```

**Token math**:
- GSD: 3 parallel tasks × 8K context = 24K
- ShipFast: 1 shared context (1K) + 3 task descriptions (1K each) = 4K
- **Savings: ~20K per wave**

---

### P7: Confidence-Based Model Selection (saves ~30% cost)

**Problem**: Fixed model tiers waste money. Haiku can handle many tasks that currently use Sonnet.

**Solution**: Dynamic model selection based on task confidence.

**Implementation**:
- Add `core/model-selector.cjs`:
  ```javascript
  function selectModel(agent, task) {
    // If we have high-confidence learnings for this pattern → Haiku
    if (task.learningConfidence > 0.8) return 'haiku';

    // If task matches a known template exactly → Haiku
    if (task.templateMatch > 0.9) return 'haiku';

    // If task touches < 2 files and is a known pattern → Haiku
    if (task.affectedFiles.length < 2 && task.intent !== 'feature') return 'haiku';

    // Complex reasoning needed → Sonnet
    if (task.complexity === 'complex') return 'sonnet';

    // Default per-agent
    return getDefaultModel(agent);
  }
  ```

**Impact**: 40-60% of Builder calls could use Haiku instead of Sonnet. Haiku is ~10x cheaper.

---

### P8: Git-Aware Change Prediction

**Problem**: Scout reads code to understand what needs to change. But git history already tells us patterns.

**Solution**: Use git log to predict which files will change together.

**Implementation**:
- Add `brain/git-intel.cjs`:
  ```javascript
  function predictRelatedFiles(cwd, changedFile) {
    // Files that historically change together
    const cochanged = brain.query(cwd, `
      SELECT h2.file_path, COUNT(*) as freq
      FROM hot_files h1
      JOIN hot_files h2 ON h1.last_changed = h2.last_changed
      WHERE h1.file_path = '${changedFile}'
      AND h2.file_path != h1.file_path
      ORDER BY freq DESC LIMIT 5
    `);
    return cochanged;
  }
  ```
- Enhance `hot_files` table: store commit-level co-change data
- Scout uses predictions to narrow search scope

---

### P9: Zero-Token Status Tracking

**Problem**: GSD writes STATUS.md after every operation. ShipFast updates brain.db. But reading status still costs tokens.

**Solution**: Status queries should cost ZERO tokens.

**Implementation**:
- `/sf-status` runs entirely via CLI (no LLM call):
  ```javascript
  // In the status command, just query brain.db and format output
  // No agent spawning, no LLM processing
  const tasks = brain.getTasks(cwd);
  const budget = brain.getUsageSummary(cwd, sessionId);
  console.log(formatStatus(tasks, budget));
  ```
- Make status a **hook output**, not a command that uses the LLM

---

### P10: Failure-Aware Retry with Exponential Backoff

**Problem**: When code fails, GSD spawns a debugger agent (fresh context load = ~10K tokens). If it fails again, another debugger.

**Solution**: Retry inline with targeted error context.

**Implementation**:
- Add `core/retry.cjs`:
  ```javascript
  function retryWithContext(cwd, task, error, attempt) {
    if (attempt > 2) return { giveUp: true, error };

    // Don't reload everything. Just inject the error into the existing task.
    const errorContext = `
      Previous attempt failed with: ${error.message.slice(0, 200)}
      File: ${error.file || 'unknown'}
      Line: ${error.line || 'unknown'}
    `;

    // Check if we've seen this before
    const learning = learning.recordFailure(cwd, {
      error: error.message,
      domain: task.domain,
      pattern: learning.derivePattern(error.message, task.domain)
    });

    if (learning.known && learning.solution) {
      // We know the fix! Apply it directly.
      return { retry: true, hint: learning.solution };
    }

    return { retry: true, additionalContext: errorContext };
  }
  ```

**Token math**:
- GSD debugger spawn: ~10K tokens per retry
- ShipFast inline retry: ~500 tokens (error message + hint)
- **Savings: ~9.5K per retry**

---

## Summary: Total Token Savings

| Improvement | Savings per Feature | Effort |
|---|---|---|
| P0: Diff-streaming execution | ~48K | Medium |
| P1: Lazy context loading | ~15K | Low |
| P2: Pre-computed plan templates | ~8K | Low |
| P3: Batch SQL indexer | 0 (speed, not tokens) | Low |
| P4: Smart skip logic | ~13K | Low |
| P5: Conversation compression | ~10K | Medium |
| P6: Parallel wave shared context | ~20K | Medium |
| P7: Confidence-based model selection | ~30% cost reduction | Low |
| P8: Git-aware change prediction | ~5K | Medium |
| P9: Zero-token status | ~2K | Low |
| P10: Failure-aware retry | ~9.5K per retry | Low |

**Conservative total: 80-120K tokens saved per complex feature vs GSD.**
**That's 19K-30K ShipFast vs 95K-150K GSD = 3-5x cheaper.**
