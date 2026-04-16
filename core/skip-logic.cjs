/**
 * ShipFast Skip Logic — Smart Agent Skipping (P4)
 *
 * Decides which agents to skip based on brain.db knowledge.
 * Saves ~13K tokens per qualifying task by skipping unnecessary agents.
 */

const brain = require('../brain/index.cjs');

/**
 * Should we skip Scout (research agent)?
 * Skip if: all files are indexed AND we have relevant learnings
 * @param {object} [flags] - Composable flags from /sf-do (--research, --discuss, etc.)
 */
function shouldSkipScout(cwd, task, flags = {}) {
  if (!task) return false;

  // --research flag forces Scout to run
  if (flags.research) return false;

  // Always need Scout for complex tasks
  if (task.complexity === 'complex') return false;

  // If no affected files known, Scout might help discover them
  if (!task.affectedFiles || task.affectedFiles.length === 0) return false;

  // Check if all affected files are already indexed
  const fileList = task.affectedFiles.map(f => `'${brain.esc(f)}'`).join(',');
  const indexed = brain.query(cwd,
    `SELECT COUNT(*) as c FROM nodes WHERE file_path IN (${fileList}) AND kind = 'file'`
  );
  const allIndexed = indexed.length && indexed[0].c >= task.affectedFiles.length;

  // Check if we have high-confidence learnings for this domain
  const learnings = brain.findLearnings(cwd, task.domain, 3);
  const hasGoodLearnings = learnings.length >= 1 && learnings[0].confidence > 0.7;

  // Skip if well-known territory
  if (allIndexed && hasGoodLearnings) return true;

  // Skip for fix intent with explicit file paths
  if (task.intent === 'fix' && allIndexed) return true;

  return false;
}

/**
 * Should we skip Architect (planning agent)?
 * Skip if: single-file change OR known template with high confidence
 * @param {object} [flags] - Composable flags from /sf-do
 */
function shouldSkipArchitect(cwd, task, flags = {}) {
  // --no-plan flag skips Architect
  if (flags.noPlan) return true;

  // Never skip for complex tasks
  if (task.complexity === 'complex') return false;

  // Single-file or very few files don't need planning
  if (task.affectedFiles && task.affectedFiles.length <= 1) return true;

  // Fix/remove intents with known files don't need planning
  if (['fix', 'remove', 'docs', 'style'].includes(task.intent)) return true;

  // If task description is very short (<15 words), it's self-explanatory
  if (task.input && task.input.split(/\s+/).length < 15) return true;

  return false;
}

/**
 * Should we skip Critic (review agent)?
 * Skip if: trivial change OR docs-only OR test-only
 * @param {object} [flags] - Composable flags from /sf-do
 */
function shouldSkipCritic(cwd, task, flags = {}) {
  // --verify flag forces Critic to run
  if (flags.verify) return false;
  // Always review complex tasks
  if (task.complexity === 'complex') return false;

  // Trivial tasks don't need review
  if (task.complexity === 'trivial') return true;

  // Docs and style changes don't need security review
  if (['docs', 'style'].includes(task.intent)) return true;

  // Test-only changes are self-verifying
  if (task.intent === 'test') return true;

  return false;
}

/**
 * Should we skip Scribe (documentation agent)?
 * Skip if: trivial/medium OR no new decisions made
 */
function shouldSkipScribe(cwd, task) {
  // Only complex tasks with multiple decisions warrant Scribe
  if (task.complexity !== 'complex') return true;

  return false;
}

/**
 * Parse composable flags from user input.
 * Returns { flags, task } where task is the input with flags stripped.
 */
function parseFlags(input) {
  const flags = {};
  const flagMap = {
    '--discuss': 'discuss',
    '--research': 'research',
    '--verify': 'verify',
    '--tdd': 'tdd',
    '--no-plan': 'noPlan',
    '--cheap': 'cheap',
    '--quality': 'quality'
  };

  let task = input;
  for (const [flag, key] of Object.entries(flagMap)) {
    if (task.includes(flag)) {
      flags[key] = true;
      task = task.replace(flag, '').trim();
    }
  }

  // Clean up extra whitespace
  task = task.replace(/\s+/g, ' ').trim();
  return { flags, task };
}

/**
 * Get the optimized agent pipeline for a task.
 * Returns only the agents that should run.
 * @param {object} [flags] - Composable flags from parseFlags()
 */
function getAgentPipeline(cwd, task, flags = {}) {
  const pipeline = [];

  if (!shouldSkipScout(cwd, task, flags)) {
    pipeline.push('scout');
  }

  if (!shouldSkipArchitect(cwd, task, flags)) {
    pipeline.push('architect');
  }

  // Builder always runs
  pipeline.push('builder');

  if (!shouldSkipCritic(cwd, task, flags)) {
    pipeline.push('critic');
  }

  if (!shouldSkipScribe(cwd, task)) {
    pipeline.push('scribe');
  }

  return pipeline;
}

/**
 * Estimate token savings from skipping.
 */
function estimateSavings(fullPipeline, optimizedPipeline) {
  const agentCosts = {
    scout: 3000,
    architect: 5000,
    builder: 8000,
    critic: 2000,
    scribe: 1000
  };

  const fullCost = fullPipeline.reduce((sum, a) => sum + (agentCosts[a] || 0), 0);
  const optimizedCost = optimizedPipeline.reduce((sum, a) => sum + (agentCosts[a] || 0), 0);

  return {
    fullCost,
    optimizedCost,
    saved: fullCost - optimizedCost,
    pctSaved: Math.round(((fullCost - optimizedCost) / fullCost) * 100)
  };
}

module.exports = {
  parseFlags,
  shouldSkipScout,
  shouldSkipArchitect,
  shouldSkipCritic,
  shouldSkipScribe,
  getAgentPipeline,
  estimateSavings
};
