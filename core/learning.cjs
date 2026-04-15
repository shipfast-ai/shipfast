/**
 * ShipFast Learning System
 *
 * Self-improving memory. Records failure patterns and solutions.
 * Confidence increases with successful reuse, decays with time.
 * Auto-prunes low-value memories.
 */

const brain = require('../brain/index.cjs');

function recordFailure(cwd, { taskId, error, domain, pattern }) {
  // Check if we already know this pattern
  const existing = brain.findLearnings(cwd, domain, 10);
  const match = existing.find(l =>
    l.pattern === pattern ||
    (l.problem && error && l.problem.includes(error.slice(0, 50)))
  );

  if (match) {
    // Already known — boost if it has a solution
    if (match.solution) {
      brain.boostLearning(cwd, match.id);
      return { known: true, solution: match.solution, confidence: match.confidence };
    }
    return { known: true, solution: null };
  }

  // New failure — record it
  const autoPattern = pattern || derivePattern(error, domain);
  brain.addLearning(cwd, {
    pattern: autoPattern,
    problem: (error || '').slice(0, 200),
    solution: null,
    domain,
    source: 'auto'
  });

  return { known: false, pattern: autoPattern };
}

function recordSolution(cwd, { pattern, solution, domain }) {
  // Try to find and update existing learning
  const existing = brain.findLearnings(cwd, domain, 20);
  const match = existing.find(l => l.pattern === pattern);

  if (match) {
    brain.run(cwd, `UPDATE learnings SET solution = '${brain.esc(solution)}', confidence = MIN(confidence + 0.2, 1.0) WHERE id = ${match.id}`);
    return { updated: true };
  }

  // New learning
  brain.addLearning(cwd, {
    pattern,
    problem: '',
    solution,
    domain,
    source: 'user'
  });

  return { created: true };
}

function getRelevantLearnings(cwd, { domain, intent, affectedFiles }) {
  const learnings = [];

  // By domain
  if (domain) {
    learnings.push(...brain.findLearnings(cwd, domain, 3));
  }

  // By intent (e.g., "fix" intent might match "debugging" learnings)
  const intentDomainMap = {
    fix: ['debugging', 'error-handling'],
    feature: ['architecture', 'patterns'],
    refactor: ['patterns', 'code-quality'],
    test: ['testing', 'mocking'],
    perf: ['performance', 'caching'],
    security: ['security', 'auth'],
    data: ['database', 'migrations']
  };

  const relatedDomains = intentDomainMap[intent] || [];
  for (const d of relatedDomains) {
    const found = brain.findLearnings(cwd, d, 2);
    learnings.push(...found.filter(l => !learnings.find(e => e.id === l.id)));
  }

  return learnings.slice(0, 5);
}

function derivePattern(error, domain) {
  if (!error) return `${domain}-unknown`;

  // Extract key error identifiers
  const patterns = [
    { re: /Cannot find module '([^']+)'/, name: (m) => `missing-module-${m[1].split('/').pop()}` },
    { re: /Property '(\w+)' does not exist/, name: (m) => `missing-property-${m[1]}` },
    { re: /Type '(\w+)' is not assignable/, name: (m) => `type-mismatch-${m[1]}` },
    { re: /(\w+) is not defined/, name: (m) => `undefined-${m[1]}` },
    { re: /ENOENT.*'([^']+)'/, name: (m) => `file-not-found` },
    { re: /ECONNREFUSED/, name: () => `connection-refused` },
    { re: /timeout/i, name: () => `timeout` },
    { re: /permission denied/i, name: () => `permission-denied` },
  ];

  for (const { re, name } of patterns) {
    const match = error.match(re);
    if (match) return `${domain}-${name(match)}`;
  }

  return `${domain}-error`;
}

function pruneStale(cwd) {
  brain.pruneOldLearnings(cwd, 30);
}

module.exports = {
  recordFailure,
  recordSolution,
  getRelevantLearnings,
  derivePattern,
  pruneStale
};
