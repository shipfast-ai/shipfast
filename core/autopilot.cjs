/**
 * ShipFast Autopilot — Intent Router + Complexity Estimator
 *
 * Single entry point that replaces GSD's 50+ commands.
 * Rule-based intent classification (zero LLM cost).
 * Auto-selects workflow depth based on complexity.
 */

// ============================================================
// Intent classification (zero tokens — pure regex)
// ============================================================

const INTENT_PATTERNS = {
  fix: /\b(bug|fix|broken|error|crash|fail|issue|wrong|repair|patch|debug|not working)\b/i,
  feature: /\b(add|create|build|implement|new|introduce|setup|set up|integrate|enable|support)\b/i,
  refactor: /\b(refactor|clean|simplify|extract|reorganize|restructure|deduplicate|dry up|consolidate)\b/i,
  upgrade: /\b(update|upgrade|migrate|bump|version|deprecat)/i,
  remove: /\b(remove|delete|drop|deprecate|kill|strip|disable)\b/i,
  test: /\b(test|spec|coverage|assert|mock|stub|e2e|unit test|integration test)\b/i,
  docs: /\b(document|readme|comment|jsdoc|explain|describe|annotate)\b/i,
  ship: /\b(deploy|ship|release|push|pr|pull request|merge|publish)\b/i,
  perf: /\b(optimi[zs]e|performance|speed|fast|slow|cache|lazy|profile|benchmark)\b/i,
  security: /\b(security|vulnerab|auth|permission|sanitize|escape|inject|xss|csrf|encrypt)\b/i,
  style: /\b(style|css|theme|color|layout|responsive|ui|ux|design|animate|tailwind)\b/i,
  data: /\b(database|migration|schema|model|query|sql|table|column|index|seed)\b/i,
  review: /\b(review|check|audit|inspect|look at|examine)\b/i,
};

function classifyIntent(input) {
  const scores = {};
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matches = input.match(pattern);
    if (matches) {
      scores[intent] = (scores[intent] || 0) + matches.length;
    }
  }

  if (Object.keys(scores).length === 0) return 'auto';
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ============================================================
// Complexity estimation (zero tokens — heuristic)
// ============================================================

function estimateComplexity(input) {
  const words = input.trim().split(/\s+/).length;
  const conjunctions = (input.match(/\b(and|also|plus|with|then|after that|additionally)\b/gi) || []).length;
  const areas = detectAreas(input);
  const hasMultiFile = /\b(across|multiple|all|every|each)\b/i.test(input);
  const hasNewSystem = /\b(system|architecture|framework|infrastructure|pipeline|workflow)\b/i.test(input);

  let score = 0;

  if (words < 10) score += 1;
  else if (words < 25) score += 2;
  else if (words < 50) score += 3;
  else score += 4;

  score += conjunctions;
  score += Math.max(0, areas.length - 1);
  if (hasMultiFile) score += 2;
  if (hasNewSystem) score += 2;

  if (score <= 2) return 'trivial';
  if (score <= 5) return 'medium';
  return 'complex';
}

function detectAreas(input) {
  const AREAS = {
    frontend: /\b(component|react|ui|css|style|page|view|layout|form|button|modal|dialog)\b/i,
    backend: /\b(api|endpoint|route|handler|server|middleware|controller|worker)\b/i,
    database: /\b(database|db|table|migration|schema|model|query|sql|postgres|mysql|sqlite)\b/i,
    auth: /\b(auth|login|signup|session|token|jwt|oauth|permission|role)\b/i,
    infra: /\b(deploy|ci|cd|docker|k8s|config|env|build|bundle|webpack|vite)\b/i,
    testing: /\b(test|spec|mock|stub|fixture|coverage|e2e|cypress|playwright)\b/i,
    ai: /\b(ai|ml|llm|embedding|vector|prompt|model|openai|claude|gpt)\b/i,
    payment: /\b(payment|billing|stripe|subscription|checkout|invoice|price)\b/i,
  };

  return Object.entries(AREAS)
    .filter(([_, pattern]) => pattern.test(input))
    .map(([area]) => area);
}

// ============================================================
// Workflow selection
// ============================================================

function selectWorkflow(intent, complexity) {
  if (complexity === 'trivial') {
    return {
      name: 'direct',
      steps: ['builder'],
      description: 'Direct execution - no planning overhead',
      estimatedTokens: '2K-5K'
    };
  }

  if (complexity === 'medium') {
    return {
      name: 'quick',
      steps: ['scout', 'architect', 'builder', 'critic'],
      description: 'Quick plan then execute with review',
      estimatedTokens: '10K-20K'
    };
  }

  return {
    name: 'full',
    steps: ['scout', 'architect', 'builder', 'critic', 'scribe'],
    description: 'Full pipeline: research, plan, execute, review, document',
    estimatedTokens: '40K-80K'
  };
}

// ============================================================
// Domain extraction (for learning lookup)
// ============================================================

function extractDomain(input) {
  const areas = detectAreas(input);
  return areas.length > 0 ? areas[0] : 'general';
}

// ============================================================
// Affected files heuristic
// ============================================================

function guessAffectedFiles(input) {
  const files = [];
  const pathRe = /(?:^|\s)([\w./\\-]+\.(?:ts|tsx|js|jsx|rs|py|go|css|html|json))\b/g;
  let match;
  while ((match = pathRe.exec(input)) !== null) {
    files.push(match[1]);
  }
  return files;
}

// ============================================================
// Main autopilot
// ============================================================

function analyze(input) {
  const intent = classifyIntent(input);
  const complexity = estimateComplexity(input);
  const workflow = selectWorkflow(intent, complexity);
  const domain = extractDomain(input);
  const affectedFiles = guessAffectedFiles(input);
  const areas = detectAreas(input);

  return { input, intent, complexity, workflow, domain, areas, affectedFiles };
}

module.exports = {
  classifyIntent,
  estimateComplexity,
  detectAreas,
  selectWorkflow,
  extractDomain,
  guessAffectedFiles,
  analyze
};
