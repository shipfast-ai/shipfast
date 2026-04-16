/**
 * ShipFast Verification Engine (Phase 3)
 *
 * Goal-backward verification: checks OUTCOMES, not just "tests pass".
 * Extracts done-criteria before work, verifies each after.
 * Includes stub detection, build verification, and scoring.
 *
 * NOTE: All subprocess calls use execFileSync (safe, no shell injection).
 */

'use strict';

const { execFileSync: safeExec } = require('child_process');
const fs = require('fs');
const path = require('path');
const brain = require('../brain/index.cjs');
const { BUILD_TIMEOUT_MS } = require('./constants.cjs');

// ============================================================
// Done criteria extraction
// ============================================================

function extractDoneCriteria(taskDescription, plan) {
  const criteria = [];
  const combined = taskDescription + ' ' + (plan || '');
  let match;

  // File creation expectations
  const fileCreateRe = /\b(?:create|add|new)\s+(?:a\s+)?(?:file\s+)?[`'"]([\w./\\-]+)[`'"]/gi;
  while ((match = fileCreateRe.exec(combined)) !== null) {
    criteria.push({ criterion: 'File ' + match[1] + ' exists', type: 'file_exists', target: match[1] });
  }

  // Function/component creation expectations
  const funcCreateRe = /\b(?:create|add|implement|build)\s+(?:a\s+)?(?:new\s+)?(?:function|component|hook|class|type|interface)\s+[`'"]?(\w+)[`'"]?/gi;
  while ((match = funcCreateRe.exec(combined)) !== null) {
    criteria.push({ criterion: match[1] + ' is defined in codebase', type: 'symbol_exists', target: match[1] });
  }

  // Behavior expectations
  const behaviorRe = /\b(?:should|must|will)\s+(.{10,60}?)(?:\.|$)/gi;
  while ((match = behaviorRe.exec(taskDescription)) !== null) {
    criteria.push({ criterion: match[1].trim(), type: 'behavior', target: match[1].trim() });
  }

  // Always check: build + stubs
  criteria.push({ criterion: 'Build passes without errors', type: 'build', target: null });
  criteria.push({ criterion: 'No TODO/placeholder stubs in changed files', type: 'no_stubs', target: null });

  return criteria;
}

// ============================================================
// Individual checks
// ============================================================

function verifyFileExists(cwd, filePath) {
  const exists = fs.existsSync(path.join(cwd, filePath));
  return { passed: exists, detail: exists ? 'File exists' : 'File not found: ' + filePath };
}

function verifySymbolExists(cwd, symbolName) {
  try {
    const result = safeExec('grep', ['-rl', symbolName, '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '--include=*.rs', '--include=*.py', '.'], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const files = result.split('\n').filter(Boolean);
    return { passed: files.length > 0, detail: files.length > 0 ? 'Found in: ' + files.slice(0, 3).join(', ') : 'Symbol "' + symbolName + '" not found' };
  } catch {
    return { passed: false, detail: 'Symbol "' + symbolName + '" not found' };
  }
}

function verifyBuild(cwd) {
  const buildCmd = detectBuildCommand(cwd);
  if (!buildCmd) return { passed: true, detail: 'No build command detected, skipping' };

  try {
    safeExec(buildCmd.cmd, buildCmd.args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: BUILD_TIMEOUT_MS });
    return { passed: true, detail: 'Build passed (' + buildCmd.cmd + ' ' + buildCmd.args.join(' ') + ')' };
  } catch (err) {
    const stderr = (err.stderr || '').toString().slice(0, 300);
    return { passed: false, detail: 'Build failed: ' + stderr };
  }
}

function verifyNoStubs(cwd) {
  let changedFiles;
  try {
    changedFiles = safeExec('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return { passed: true, detail: 'Could not detect changed files' };
  }

  const stubPatterns = [/\bTODO\b/i, /\bFIXME\b/i, /\bHACK\b/i, /\bnot\s+implemented\b/i, /\bcoming\s+soon\b/i, /\bplaceholder\b/i];
  const stubs = [];

  for (const file of changedFiles) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of stubPatterns) {
          if (pattern.test(lines[i])) {
            stubs.push(file + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 80));
          }
        }
      }
    } catch { /* skip */ }
  }

  return {
    passed: stubs.length === 0,
    detail: stubs.length === 0 ? 'No stubs found' : 'Found ' + stubs.length + ' stubs:\n' + stubs.slice(0, 5).join('\n')
  };
}

