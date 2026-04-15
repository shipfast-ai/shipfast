/**
 * ShipFast Executor — Diff-Streaming Execution Engine (P0)
 *
 * Instead of spawning a fresh agent per task (GSD: 8.5K prompt each),
 * batch tasks into minimal agent calls based on complexity.
 *
 * TRIVIAL: Execute inline (0 agent overhead)
 * MEDIUM:  1 agent with all tasks batched (1x prompt cost)
 * COMPLEX: 1 agent per wave with all wave tasks concatenated
 */

const brain = require('../brain/index.cjs');
const checkpoint = require('./checkpoint.cjs');

/**
 * Build a minimal execution prompt for the Builder agent.
 * GSD: ~8.5K tokens per executor. ShipFast: ~700-1500 tokens.
 */
function buildExecutionPrompt(cwd, tasks, context) {
  const parts = [];

  // Task list (compact)
  parts.push('<tasks>');
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    parts.push(`## Task ${i + 1}: ${t.description}`);
    if (t.files && t.files.length) {
      parts.push(`Files: ${t.files.join(', ')}`);
    }
    if (t.plan_text) {
      parts.push(t.plan_text);
    }
    if (t.verify) {
      parts.push(`Verify: ${t.verify}`);
    }
    parts.push('');
  }
  parts.push('</tasks>');

  // Brain context (lazy-loaded, only relevant data)
  if (context) {
    parts.push(context);
  }

  return parts.join('\n');
}

/**
 * Group tasks into execution waves based on dependencies.
 * Independent tasks go in the same wave (can run in parallel).
 */
function groupIntoWaves(tasks) {
  if (tasks.length <= 1) return [tasks];

  const waves = [];
  const completed = new Set();

  // Simple dependency resolution: tasks with no deps go first
  let remaining = [...tasks];
  let safetyCounter = 0;

  while (remaining.length > 0 && safetyCounter < 20) {
    safetyCounter++;
    const wave = [];
    const nextRemaining = [];

    for (const task of remaining) {
      const deps = task.depends_on || [];
      const allDepsMet = deps.every(d => completed.has(d));
      if (allDepsMet) {
        wave.push(task);
      } else {
        nextRemaining.push(task);
      }
    }

    if (wave.length === 0) {
      // Circular dependency — just run everything
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    for (const t of wave) completed.add(t.id);
    remaining = nextRemaining;
  }

  return waves;
}

/**
 * Build execution plan based on complexity.
 * Returns agent spawn instructions optimized for token efficiency.
 */
function planExecution(cwd, analysis, tasks) {
  const { complexity } = analysis;
  const context = brain.buildAgentContext(cwd, {
    agent: 'builder',
    affectedFiles: tasks.flatMap(t => t.files || []),
    phase: analysis.phase,
    domain: analysis.domain
  });

  if (complexity === 'trivial' || tasks.length === 1) {
    // Single inline execution — no agent spawn overhead
    return {
      mode: 'inline',
      waves: [tasks],
      prompts: [buildExecutionPrompt(cwd, tasks, context)],
      estimatedTokens: 2000 + context.length
    };
  }

  if (complexity === 'medium') {
    // Single agent with all tasks batched
    return {
      mode: 'batched',
      waves: [tasks],
      prompts: [buildExecutionPrompt(cwd, tasks, context)],
      estimatedTokens: 3000 + (tasks.length * 500) + context.length
    };
  }

  // Complex: wave-based execution, shared context per wave
  const waves = groupIntoWaves(tasks);
  const prompts = waves.map(wave => buildExecutionPrompt(cwd, wave, context));

  return {
    mode: 'wave',
    waves,
    prompts,
    estimatedTokens: prompts.reduce((sum, p) => sum + p.length + 2000, 0)
  };
}

/**
 * Record execution results into brain.db
 */
function recordExecution(cwd, taskId, result) {
  if (result.success) {
    checkpoint.afterTask(cwd, taskId, 'passed', result.commitSha);

    // Auto-learn from success if applicable
    if (brain.getConfig(cwd, 'auto_learn') !== 'false') {
      const existing = brain.query(cwd,
        `SELECT id FROM learnings WHERE pattern LIKE '%${brain.esc(result.domain || '')}%' AND solution IS NULL OR solution = '' LIMIT 1`
      );
      // If we had an unsolved learning for this domain, mark it solved
      if (existing.length) {
        brain.run(cwd, `UPDATE learnings SET solution = 'Resolved in task ${brain.esc(taskId)}', confidence = 0.6 WHERE id = ${existing[0].id}`);
      }
    }
  } else {
    checkpoint.afterTask(cwd, taskId, 'failed');
    brain.updateTask(cwd, taskId, { error: (result.error || '').slice(0, 500) });
  }
}

module.exports = {
  buildExecutionPrompt,
  groupIntoWaves,
  planExecution,
  recordExecution
};
