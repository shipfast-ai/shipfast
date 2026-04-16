/**
 * ShipFast Token Budget System
 *
 * Tracks token spending per session/agent.
 * Gracefully degrades when budget runs low.
 * Prevents runaway token consumption.
 */

const brain = require('../brain/index.cjs');
const { BUDGET, DEFAULT_MODEL } = require('./constants.cjs');

// ============================================================
// Budget check + degradation
// ============================================================

function checkBudget(cwd, sessionId, agent, estimatedCost) {
  const budget = brain.getTokenBudget(cwd);
  const used = brain.getTokensUsed(cwd, sessionId);
  const remaining = budget - used;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `Token budget exhausted (${used}/${budget}). Use /config token-budget <amount> to increase.`,
      remaining: 0,
      degraded: true
    };
  }

  if (remaining < estimatedCost) {
    // Degrade: suggest cheaper approach
    const degradation = suggestDegradation(agent, remaining);
    return {
      allowed: true,
      reason: `Budget low (${remaining} remaining). ${degradation.message}`,
      remaining,
      degraded: true,
      suggestion: degradation
    };
  }

  return { allowed: true, remaining, degraded: false };
}

function suggestDegradation(agent, remaining) {
  if (remaining < BUDGET.CRITICAL) {
    return {
      message: 'Only enough for a simple edit. Skipping review.',
      skipAgents: ['critic', 'scribe'],
      useModel: 'haiku'
    };
  }

  if (remaining < BUDGET.WARNING) {
    return {
      message: 'Switching to lightweight mode.',
      skipAgents: ['scribe'],
      useModel: 'haiku'
    };
  }

  if (remaining < BUDGET.COMFORTABLE) {
    return {
      message: 'Using fast models for non-critical agents.',
      skipAgents: [],
      useModel: agent === 'builder' ? 'sonnet' : 'haiku'
    };
  }

  return { message: '', skipAgents: [], useModel: null };
}

// ============================================================
// Usage summary
// ============================================================

function getUsageSummary(cwd, sessionId) {
  const budget = brain.getTokenBudget(cwd);
  const used = brain.getTokensUsed(cwd, sessionId);
  const byAgent = brain.getTokensByAgent(cwd, sessionId);
  const remaining = budget - used;
  const pct = Math.round((used / budget) * 100);

  return {
    budget,
    used,
    remaining,
    percentage: pct,
    byAgent: byAgent.reduce((acc, row) => { acc[row.agent] = row.total; return acc; }, {}),
    status: remaining <= 0 ? 'exhausted' : pct > 80 ? 'critical' : pct > 60 ? 'warning' : 'ok'
  };
}

// ============================================================
// Model tier resolution
// ============================================================

function resolveModel(cwd, agent) {
  const configKey = `model_tier_${agent}`;
  return brain.getConfig(cwd, configKey) || getDefaultModel(agent);
}

function getDefaultModel(agent) {
  return DEFAULT_MODEL[agent] || 'sonnet';
}

module.exports = {
  checkBudget,
  suggestDegradation,
  getUsageSummary,
  resolveModel,
  getDefaultModel
};
