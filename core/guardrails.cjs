/**
 * ShipFast Quality Guardrails (Phase 7)
 *
 * The features that make ShipFast BETTER than GSD:
 * 1. Token-aware quality scaling
 * 2. Learning-accelerated execution
 * 3. Predictive context loading
 * 4. Progressive disclosure
 */

'use strict';

const brain = require('../brain/index.cjs');
const skipLogic = require('./skip-logic.cjs');
const modelSelector = require('./model-selector.cjs');

// ============================================================
// 1. Token-aware quality scaling
// ============================================================

/**
 * Adjust pipeline quality based on remaining token budget.
 * High budget = thorough. Low budget = essential only.
 */
function adjustForBudget(cwd, sessionId, pipeline, task) {
  const budget = brain.getTokenBudget(cwd);
  const used = brain.getTokensUsed(cwd, sessionId);
  const remainingPct = Math.round(((budget - used) / budget) * 100);

  const adjustments = { pipeline: [...pipeline], models: {}, notes: [] };

  if (remainingPct > 60) {
    // Full quality — no adjustments
    return adjustments;
  }

  if (remainingPct > 40) {
    // Conserve: skip scribe, use haiku for critic
    adjustments.pipeline = pipeline.filter(a => a !== 'scribe');
    adjustments.models.critic = 'haiku';
    adjustments.notes.push('Budget at ' + remainingPct + '% — skipping scribe, using haiku for review');
    return adjustments;
  }

  if (remainingPct > 20) {
    // Minimal: skip scribe + critic, haiku for all
    adjustments.pipeline = pipeline.filter(a => a !== 'scribe' && a !== 'critic');
    adjustments.models.scout = 'haiku';
    adjustments.models.architect = 'haiku';
    adjustments.models.builder = 'haiku';
    adjustments.notes.push('Budget at ' + remainingPct + '% — minimal pipeline, all haiku');
    return adjustments;
  }

  // Emergency: builder only, haiku
  adjustments.pipeline = ['builder'];
  adjustments.models.builder = 'haiku';
  adjustments.notes.push('Budget at ' + remainingPct + '% — emergency mode, builder only');
  return adjustments;
}

// ============================================================
// 2. Learning-accelerated execution
// ============================================================

/**
 * Determine how much of the pipeline to skip based on learned patterns.
 *
 * First time doing X: full pipeline (scout + architect + builder + critic)
 * Second time: skip scout + architect (we know the pattern)
 * Third time: skip critic too (high confidence)
 */
function accelerateFromLearnings(cwd, task, pipeline) {
  if (!task.domain) return { pipeline, acceleration: 'none' };

  const learnings = brain.findLearnings(cwd, task.domain, 5);
  if (!learnings.length) return { pipeline, acceleration: 'none' };

  const highConfidence = learnings.filter(l => l.confidence > 0.8 && l.solution);
  const mediumConfidence = learnings.filter(l => l.confidence > 0.5 && l.solution);

  if (highConfidence.length >= 3) {
    // Well-known territory — skip everything except builder
    const accelerated = pipeline.filter(a => a === 'builder');
    return {
      pipeline: accelerated,
      acceleration: 'maximum',
      reason: highConfidence.length + ' high-confidence learnings for ' + task.domain
    };
  }

  if (mediumConfidence.length >= 2) {
    // Familiar territory — skip scout and architect
    const accelerated = pipeline.filter(a => a !== 'scout' && a !== 'architect');
    return {
      pipeline: accelerated,
      acceleration: 'partial',
      reason: mediumConfidence.length + ' medium-confidence learnings for ' + task.domain
    };
  }

  return { pipeline, acceleration: 'none' };
}

// ============================================================
// 3. Predictive context loading
// ============================================================

/**
 * Use git co-change data to predict additional files the Builder will need.
 * Pre-loads their signatures into context, saving Scout work.
 */
function predictiveContext(cwd, affectedFiles) {
  if (!affectedFiles || affectedFiles.length === 0) return [];

  const predictions = [];

  for (const file of affectedFiles) {
    // Query co-change edges from brain.db
    const cochanged = brain.query(cwd, `
      SELECT
        CASE WHEN source = 'file:${brain.esc(file)}' THEN REPLACE(target, 'file:', '')
             ELSE REPLACE(source, 'file:', '') END as related_file,
        weight
      FROM edges
      WHERE kind = 'co_changes'
      AND (source = 'file:${brain.esc(file)}' OR target = 'file:${brain.esc(file)}')
      AND weight > 0.3
      ORDER BY weight DESC
      LIMIT 3
    `);

    for (const row of cochanged) {
      if (!predictions.find(p => p.file === row.related_file)) {
        predictions.push({
          file: row.related_file,
          confidence: row.weight,
          reason: 'co-changes with ' + file
        });
      }
    }
  }

  return predictions.slice(0, 5);
}

/**
 * Build enhanced context with predictions.
 */
