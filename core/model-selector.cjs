/**
 * ShipFast Model Selector — Confidence-Based Model Selection (P7)
 *
 * Instead of fixed model tiers, dynamically select the cheapest model
 * that can handle the task. Haiku is ~10x cheaper than Sonnet.
 *
 * 40-60% of Builder calls can use Haiku when patterns are known.
 */

const brain = require('../brain/index.cjs');
const { CONFIDENCE, DEFAULT_MODEL, MODEL_COST } = require('./constants.cjs');

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
  // Complex multi-area tasks with no prior patterns → Opus
  // Opus costs 25x but is used rarely; pays for itself in fewer revision cycles
  if (task.complexity === 'complex' && task.areas && task.areas.length > 3) {
    if (task.domain) {
      const learnings = brain.findLearnings(cwd, task.domain, 3);
      const highConfidence = learnings.filter(l => l.confidence > CONFIDENCE.HIGH && l.solution);
      if (highConfidence.length === 0) {
        return 'opus'; // uncharted territory + complex = worth the cost
      }
    } else {
      return 'opus'; // no domain = no learnings = needs best reasoning
    }
    return 'sonnet';
  }

  // Complex but fewer areas → Sonnet
  if (task.complexity === 'complex') {
    return 'sonnet';
  }

  // If we have a good template match, Haiku can fill it in
  if (task.intent && ['fix', 'remove', 'docs', 'style', 'test'].includes(task.intent)) {
    return 'haiku';
  }

  return 'sonnet';
}

function selectBuilderModel(cwd, task) {
  // Check feedback loop: if haiku failed recently for this domain, upgrade
  if (task.domain) {
    const stats = getModelSuccessRate(cwd, 'builder', task.domain);
    if (stats.haikuRate !== null && stats.haikuRate < 0.6) {
      return 'sonnet'; // haiku struggling in this domain → upgrade
    }
    if (stats.sonnetRate !== null && stats.sonnetRate > 0.9 && stats.sonnetTotal >= 3) {
      // Sonnet consistently succeeds here → try haiku next time to save cost
      return 'haiku';
    }
  }

  // Key insight: if we've solved similar problems before, Haiku can replicate
  if (task.domain) {
    const learnings = brain.findLearnings(cwd, task.domain, 3);
    const highConfidence = learnings.filter(l => l.confidence > CONFIDENCE.HIGH && l.solution);
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

/**
 * Get model success rate for an agent+domain combo from the feedback table.
 * Returns { haikuRate, sonnetRate, haikuTotal, sonnetTotal } (null if no data).
 */
function getModelSuccessRate(cwd, agent, domain) {
  const rows = brain.query(cwd,
    `SELECT model, outcome, COUNT(*) as c FROM model_performance
     WHERE agent = '${brain.esc(agent)}' AND domain = '${brain.esc(domain)}'
     GROUP BY model, outcome`
  );

  const stats = { haikuRate: null, sonnetRate: null, haikuTotal: 0, sonnetTotal: 0 };
  const haikuSuccess = rows.find(r => r.model === 'haiku' && r.outcome === 'success');
  const haikuFailure = rows.find(r => r.model === 'haiku' && r.outcome === 'failure');
  const sonnetSuccess = rows.find(r => r.model === 'sonnet' && r.outcome === 'success');
  const sonnetFailure = rows.find(r => r.model === 'sonnet' && r.outcome === 'failure');

  const hS = haikuSuccess ? haikuSuccess.c : 0;
  const hF = haikuFailure ? haikuFailure.c : 0;
  const sS = sonnetSuccess ? sonnetSuccess.c : 0;
  const sF = sonnetFailure ? sonnetFailure.c : 0;

  stats.haikuTotal = hS + hF;
  stats.sonnetTotal = sS + sF;
  if (stats.haikuTotal > 0) stats.haikuRate = hS / stats.haikuTotal;
  if (stats.sonnetTotal > 0) stats.sonnetRate = sS / stats.sonnetTotal;

  return stats;
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
  return MODEL_COST[model] || MODEL_COST.sonnet;
}

module.exports = {
  selectModel,
  costMultiplier
};