function detectBuildCommand(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts) {
        if (pkg.scripts.build) return { cmd: 'npm', args: ['run', 'build'] };
        if (pkg.scripts.typecheck) return { cmd: 'npm', args: ['run', 'typecheck'] };
        if (pkg.scripts.check) return { cmd: 'npm', args: ['run', 'check'] };
      }
    } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return { cmd: 'cargo', args: ['check'] };
  return null;
}

// ============================================================
// 3-Level Artifact Validation (gap #40)
// ============================================================

/**
 * Level 1: File exists
 * Level 2: Substantive (not just stubs/empty)
 * Level 3: Wired (imported and used by other code)
 */
function verifyArtifact3Level(cwd, filePath) {
  const full = path.join(cwd, filePath);

  // Level 1: Exists
  if (!fs.existsSync(full)) {
    return { level: 0, passed: false, detail: 'File missing: ' + filePath };
  }

  // Level 2: Substantive (not empty/stub-only)
  const content = fs.readFileSync(full, 'utf8');
  const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  if (lines.length < 3) {
    return { level: 1, passed: false, detail: 'File exists but is empty/stub-only: ' + filePath };
  }

  // Level 3: Wired (imported somewhere)
  const basename = path.basename(filePath, path.extname(filePath));
  try {
    const result = safeExec('grep', ['-rl', basename, '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '.'], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const importers = result.split('\n').filter(f => f && !f.includes(filePath));
    if (importers.length === 0) {
      return { level: 2, passed: false, detail: 'File exists and has content but is not imported anywhere: ' + filePath };
    }
    return { level: 3, passed: true, detail: 'Wired: imported by ' + importers.slice(0, 3).join(', ') };
  } catch {
    return { level: 2, passed: false, detail: 'File exists but could not verify wiring: ' + filePath };
  }
}

// ============================================================
// Data-Flow Tracing (gap #41)
// ============================================================

/**
 * Trace data flow for a component: does it receive real data or hardcoded empty?
 */
function verifyDataFlow(cwd, filePath) {
  const full = path.join(cwd, filePath);
  if (!fs.existsSync(full)) return { passed: null, detail: 'File not found' };

  const content = fs.readFileSync(full, 'utf8');
  const issues = [];

  // Check for hardcoded empty data
  const emptyPatterns = [
    { re: /data:\s*\[\s*\]/, msg: 'Hardcoded empty array as data' },
    { re: /return\s+\[\s*\]/, msg: 'Returns empty array (no data source)' },
    { re: /return\s+null/, msg: 'Returns null (no implementation)' },
    { re: /props\.\w+\s*\|\|\s*\[\s*\]/, msg: 'Fallback to empty array — is prop always empty?' },
  ];

  for (const { re, msg } of emptyPatterns) {
    if (re.test(content)) issues.push(msg);
  }

  // Check for fetch/query without response handling
  if (content.includes('fetch(') && !content.includes('.then') && !content.includes('await')) {
    issues.push('Fetch call without response handling');
  }

  return {
    passed: issues.length === 0,
    detail: issues.length === 0 ? 'Data flow looks connected' : 'Data flow issues: ' + issues.join('; ')
  };
}

// ============================================================
// Enhanced Stub Detection (gap #42)
// ============================================================

function verifyNoStubsDeep(cwd) {
  let changedFiles;
  try {
    changedFiles = safeExec('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch { return { passed: true, detail: 'Could not detect changed files' }; }

  const stubs = [];
  const patterns = [
    // Text stubs
    { re: /\bTODO\b/i, msg: 'TODO' },
    { re: /\bFIXME\b/i, msg: 'FIXME' },
    { re: /\bHACK\b/i, msg: 'HACK' },
    { re: /\bnot\s+implemented\b/i, msg: 'not implemented' },
    { re: /\bplaceholder\b/i, msg: 'placeholder' },
    // Component stubs
    { re: /return\s+<div>.*placeholder.*<\/div>/i, msg: 'placeholder component' },
    { re: /return\s+null\s*;?\s*\/\//, msg: 'returns null with comment' },
    { re: /onClick=\{?\(\)\s*=>\s*\{\s*\}\}?/, msg: 'empty click handler' },
    // API stubs
    { re: /Response\.json\(\[\]\)/, msg: 'empty response' },
    { re: /Response\.json\(\{.*not implemented/i, msg: 'not implemented response' },
    // Debug artifacts
    { re: /console\.log\(/, msg: 'console.log' },
    { re: /debugger\s*;/, msg: 'debugger statement' },
  ];

  for (const file of changedFiles) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const { re, msg } of patterns) {
          if (re.test(lines[i])) {
            stubs.push(file + ':' + (i + 1) + ': ' + msg);
          }
        }
      }
    } catch {}
  }

  return {
    passed: stubs.length === 0,
    detail: stubs.length === 0 ? 'No stubs found' : 'Found ' + stubs.length + ' stubs:\n' + stubs.slice(0, 8).join('\n')
  };
}

// ============================================================
// Main verification runner
// ============================================================

function runVerification(cwd, criteria) {
  const results = [];
  for (const c of criteria) {
    let result;
    switch (c.type) {
      case 'file_exists': result = verifyFileExists(cwd, c.target); break;
      case 'symbol_exists': result = verifySymbolExists(cwd, c.target); break;
      case 'build': result = verifyBuild(cwd); break;
      case 'no_stubs': result = verifyNoStubs(cwd); break;
      case 'behavior': result = { passed: null, detail: 'Manual verification needed' }; break;
      default: result = { passed: null, detail: 'Unknown check type' };
    }
    results.push({ criterion: c.criterion, type: c.type, ...result });
  }
  return results;
}

function scoreResults(results) {
  const checkable = results.filter(r => r.passed !== null);
  const passed = checkable.filter(r => r.passed === true);
  const failed = checkable.filter(r => r.passed === false);
  const manual = results.filter(r => r.passed === null);
  const pct = checkable.length > 0 ? Math.round((passed.length / checkable.length) * 100) : 100;

  return {
    passed: passed.length, failed: failed.length, manual: manual.length, total: results.length,
    percentage: pct,
    verdict: pct === 100 ? 'PASS' : pct >= 80 ? 'PASS_WITH_WARNINGS' : 'FAIL',
    failures: failed.map(f => ({ criterion: f.criterion, detail: f.detail })),
    manualChecks: manual.map(m => m.criterion)
  };
}

function recordVerification(cwd, taskId, scoreResult) {
  brain.updateTask(cwd, taskId, {
    status: scoreResult.verdict === 'FAIL' ? 'failed' : 'passed',
    error: scoreResult.failures.length > 0
      ? scoreResult.failures.map(f => f.criterion + ': ' + f.detail).join('; ').slice(0, 500)
      : ''
  });
}

function formatResults(results, scoreResult) {
  const lines = ['Verification: ' + scoreResult.verdict + ' (' + scoreResult.percentage + '%)'];
  lines.push('  ' + scoreResult.passed + '/' + scoreResult.total + ' checks passed');
  if (scoreResult.failures.length) {
    lines.push('', 'Failed:');
    scoreResult.failures.forEach(f => { lines.push('  FAIL: ' + f.criterion); lines.push('        ' + f.detail); });
  }
  if (scoreResult.manualChecks.length) {
    lines.push('', 'Manual verification needed:');
    scoreResult.manualChecks.forEach(m => lines.push('  - ' + m));
  }
  return lines.join('\n');
}

// ============================================================
// Auto-fix plan generation on verification failure
// ============================================================

/**
 * Generate fix tasks from verification failures.
 * Instead of spawning a fresh debugger agent (GSD: ~10K tokens),
 * we generate targeted fix tasks inline (~200 tokens each).
 */
function generateFixTasks(failures) {
  return failures.map((f, i) => ({
    id: 'fix:' + (i + 1),
    description: 'Fix: ' + f.criterion,
    plan_text: buildFixPlan(f),
    type: 'auto_fix',
    verify: f.criterion
  }));
}

function buildFixPlan(failure) {
  switch (failure.type || '') {
    case 'build':
      return 'Build failed. Read the error output, identify the broken file, fix the compilation/type error. Run build again to verify.';
    case 'no_stubs':
      return 'Incomplete code detected. Find the TODO/FIXME/placeholder markers listed below and replace with real implementation:\n' + (failure.detail || '');
    case 'file_exists':
      return 'Expected file was not created. Create the file at the path specified: ' + (failure.target || failure.criterion);
    case 'symbol_exists':
      return 'Expected symbol not found in codebase. Implement the missing function/class/type: ' + (failure.target || failure.criterion);
    default:
      return 'Verification check failed: ' + failure.criterion + '. Detail: ' + (failure.detail || 'none');
  }
}

/**
 * Run verify → auto-fix → re-verify loop.
 * Maximum 1 fix attempt to avoid spiraling.
 */
function verifyWithAutoFix(cwd, criteria, executeFixFn) {
  // First verification pass
  const results1 = runVerification(cwd, criteria);
  const score1 = scoreResults(results1);

  if (score1.verdict === 'PASS') {
    return { results: results1, score: score1, fixApplied: false };
  }

  // Generate fix tasks from failures
  const fixTasks = generateFixTasks(score1.failures);

  if (fixTasks.length === 0 || !executeFixFn) {
    return { results: results1, score: score1, fixApplied: false, fixTasks };
  }

  // Execute fixes (caller provides the execution function)
  try {
    executeFixFn(fixTasks);
  } catch {
    return { results: results1, score: score1, fixApplied: false, fixTasks };
  }

  // Re-verify after fixes
  const results2 = runVerification(cwd, criteria);
  const score2 = scoreResults(results2);

  return {
    results: results2,
    score: score2,
    fixApplied: true,
    fixTasks,
    improved: score2.percentage > score1.percentage
  };
}

// ============================================================
// TDD verification
// ============================================================

/**
 * Verify TDD commit sequence: test(...) → feat(...) → optional refactor(...)
 */
/**
 * Verify TDD commit sequence: test(...) → feat(...) → optional refactor(...)
 * Enhanced: also checks that test commits contain only test files and feat commits
 * contain only implementation files.
 */
function verifyTddSequence(cwd, numCommits) {
  try {
    const log = safeExec('git', ['log', '--oneline', '-' + (numCommits || 10)], {
      cwd, encoding: 'utf8'
    }).trim().split('\n');

    const testCommit = log.find(l => /\btest\(/.test(l));
    const featCommit = log.find(l => /\bfeat\(/.test(l));

    if (!testCommit) {
      return { passed: false, detail: 'TDD VIOLATION: No test(...) commit found. RED phase missing.' };
    }

    const testIdx = log.indexOf(testCommit);
    const featIdx = log.indexOf(featCommit);

    // test commit should come BEFORE feat commit (higher index = older in git log)
    if (featCommit && testIdx < featIdx) {
      // Verify test commit contains only test files
      const violations = [];
      const testSha = testCommit.split(' ')[0];
      const featSha = featCommit.split(' ')[0];

      try {
        const testFiles = safeExec('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', testSha], {
          cwd, encoding: 'utf8'
        }).trim().split('\n').filter(Boolean);

        const nonTestFiles = testFiles.filter(f =>
          !f.includes('test') && !f.includes('spec') && !f.includes('__tests__')
        );
        if (nonTestFiles.length > 0) {
          violations.push('RED commit contains non-test files: ' + nonTestFiles.join(', '));
        }

        const featFiles = safeExec('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', featSha], {
          cwd, encoding: 'utf8'
        }).trim().split('\n').filter(Boolean);

        const testInFeat = featFiles.filter(f =>
          f.includes('test') || f.includes('spec') || f.includes('__tests__')
        );
        if (testInFeat.length > 0) {
          violations.push('GREEN commit contains test files: ' + testInFeat.join(', '));
        }
      } catch { /* git diff-tree may fail for initial commits */ }

      if (violations.length > 0) {
        return { passed: false, detail: 'TDD sequence valid but file separation violated:\n' + violations.join('\n') };
      }

      return { passed: true, detail: 'TDD sequence valid: test → feat (file separation OK)' };
    }

    if (!featCommit) {
      return { passed: false, detail: 'TDD VIOLATION: No feat(...) commit found. GREEN phase missing.' };
    }

    return { passed: false, detail: 'TDD VIOLATION: feat(...) committed before test(...). RED must come first.' };
  } catch {
    return { passed: null, detail: 'Could not verify TDD sequence' };
  }
}

// ============================================================
// Schema Drift Detection
// ============================================================

/**
 * ORM/schema file patterns and their corresponding migration directories.
 * Detects when model files change without a corresponding migration.
 */
const SCHEMA_PATTERNS = [
  // Prisma
  { model: /\.prisma$/, migration: /prisma\/migrations\//, name: 'Prisma', migrateCmd: 'npx prisma migrate dev' },
  // Drizzle
  { model: /pgTable|sqliteTable|mysqlTable/, migration: /drizzle\/|migrations\/\d/, name: 'Drizzle', migrateCmd: 'npx drizzle-kit generate' },
  // TypeORM
  { model: /@Entity|@Column|@ManyToOne|@OneToMany/, migration: /migrations\/\d/, name: 'TypeORM', migrateCmd: 'npx typeorm migration:generate' },
  // Django
  { model: /models\.py$/, migration: /\/migrations\/\d/, name: 'Django', migrateCmd: 'python manage.py makemigrations' },
  // Rails
  { model: /app\/models\//, migration: /db\/migrate\//, name: 'Rails', migrateCmd: 'rails generate migration' },
  // Knex
  { model: /models\/.*\.(js|ts)$/, migration: /migrations\/\d/, name: 'Knex', migrateCmd: 'npx knex migrate:make' },
];

/**
 * Detect schema drift: model/schema files changed without corresponding migrations.
 * Returns { hasDrift, modelChanges, migrationChanges, ormType, migrateCmd }
 */
function detectSchemaDrift(cwd, numCommits) {
  let changedFiles;
  try {
    changedFiles = safeExec('git', ['diff', '--name-only', 'HEAD~' + (numCommits || 5)], {
      cwd, encoding: 'utf8'
    }).trim().split('\n').filter(Boolean);
  } catch {
    return { hasDrift: false, detail: 'Could not read git diff' };
  }

  if (changedFiles.length === 0) {
    return { hasDrift: false, detail: 'No changed files' };
  }

  // Check file contents for ORM patterns (for content-based detection like Drizzle/TypeORM)
  function fileMatchesContentPattern(filePath, pattern) {
    if (pattern.source.includes('/') || pattern.source.endsWith('$')) {
      // Path-based pattern
      return pattern.test(filePath);
    }
    // Content-based pattern — read the file
    const fullPath = path.join(cwd, filePath);
    if (!fs.existsSync(fullPath)) return false;
    try {
      const content = fs.readFileSync(fullPath, 'utf8').slice(0, 5000);
      return pattern.test(content);
    } catch { return false; }
  }

  for (const schema of SCHEMA_PATTERNS) {
    const modelChanges = changedFiles.filter(f => {
      if (schema.model.source.includes('/') || schema.model.source.endsWith('$')) {
        return schema.model.test(f);
      }
      return fileMatchesContentPattern(f, schema.model);
    });

    if (modelChanges.length === 0) continue;

    const migrationChanges = changedFiles.filter(f => schema.migration.test(f));

    if (migrationChanges.length === 0) {
      return {
        hasDrift: true,
        ormType: schema.name,
        modelChanges,
        migrationChanges: [],
        migrateCmd: schema.migrateCmd,
        detail: schema.name + ' model files changed without migration: ' + modelChanges.join(', ')
          + '. Run: ' + schema.migrateCmd
      };
    }
  }

  return { hasDrift: false, detail: 'No schema drift detected' };
}

module.exports = {
  extractDoneCriteria, runVerification, scoreResults, recordVerification, formatResults,
  verifyBuild, verifyNoStubs, verifyNoStubsDeep, detectBuildCommand,
  verifyArtifact3Level, verifyDataFlow,
  generateFixTasks, verifyWithAutoFix, verifyTddSequence,
  detectSchemaDrift
};
