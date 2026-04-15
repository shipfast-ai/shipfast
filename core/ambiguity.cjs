/**
 * ShipFast Ambiguity Detector (Phase 2)
 *
 * Rule-based ambiguity detection — zero LLM cost.
 * Detects WHERE, WHAT, HOW, RISK, and SCOPE ambiguity
 * and generates targeted questions to resolve them.
 */

const brain = require('../brain/index.cjs');

// ============================================================
// Ambiguity detection (zero tokens — pure heuristics)
// ============================================================

const AMBIGUITY_RULES = {
  WHERE: {
    description: 'Location ambiguity — unclear which files/components to change',
    detect: (input, context) => {
      // No file paths, component names, or specific locations mentioned
      const hasFilePath = /[\w./\\-]+\.(ts|tsx|js|jsx|rs|py|go|css|html|json)\b/.test(input);
      const hasComponent = /\b[A-Z][a-z]+[A-Z]\w+\b/.test(input); // PascalCase
      const hasSpecificLocation = /\b(in|at|inside|within)\s+(the\s+)?\w+/.test(input);
      return !hasFilePath && !hasComponent && !hasSpecificLocation;
    },
    questionTemplate: (input) => ({
      type: 'WHERE',
      question: 'Where should this change be made?',
      hint: 'Mention specific files, components, or areas of the codebase.',
      format: 'free_text'
    })
  },

  WHAT: {
    description: 'Behavior ambiguity — unclear what the expected behavior should be',
    detect: (input) => {
      // No specific behavior, output, or result described
      const hasBehavior = /\b(should|must|will|returns?|displays?|shows?|renders?|outputs?|sends?|creates?|stores?)\b/i.test(input);
      const hasCondition = /\b(when|if|unless|after|before|while)\b/i.test(input);
      const isVague = input.split(/\s+/).length < 8;
      return !hasBehavior && !hasCondition && isVague;
    },
    questionTemplate: (input) => ({
      type: 'WHAT',
      question: 'What should the expected behavior be?',
      hint: 'Describe what should happen when this is complete.',
      format: 'free_text'
    })
  },

  HOW: {
    description: 'Approach ambiguity — multiple valid approaches exist',
    detect: (input) => {
      // Mentions alternatives or general concepts without specifying approach
      const hasAlternatives = /\b(or|either|maybe|could|might|possibly|option)\b/i.test(input);
      const isGenericFeature = /\b(add|implement|create|build)\s+(a\s+)?(new\s+)?(auth|cache|search|notification|logging|payment|real.?time)/i.test(input);
      return hasAlternatives || isGenericFeature;
    },
    questionTemplate: (input) => ({
      type: 'HOW',
      question: 'Which approach do you prefer?',
      hint: 'There are multiple ways to implement this.',
      format: 'multiple_choice'
    })
  },

  RISK: {
    description: 'Risk ambiguity — touches sensitive areas that need confirmation',
    detect: (input) => {
      const sensitiveAreas = /\b(auth|login|password|permission|role|token|session|payment|billing|charge|refund|database|migration|schema|delete|drop|remove|destroy|production|deploy)\b/i;
      return sensitiveAreas.test(input);
    },
    questionTemplate: (input) => ({
      type: 'RISK',
      question: 'This touches a sensitive area. Please confirm the scope.',
      hint: 'Changes to auth/payment/data carry higher risk.',
      format: 'confirmation'
    })
  },

  SCOPE: {
    description: 'Scope ambiguity — request is broad or contains multiple features',
    detect: (input) => {
      const words = input.split(/\s+/).length;
      const conjunctions = (input.match(/\b(and|also|plus|with|then|additionally)\b/gi) || []).length;
      return words > 30 && conjunctions >= 2;
    },
    questionTemplate: (input) => ({
      type: 'SCOPE',
      question: 'This request covers multiple things. Should I tackle them all at once, or start with the most important?',
      hint: 'Breaking into phases reduces risk and improves quality.',
      format: 'multiple_choice'
    })
  }
};

/**
 * Detect all ambiguity types in user input.
 * Returns array of { type, description, question } objects.
 * Zero LLM cost — pure regex/heuristic.
 */
function detectAmbiguity(input, context = {}) {
  const ambiguities = [];

  for (const [type, rule] of Object.entries(AMBIGUITY_RULES)) {
    if (rule.detect(input, context)) {
      ambiguities.push({
        type,
        description: rule.description,
        ...rule.questionTemplate(input)
      });
    }
  }

  return ambiguities;
}

/**
 * Calculate ambiguity score (0-1).
 * Used to decide whether to trigger discussion.
 */
function ambiguityScore(input, context = {}) {
  const ambiguities = detectAmbiguity(input, context);
  return ambiguities.length / Object.keys(AMBIGUITY_RULES).length;
}

/**
 * Check if locked decisions already answer the ambiguity.
 * Avoids re-asking questions that were answered in previous sessions.
 */
function filterAlreadyAnswered(cwd, ambiguities) {
  const decisions = brain.getDecisions(cwd);
  return ambiguities.filter(a => {
    // Check if any decision matches this ambiguity type
    const matching = decisions.find(d =>
      d.tags && d.tags.includes(a.type)
    );
    return !matching; // Keep only unanswered ambiguities
  });
}

/**
 * Store user answers as locked decisions in brain.db.
 * These are never asked again.
 */
function lockDecision(cwd, ambiguityType, question, answer, phase) {
  brain.addDecision(cwd, {
    question,
    decision: answer,
    reasoning: 'User-provided via discussion',
    phase: phase || 'discuss',
    tags: ambiguityType
  });
}

/**
 * Should we trigger discussion for this task?
 */
function shouldDiscuss(input, complexity, context = {}) {
  // Never discuss trivial tasks
  if (complexity === 'trivial') return false;

  // Always discuss complex tasks
  if (complexity === 'complex') return true;

  // For medium: discuss only if ambiguity score > 0.4
  const score = ambiguityScore(input, context);
  return score > 0.4;
}

/**
 * Build the discussion prompt for the LLM.
 * This is the ONLY part that costs tokens (~1-2K).
 */
function buildDiscussionPrompt(input, ambiguities, brainContext) {
  const parts = [];

  parts.push(`The user wants to: ${input}\n`);

  if (brainContext) {
    parts.push(`<context>\n${brainContext}\n</context>\n`);
  }

  parts.push('Before planning, clarify these ambiguities:\n');

  for (const a of ambiguities) {
    parts.push(`**${a.type}**: ${a.description}`);
    parts.push(`Question: ${a.question}`);
    if (a.hint) parts.push(`Hint: ${a.hint}`);
    parts.push('');
  }

  parts.push('Ask these questions concisely. Use multiple choice where possible to save user effort.');
  parts.push('After getting answers, store each as a locked decision.');

  return parts.join('\n');
}

module.exports = {
  detectAmbiguity,
  ambiguityScore,
  filterAlreadyAnswered,
  lockDecision,
  shouldDiscuss,
  buildDiscussionPrompt,
  AMBIGUITY_RULES
};
