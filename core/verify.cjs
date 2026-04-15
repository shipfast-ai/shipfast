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
    safeExec(buildCmd.cmd, buildCmd.args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
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
function verifyTddSequence(cwd, numCommits) {
  try {
    const log = safeRun('git', ['log', '--oneline', '-' + (numCommits || 10)], {
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
      return { passed: true, detail: 'TDD sequence valid: test → feat' };
    }

    if (!featCommit) {
      return { passed: false, detail: 'TDD VIOLATION: No feat(...) commit found. GREEN phase missing.' };
    }

    return { passed: false, detail: 'TDD VIOLATION: feat(...) committed before test(...). RED must come first.' };
  } catch {
    return { passed: null, detail: 'Could not verify TDD sequence' };
  }
}

module.exports = {
  extractDoneCriteria, runVerification, scoreResults, recordVerification, formatResults,
  verifyBuild, verifyNoStubs, detectBuildCommand,
  generateFixTasks, verifyWithAutoFix, verifyTddSequence
};
