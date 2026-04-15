/**
 * ShipFast Plan Templates — Pre-Computed Plans (P2)
 *
 * GSD's Planner spends ~12K tokens figuring out HOW to plan.
 * ShipFast pre-computes plan templates based on intent.
 * Architect only fills in file paths and specifics (~1.5K vs ~5K tokens).
 */

/**
 * Get the plan template for an intent type.
 * Returns a structured template the Architect can fill in.
 */
function getTemplate(intent, complexity) {
  const template = TEMPLATES[intent] || TEMPLATES.feature;

  // Filter steps by complexity
  if (complexity === 'trivial') {
    return {
      ...template,
      steps: template.steps.slice(0, 2), // first 2 steps only
      needs_scout: false,
      needs_architect: false
    };
  }

  if (complexity === 'medium') {
    return {
      ...template,
      needs_architect: template.steps.length > 3
    };
  }

  return template;
}

const TEMPLATES = {
  fix: {
    steps: [
      { action: 'locate', description: 'Find the bug location using error message/stack trace' },
      { action: 'diagnose', description: 'Read the code to understand root cause' },
      { action: 'fix', description: 'Apply minimal fix' },
      { action: 'verify', description: 'Run tests or manual verification' }
    ],
    typical_files: '1-3',
    needs_scout: false,
    needs_architect: false,
    commit_type: 'fix',
    verify_command: null // auto-detect from package.json
  },

  feature: {
    steps: [
      { action: 'interface', description: 'Define the public interface (types, props, API)' },
      { action: 'implement', description: 'Build the core implementation' },
      { action: 'integrate', description: 'Wire into existing code (routes, imports, state)' },
      { action: 'style', description: 'Add styling if UI component' },
      { action: 'test', description: 'Add tests for the new feature' },
      { action: 'verify', description: 'End-to-end verification' }
    ],
    typical_files: '3-8',
    needs_scout: true,
    needs_architect: true,
    commit_type: 'feat',
    verify_command: null
  },

  refactor: {
    steps: [
      { action: 'identify', description: 'Identify the pattern/code to refactor' },
      { action: 'extract', description: 'Extract/reorganize the code' },
      { action: 'update_callers', description: 'Update all callers/imports' },
      { action: 'verify', description: 'Ensure no behavioral change (tests pass)' }
    ],
    typical_files: '2-5',
    needs_scout: true,
    needs_architect: true,
    commit_type: 'refactor',
    verify_command: null
  },

  test: {
    steps: [
      { action: 'analyze', description: 'Understand what to test from source code' },
      { action: 'write', description: 'Write test cases (happy path + edge cases)' },
      { action: 'run', description: 'Run tests and fix failures' }
    ],
    typical_files: '1-3',
    needs_scout: false,
    needs_architect: false,
    commit_type: 'test',
    verify_command: 'npm test'
  },

  perf: {
    steps: [
      { action: 'profile', description: 'Identify the bottleneck' },
      { action: 'optimize', description: 'Apply optimization (caching, lazy loading, query optimization)' },
      { action: 'benchmark', description: 'Measure improvement' },
      { action: 'verify', description: 'Ensure no regression' }
    ],
    typical_files: '1-4',
    needs_scout: true,
    needs_architect: false,
    commit_type: 'improve',
    verify_command: null
  },

  security: {
    steps: [
      { action: 'audit', description: 'Identify the vulnerability' },
      { action: 'fix', description: 'Apply security fix (sanitize, escape, validate)' },
      { action: 'harden', description: 'Add defense-in-depth measures' },
      { action: 'verify', description: 'Test that the vulnerability is patched' }
    ],
    typical_files: '1-5',
    needs_scout: true,
    needs_architect: false,
    commit_type: 'fix',
    verify_command: null
  },

  upgrade: {
    steps: [
      { action: 'check', description: 'Check changelog for breaking changes' },
      { action: 'update', description: 'Update package version' },
      { action: 'migrate', description: 'Apply migration steps from changelog' },
      { action: 'verify', description: 'Build + test to ensure compatibility' }
    ],
    typical_files: '2-10',
    needs_scout: true,
    needs_architect: true,
    commit_type: 'chore',
    verify_command: 'npm run build'
  },

  remove: {
    steps: [
      { action: 'identify', description: 'Find all references to the code being removed' },
      { action: 'remove', description: 'Delete code and update imports' },
      { action: 'clean', description: 'Remove orphaned files/tests' },
      { action: 'verify', description: 'Build + test to ensure nothing breaks' }
    ],
    typical_files: '2-6',
    needs_scout: true,
    needs_architect: false,
    commit_type: 'chore',
    verify_command: 'npm run build'
  },

  docs: {
    steps: [
      { action: 'read', description: 'Understand the code to document' },
      { action: 'write', description: 'Write documentation' }
    ],
    typical_files: '1-3',
    needs_scout: false,
    needs_architect: false,
    commit_type: 'docs',
    verify_command: null
  },

  style: {
    steps: [
      { action: 'identify', description: 'Identify the component/page to style' },
      { action: 'implement', description: 'Apply styling changes' },
      { action: 'verify', description: 'Visual verification' }
    ],
    typical_files: '1-3',
    needs_scout: false,
    needs_architect: false,
    commit_type: 'style',
    verify_command: null
  },

  ship: {
    steps: [
      { action: 'verify', description: 'Run full build + test suite' },
      { action: 'prepare', description: 'Create branch, stage changes' },
      { action: 'push', description: 'Push and create PR' }
    ],
    typical_files: '0',
    needs_scout: false,
    needs_architect: false,
    commit_type: null,
    verify_command: 'npm run build'
  },

  data: {
    steps: [
      { action: 'schema', description: 'Design/modify database schema' },
      { action: 'migration', description: 'Create migration file' },
      { action: 'implement', description: 'Update models/queries' },
      { action: 'seed', description: 'Add seed data if needed' },
      { action: 'verify', description: 'Run migration + test queries' }
    ],
    typical_files: '3-6',
    needs_scout: true,
    needs_architect: true,
    commit_type: 'feat',
    verify_command: null
  },

  review: {
    steps: [
      { action: 'diff', description: 'Get git diff of changes' },
      { action: 'analyze', description: 'Review for bugs, security, quality' },
      { action: 'report', description: 'Report findings' }
    ],
    typical_files: '0',
    needs_scout: false,
    needs_architect: false,
    commit_type: null,
    verify_command: null
  }
};

/**
 * Convert a template into a compact Architect prompt.
 * Much shorter than GSD's 12K planner prompt.
 */
function templateToArchitectPrompt(template, taskDescription) {
  const steps = template.steps.map((s, i) =>
    `${i + 1}. ${s.action}: ${s.description}`
  ).join('\n');

  return `Plan this task following these steps:
${steps}

Task: ${taskDescription}
Typical scope: ${template.typical_files} files
Commit type: ${template.commit_type || 'auto'}
${template.verify_command ? `Verify: ${template.verify_command}` : ''}

Output: ordered task list with file paths and specific instructions.`;
}

module.exports = {
  getTemplate,
  templateToArchitectPrompt,
  TEMPLATES
};
