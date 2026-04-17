/**
 * ShipFast Context Builder — Lazy Context Loading (P1)
 *
 * GSD loads REQUIREMENTS.md + STATE.md + PROJECT.md + CONTEXT.md upfront (~5K-15K tokens).
 * ShipFast queries brain.db for ONLY relevant rows (~200-800 tokens).
 *
 * Three tiers:
 *   ZERO:    trivial tasks get no context (0 tokens)
 *   MINIMAL: decisions + conventions only (~200 tokens)
 *   FULL:    decisions + blast radius + learnings + conventions (~800 tokens)
 */

const brain = require('../brain/index.cjs');

/**
 * Build context based on complexity tier.
 * Returns a string to inject into agent prompts.
 */
function buildContext(cwd, opts = {}) {
  const { complexity, affectedFiles, phase, domain, agent } = opts;

  // ZERO context for trivial tasks
  if (complexity === 'trivial' && (!affectedFiles || affectedFiles.length === 0)) {
    return '';
  }

  // MINIMAL context for trivial tasks with known files, or for cheap agents
  if (complexity === 'trivial' || agent === 'scribe') {
    return buildMinimalContext(cwd, { phase });
  }

  // FULL context for medium/complex
  return buildFullContext(cwd, { affectedFiles, phase, domain, agent });
}

/**
 * Minimal context: just decisions + tech stack (~200 tokens)
 */
function buildMinimalContext(cwd, { phase }) {
  const parts = [];

  const stackBlock = buildStackBlock(cwd);
  if (stackBlock) parts.push(stackBlock);

  const decisions = phase
    ? brain.getDecisions(cwd, phase).slice(0, 3)
    : brain.getDecisions(cwd).slice(0, 3);

  if (decisions.length) {
    parts.push('<decisions>' + decisions.map(d => `\n${d.question} -> ${d.decision}`).join('') + '\n</decisions>');
  }

  return parts.join('\n');
}

// Compact project-stack summary: framework, runtime, package manager, test framework,
// plus top 15 runtime deps with versions. Target: ~150 tokens. Injected into every agent.
function buildStackBlock(cwd) {
  let stack = {};
  try { stack = brain.getProjectStack ? brain.getProjectStack(cwd) : {}; }
  catch { return null; }
  if (!stack || Object.keys(stack).length === 0) return null;

  const lines = [];
  if (stack.framework)       lines.push(`framework: ${stack.framework.label || stack.framework.name || ''} ${stack.framework.version || ''}`.trim());
  if (stack.runtime)         lines.push(`runtime: ${stack.runtime.language || ''} ${stack.runtime.version || ''}`.trim());
  if (stack.package_manager) lines.push(`package_manager: ${typeof stack.package_manager === 'string' ? stack.package_manager : JSON.stringify(stack.package_manager)}`);
  if (stack.test_framework)  lines.push(`test_framework: ${stack.test_framework.name || ''} ${stack.test_framework.version || ''}`.trim());
  if (stack.orm)             lines.push(`orm: ${stack.orm.name || ''} ${stack.orm.version || ''}`.trim());
  if (stack.typescript)      lines.push(`typescript: target=${stack.typescript.target} strict=${stack.typescript.strict}`);
  if (stack.workspace)       lines.push(`workspace: ${stack.workspace.type} packages=[${(stack.workspace.packages || []).slice(0, 5).join(', ')}]`);

  // Top runtime deps for context (just names + versions, capped)
  try {
    const deps = brain.getDependencies ? brain.getDependencies(cwd, { kind: 'runtime', limit: 15 }) : [];
    if (deps.length) {
      const summary = deps.map(d => `${d.name}${d.version ? '@' + d.version.replace(/^[\^~]/, '') : ''}`).join(', ');
      lines.push(`deps: ${summary}`);
    }
  } catch { /* brain missing or no deps table — fall through */ }

  if (!lines.length) return null;
  return '<project_stack>\n' + lines.join('\n') + '\n</project_stack>';
}

/**
 * Full context: decisions + blast radius + learnings + conventions (~800 tokens)
 */
function buildFullContext(cwd, { affectedFiles, phase, domain, agent }) {
  const parts = [];

  // 0. Project stack (framework, runtime, deps) — every agent gets this
  const stackBlock = buildStackBlock(cwd);
  if (stackBlock) parts.push(stackBlock);

  // 1. Decisions (compact)
  const decisions = phase
    ? brain.getDecisions(cwd, phase).slice(0, 5)
    : brain.getDecisions(cwd).slice(0, 5);

  if (decisions.length) {
    parts.push('<decisions>' + decisions.map(d => `\n${d.question} -> ${d.decision}`).join('') + '\n</decisions>');
  }

  // 2. Blast radius (signatures only, not full files)
  if (affectedFiles && affectedFiles.length > 0) {
    const blast = brain.getBlastRadius(cwd, affectedFiles, 2);
    if (blast.length) {
      parts.push('<related_code>' + blast.slice(0, 15).map(n =>
        `\n${n.file_path}: ${n.signature} (${n.kind})`
      ).join('') + '\n</related_code>');
    }
  }

  // 3. Learnings for this domain
  if (domain) {
    const learnings = brain.findLearnings(cwd, domain, 3);
    if (learnings.length) {
      parts.push('<learnings>' + learnings.map(l =>
        `\n${l.pattern}: ${l.solution || l.problem}`
      ).join('') + '\n</learnings>');
    }
  }

  // 4. Conventions (if stored)
  const conventions = brain.getContext(cwd, 'project', 'conventions');
  if (conventions) {
    const conv = typeof conventions === 'string' ? conventions : JSON.stringify(conventions);
    // Truncate to ~200 tokens worth
    parts.push(`<conventions>${conv.slice(0, 800)}</conventions>`);
  }

  // 5. Token budget
  const sessionId = process.env.SF_SESSION_ID || 'default';
  const budget = brain.getTokenBudget(cwd);
  const used = brain.getTokensUsed(cwd, sessionId);
  if (used > budget * 0.5) {
    parts.push(`<budget>Token budget: ${Math.round((used/budget)*100)}% used. Be concise.</budget>`);
  }

  return parts.join('\n');
}

module.exports = {
  buildContext,
  buildMinimalContext,
  buildFullContext
};
