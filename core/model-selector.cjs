/**
 * ShipFast Model Selector — Confidence-Based Model Selection (P7)
 *
 * Instead of fixed model tiers, dynamically select the cheapest model
 * that can handle the task. Haiku is ~10x cheaper than Sonnet.
 *
 * 40-60% of Builder calls can use Haiku when patterns are known.
 */

const brain = require('../brain/index.cjs');

/**
 * Select the optimal model for an agent + task combination.
 * Returns: 'haiku' | 'sonnet' | 'opus'
 */
function selectModel(cwd, agent, task) {
  // Check user override first
  const override = brain.getConfig(cwd, `model_tier_${agent}`);
  if (override && override !== 'auto') return override;

  // Agent-specific selection
  switch (agent) {
    case 'scout':
      return selectScoutModel(cwd, task);
    case 'architect':
      return selectArchitectModel(cwd, task);
    case 'builder':
      return selectBuilderModel(cwd, task);
    case 'critic':
      return selectCriticModel(cwd, task);
    case 'scribe':
      return 'haiku'; // always cheap
    default:
      return 'sonnet';
  }
}

function selectScoutModel(cwd, task) {
  // Scout just reads files — Haiku is fine for 95% of cases
  return 'haiku';
}

function selectArchitectModel(cwd, task) {
  // Complex multi-area tasks need better reasoning
  if (task.complexity === 'complex' && task.areas && task.areas.length > 2) {
    return 'sonnet';
  }

  // If we have a good template match, Haiku can fill it in
  if (task.intent && ['fix', 'remove', 'docs', 'style', 'test'].includes(task.intent)) {
    return 'haiku';
  }

  return 'sonnet';
}

function selectBuilderModel(cwd, task) {
  // Key insight: if we've solved similar problems before, Haiku can replicate
  if (task.domain) {
    const learnings = brain.findLearnings(cwd, task.domain, 3);
    const highConfidence = learnings.filter(l => l.confidence > 0.8 && l.solution);
    if (highConfidence.length >= 2) {
      return 'haiku'; // well-trodden path
    }
  }

  // Single-file, small changes → Haiku
  if (task.affectedFiles && task.affectedFiles.length <= 1 && task.complexity === 'trivial') {
    return 'haiku';
  }

  // Known intent patterns that are straightforward
  if (['fix', 'remove', 'docs', 'style'].includes(task.intent) && task.complexity !== 'complex') {
    return 'haiku';
  }

  // Default: Sonnet for quality
  return 'sonnet';
}

function selectCriticModel(cwd, task) {
  // Security-related reviews need better reasoning
  if (task.intent === 'security' || (task.areas && task.areas.includes('auth'))) {
    return 'sonnet';
  }

  // Everything else: Haiku is great at pattern matching in diffs
  return 'haiku';
}

/**
 * Estimate cost multiplier for a model choice.
 * Haiku = 1x, Sonnet = 5x, Opus = 25x (approximate)
 */
function costMultiplier(model) {
  switch (model) {
    case 'haiku': return 1;
    case 'sonnet': return 5;
    case 'opus': return 25;
    default: return 5;
  }
}

/**
 * Get model recommendations for all agents in a pipeline.
 */
function getModelPlan(cwd, pipeline, task) {
  const plan = {};
  let totalCostUnits = 0;
  let defaultCostUnits = 0;

  const defaultModels = {
    scout: 'haiku',
    architect: 'sonnet',
    builder: 'sonnet',
    critic: 'haiku',
    scribe: 'haiku'
  };

  for (const agent of pipeline) {
    const selected = selectModel(cwd, agent, task);
    const defaultModel = defaultModels[agent] || 'sonnet';

    plan[agent] = {
      model: selected,
      default: defaultModel,
      optimized: selected !== defaultModel
    };

    totalCostUnits += costMultiplier(selected);
    defaultCostUnits += costMultiplier(defaultModel);
  }

  return {
    agents: plan,
    totalCostUnits,
    defaultCostUnits,
    savings: `${Math.round((1 - totalCostUnits/defaultCostUnits) * 100)}% cheaper`
  };
}

module.exports = {
  selectModel,
  costMultiplier,
  getModelPlan
};