function buildPredictiveContext(cwd, task) {
  const predictions = predictiveContext(cwd, task.affectedFiles);

  if (predictions.length === 0) return '';

  const parts = ['<predicted_files>'];
  parts.push('These files often change together with the affected files:');
  for (const p of predictions) {
    const sigs = brain.getSignaturesForFile(cwd, p.file);
    if (sigs.length) {
      parts.push(p.file + ' (confidence: ' + Math.round(p.confidence * 100) + '%):');
      sigs.slice(0, 3).forEach(s => parts.push('  ' + s.kind + ': ' + s.signature));
    }
  }
  parts.push('</predicted_files>');

  return parts.join('\n');
}

// ============================================================
// 4. Progressive disclosure
// ============================================================

/**
 * Determine output verbosity based on complexity.
 */
function getOutputLevel(complexity) {
  switch (complexity) {
    case 'trivial':
      return {
        level: 'minimal',
        showAnalysis: false,
        showPipeline: false,
        showTokens: false,
        showVerification: false,
        reportFormat: 'one_line'
      };
    case 'medium':
      return {
        level: 'standard',
        showAnalysis: true,
        showPipeline: false,
        showTokens: false,
        showVerification: true,
        reportFormat: 'compact'
      };
    case 'complex':
      return {
        level: 'detailed',
        showAnalysis: true,
        showPipeline: true,
        showTokens: true,
        showVerification: true,
        reportFormat: 'full'
      };
    default:
      return { level: 'standard', showAnalysis: true, showPipeline: false, showTokens: false, showVerification: true, reportFormat: 'compact' };
  }
}

/**
 * Format the final report based on output level.
 */
function formatReport(results, outputLevel) {
  if (outputLevel.reportFormat === 'one_line') {
    return 'Done: ' + results.summary;
  }

  if (outputLevel.reportFormat === 'compact') {
    const parts = ['Done: ' + results.summary];
    if (results.commits) parts.push('Commits: ' + results.commits);
    if (results.verification) parts.push('Verification: ' + results.verification);
    return parts.join(' | ');
  }

  // Full report
  const lines = [];
  lines.push('Done: ' + results.summary);
  lines.push('Commits: ' + (results.commits || 0) +
    ' | Tasks: ' + (results.completedTasks || 0) + '/' + (results.totalTasks || 0) +
    ' | Verification: ' + (results.verification || 'N/A'));

  if (outputLevel.showTokens && results.tokensUsed) {
    lines.push('Tokens: ~' + Math.round(results.tokensUsed / 1000) + 'K');
  }

  if (results.deferred && results.deferred.length) {
    lines.push('');
    lines.push('Deferred:');
    results.deferred.forEach(d => lines.push('  - ' + d));
  }

  if (results.savedState) {
    lines.push('');
    lines.push('Progress saved. Run /sf-resume to continue in a new session.');
  }

  return lines.join('\n');
}

// ============================================================
// Master guardrail: combine all optimizations
// ============================================================

/**
 * Apply all guardrails to a pipeline.
 * Returns the optimized pipeline with all adjustments.
 */
/**
 * @param {object} [flags] - Composable flags from parseFlags() (--cheap, --quality, etc.)
 */
function applyGuardrails(cwd, sessionId, task, basePipeline, flags = {}) {
  // 1. Skip logic (brain.db knowledge)
  let pipeline = skipLogic.getAgentPipeline(cwd, task, flags);

  // 2. Learning acceleration
  const accel = accelerateFromLearnings(cwd, task, pipeline);
  pipeline = accel.pipeline;

  // 3. Budget adjustment
  const budgetAdj = adjustForBudget(cwd, sessionId, pipeline, task);
  pipeline = budgetAdj.pipeline;

  // 4. Model selection for each agent
  const models = {};
  for (const agent of pipeline) {
    models[agent] = budgetAdj.models[agent] || modelSelector.selectModel(cwd, agent, task);
  }

  // 5. Flag overrides (--cheap / --quality take precedence)
  if (flags.cheap) {
    for (const agent of pipeline) {
      models[agent] = 'haiku';
    }
  } else if (flags.quality) {
    for (const agent of pipeline) {
      if (agent === 'architect') {
        models[agent] = task.complexity === 'complex' ? 'opus' : 'sonnet';
      } else if (agent === 'builder') {
        models[agent] = 'sonnet';
      }
    }
  }

  // 6. Output level
  const outputLevel = getOutputLevel(task.complexity);

  // 7. Predictive context
  const predictedContext = buildPredictiveContext(cwd, task);

  return {
    pipeline,
    models,
    outputLevel,
    predictedContext,
    acceleration: accel.acceleration,
    budgetNotes: budgetAdj.notes,
    originalPipeline: basePipeline
  };
}

module.exports = {
  adjustForBudget,
  accelerateFromLearnings,
  predictiveContext,
  buildPredictiveContext,
  getOutputLevel,
  formatReport,
  applyGuardrails
};
