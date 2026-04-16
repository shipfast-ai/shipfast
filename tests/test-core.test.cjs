const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// --- constants ---
const constants = require('../core/constants.cjs');

describe('constants', () => {
  it('exports all required keys', () => {
    assert.equal(constants.DB_NAME, '.shipfast/brain.db');
    assert.equal(constants.CONFIDENCE.HIGH, 0.8);
    assert.equal(constants.CONFIDENCE.MEDIUM, 0.5);
    assert.equal(constants.CONFIDENCE.LOW, 0.3);
    assert.equal(constants.BUDGET.CRITICAL, 2000);
    assert.equal(constants.DEFAULT_MODEL.scout, 'haiku');
    assert.equal(constants.DEFAULT_MODEL.builder, 'sonnet');
    assert.equal(constants.MODEL_COST.haiku, 1);
    assert.equal(constants.MODEL_COST.opus, 25);
    assert.equal(constants.BUILD_TIMEOUT_MS, 60000);
  });
});

// --- skip-logic ---
const { parseFlags, shouldSkipScout, shouldSkipArchitect, shouldSkipCritic, shouldSkipScribe } = require('../core/skip-logic.cjs');

describe('parseFlags', () => {
  it('extracts --tdd flag', () => {
    const { flags, task } = parseFlags('--tdd add user auth');
    assert.equal(flags.tdd, true);
    assert.equal(task, 'add user auth');
  });

  it('extracts multiple flags', () => {
    const { flags, task } = parseFlags('--research --verify fix login');
    assert.equal(flags.research, true);
    assert.equal(flags.verify, true);
    assert.equal(task, 'fix login');
  });

  it('extracts --no-plan flag', () => {
    const { flags, task } = parseFlags('--no-plan rename variable');
    assert.equal(flags.noPlan, true);
    assert.equal(task, 'rename variable');
  });

  it('extracts --cheap and --quality flags', () => {
    const { flags: f1 } = parseFlags('--cheap add button');
    assert.equal(f1.cheap, true);
    const { flags: f2 } = parseFlags('--quality fix auth');
    assert.equal(f2.quality, true);
  });

  it('returns empty flags for no flags', () => {
    const { flags, task } = parseFlags('fix the bug');
    assert.equal(Object.keys(flags).length, 0);
    assert.equal(task, 'fix the bug');
  });

  it('cleans up extra whitespace', () => {
    const { task } = parseFlags('--tdd   add   auth');
    assert.equal(task, 'add auth');
  });
});

describe('shouldSkipScout', () => {
  it('returns false for null task', () => {
    assert.equal(shouldSkipScout('.', null), false);
  });

  it('never skips for complex tasks', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'complex' }), false);
  });

  it('never skips when --research flag set', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'trivial' }, { research: true }), false);
  });

  it('does not skip when no affected files', () => {
    assert.equal(shouldSkipScout('.', { complexity: 'medium', affectedFiles: [] }), false);
  });
});

describe('shouldSkipArchitect', () => {
  it('skips with --no-plan flag', () => {
    assert.equal(shouldSkipArchitect('.', { complexity: 'complex' }, { noPlan: true }), true);
  });

  it('skips for fix intent', () => {
    assert.equal(shouldSkipArchitect('.', { intent: 'fix', complexity: 'medium' }), true);
  });

  it('never skips for complex without --no-plan', () => {
    assert.equal(shouldSkipArchitect('.', { complexity: 'complex' }), false);
  });
});

describe('shouldSkipCritic', () => {
  it('never skips with --verify flag', () => {
    assert.equal(shouldSkipCritic('.', { complexity: 'trivial' }, { verify: true }), false);
  });

  it('skips trivial tasks', () => {
    assert.equal(shouldSkipCritic('.', { complexity: 'trivial' }), true);
  });
});

describe('shouldSkipScribe', () => {
  it('only runs for complex', () => {
    assert.equal(shouldSkipScribe('.', { complexity: 'trivial' }), true);
    assert.equal(shouldSkipScribe('.', { complexity: 'medium' }), true);
    assert.equal(shouldSkipScribe('.', { complexity: 'complex' }), false);
  });
});

// --- brain esc ---
const brain = require('../brain/index.cjs');

describe('esc', () => {
  it('escapes single quotes', () => {
    assert.equal(brain.esc("it's"), "it''s");
  });
  it('handles null', () => {
    assert.equal(brain.esc(null), '');
  });
  it('handles undefined', () => {
    assert.equal(brain.esc(undefined), '');
  });
  it('handles numbers', () => {
    assert.equal(brain.esc(42), '42');
  });
});

// --- retry classifyError ---
const { classifyError } = require('../core/retry.cjs');

describe('classifyError', () => {
  it('classifies type errors', () => {
    const r = classifyError({ message: "Type 'string' is not assignable to type 'number'" });
    assert.equal(r.type, 'type_error');
    assert.equal(r.retryable, true);
  });
  it('classifies missing imports', () => {
    const r = classifyError({ message: "Cannot find module './utils'" });
    assert.equal(r.type, 'missing_import');
    assert.equal(r.retryable, true);
  });
  it('classifies permission errors as non-retryable', () => {
    const r = classifyError({ message: 'EACCES: permission denied' });
    assert.equal(r.type, 'permission');
    assert.equal(r.retryable, false);
  });
  it('classifies merge conflicts as non-retryable', () => {
    const r = classifyError({ message: 'CONFLICT (content): Merge conflict' });
    assert.equal(r.type, 'conflict');
    assert.equal(r.retryable, false);
  });
  it('defaults to unknown retryable', () => {
    const r = classifyError({ message: 'Something weird happened' });
    assert.equal(r.type, 'unknown');
    assert.equal(r.retryable, true);
  });
});

// --- executor groupIntoWaves ---
const { groupIntoWaves } = require('../core/executor.cjs');

describe('groupIntoWaves', () => {
  it('single task = single wave', () => {
    const waves = groupIntoWaves([{ id: 'a' }]);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].length, 1);
  });
  it('independent tasks = same wave', () => {
    const waves = groupIntoWaves([{ id: 'a' }, { id: 'b' }]);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].length, 2);
  });
  it('dependent tasks = separate waves', () => {
    const waves = groupIntoWaves([
      { id: 'a' },
      { id: 'b', depends_on: ['a'] }
    ]);
    assert.equal(waves.length, 2);
    assert.equal(waves[0][0].id, 'a');
    assert.equal(waves[1][0].id, 'b');
  });
});

// --- verify extractDoneCriteria ---
const { extractDoneCriteria } = require('../core/verify.cjs');

describe('extractDoneCriteria', () => {
  it('always includes build check', () => {
    const criteria = extractDoneCriteria('do something');
    assert.ok(criteria.some(c => c.type === 'build'));
  });
  it('handles null input gracefully', () => {
    const criteria = extractDoneCriteria(null);
    assert.equal(criteria.length, 1);
    assert.equal(criteria[0].type, 'build');
  });
  it('detects file creation expectations', () => {
    const criteria = extractDoneCriteria("create a file 'src/utils.ts'");
    assert.ok(criteria.some(c => c.type === 'file_exists'));
  });
});

// --- model-selector costMultiplier ---
const { costMultiplier } = require('../core/model-selector.cjs');

describe('costMultiplier', () => {
  it('returns correct costs', () => {
    assert.equal(costMultiplier('haiku'), 1);
    assert.equal(costMultiplier('sonnet'), 5);
    assert.equal(costMultiplier('opus'), 25);
  });
  it('defaults to sonnet cost for unknown', () => {
    assert.equal(costMultiplier('gpt-4'), 5);
  });
});

// --- autopilot estimateComplexity ---
const autopilot = require('../core/autopilot.cjs');

describe('estimateComplexity', () => {
  it('handles null input', () => {
    const r = autopilot.estimateComplexity(null);
    assert.ok(r === 'trivial' || (r && r.complexity === 'trivial'));
  });
  it('returns trivial for short input', () => {
    const r = autopilot.estimateComplexity('fix typo');
    assert.ok(r === 'trivial' || (r && r.complexity === 'trivial'));
  });
});
