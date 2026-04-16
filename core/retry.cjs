/**
 * ShipFast Failure-Aware Retry (P10)
 *
 * GSD spawns a fresh debugger agent per failure (~10K tokens each).
 * ShipFast retries inline with targeted error context (~500 tokens).
 *
 * Return conventions:
 *   classifyError() → { type, retryable, hint } — error classification for retry decisions
 *   executeWithRetry() → { success, result|error, attempts } — execution outcome
 *   verify functions  → { passed, detail } — verification check results
 *
 * Strategy:
 *   Attempt 1: Original task
 *   Attempt 2: Task + error message + learning hint (if available)
 *   Attempt 3: Task + error + different approach suggestion
 *   Give up:   Record failure pattern, ask user
 */

const brain = require('../brain/index.cjs');
const learning = require('./learning.cjs');

/**
 * Build retry context from a failure.
 * Returns a compact error context (~200-500 tokens) instead of spawning a new agent (~10K).
 */
function buildRetryContext(cwd, task, error, attempt) {
  const parts = [];

  // Error summary (truncated)
  parts.push(`<previous_error attempt="${attempt}">
${(error.message || error).toString().slice(0, 300)}
${error.file ? `File: ${error.file}` : ''}
${error.line ? `Line: ${error.line}` : ''}
</previous_error>`);

  // Check if we've seen this before
  const knownPattern = learning.recordFailure(cwd, {
    error: (error.message || error).toString(),
    domain: task.domain,
    pattern: null // auto-derive
  });

  if (knownPattern.known && knownPattern.solution) {
    parts.push(`<known_fix confidence="${knownPattern.confidence}">
${knownPattern.solution}
</known_fix>`);
  }

  // Attempt-specific guidance
  if (attempt === 2) {
    parts.push('<retry_hint>Try a different approach. Re-read the file before editing. Check imports.</retry_hint>');
  } else if (attempt === 3) {
    parts.push('<retry_hint>Simplify. Use the minimum change possible. Check if the function signature changed.</retry_hint>');
  }

  return parts.join('\n');
}

/**
 * Detect if errors across attempts indicate being stuck (same error repeating).
 * Returns true if the last 2 errors are substantially similar.
 */
function isStuck(errors) {
  if (errors.length < 2) return false;
  const last = (errors[errors.length - 1] || '').toString().toLowerCase().slice(0, 200);
  const prev = (errors[errors.length - 2] || '').toString().toLowerCase().slice(0, 200);
  if (!last || !prev) return false;
  // Check if 60%+ of words overlap
  const lastWords = new Set(last.split(/\s+/));
  const prevWords = new Set(prev.split(/\s+/));
  let overlap = 0;
  for (const w of lastWords) { if (prevWords.has(w)) overlap++; }
  return overlap / Math.max(lastWords.size, prevWords.size) > 0.6;
}

/**
 * Determine retry strategy based on error type.
 */
function classifyError(error) {
  const msg = (error.message || error).toString().toLowerCase();

  if (msg.includes('type') && (msg.includes('not assignable') || msg.includes('mismatch'))) {
    return { type: 'type_error', retryable: true, hint: 'Check type definitions and imports' };
  }

  if (msg.includes('cannot find module') || msg.includes('not found')) {
    return { type: 'missing_import', retryable: true, hint: 'Verify import path and module name' };
  }

  if (msg.includes('syntax error') || msg.includes('unexpected token')) {
    return { type: 'syntax', retryable: true, hint: 'Check for missing brackets, semicolons, or quotes' };
  }

  if (msg.includes('test') && (msg.includes('fail') || msg.includes('assert'))) {
    return { type: 'test_failure', retryable: true, hint: 'Read the test expectation and fix the implementation' };
  }

  if (msg.includes('permission') || msg.includes('eacces')) {
    return { type: 'permission', retryable: false, hint: 'Permission error — needs user intervention' };
  }

  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { type: 'timeout', retryable: true, hint: 'Operation timed out — simplify or break into smaller steps' };
  }

  if (msg.includes('conflict') || msg.includes('merge')) {
    return { type: 'conflict', retryable: false, hint: 'Merge conflict — needs user resolution' };
  }

  return { type: 'unknown', retryable: true, hint: 'Unexpected error — try reading the file again' };
}

/**
 * Execute with retry logic.
 * Returns: { success, result, attempts, tokensUsed }
 */
function withRetry(cwd, task, executeFn, maxAttempts = 3) {
  let lastError = null;
  let totalTokens = 0;
  const errors = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Build retry context for attempts > 1
      let retryContext = '';
      if (attempt > 1 && lastError) {
        const classification = classifyError(lastError);

        // Don't retry non-retryable errors
        if (!classification.retryable) {
          return {
            success: false,
            error: lastError,
            errorType: classification.type,
            hint: classification.hint,
            attempts: attempt - 1,
            tokensUsed: totalTokens
          };
        }

        // Don't retry if stuck (same error repeating)
        if (isStuck(errors)) {
          return {
            success: false,
            error: lastError,
            stuck: true,
            attempts,
            tokensUsed: totalTokens
          };
        }

        retryContext = buildRetryContext(cwd, task, lastError, attempt);
      }

      // Execute
      const result = executeFn(task, retryContext, attempt);
      totalTokens += result.tokensUsed || 0;

      if (result.success) {
        // If this was a retry, record the solution
        if (attempt > 1 && lastError) {
          learning.recordSolution(cwd, {
            pattern: learning.derivePattern((lastError.message || lastError).toString(), task.domain),
            solution: `Fixed on attempt ${attempt}. Approach: ${result.approach || 'retry'}`,
            domain: task.domain
          });
        }

        return {
          success: true,
          result: result.data,
          attempts: attempt,
          tokensUsed: totalTokens
        };
      }

      lastError = result.error || new Error('Task failed without error details');
      errors.push(lastError);

    } catch (err) {
      lastError = err;
      errors.push(lastError);
    }
  }

  // All attempts exhausted — record unsolved failure
  learning.recordFailure(cwd, {
    error: (lastError.message || lastError).toString(),
    domain: task.domain,
    pattern: null
  });

  return {
    success: false,
    error: lastError,
    attempts: maxAttempts,
    tokensUsed: totalTokens,
    gaveUp: true
  };
}

module.exports = {
  buildRetryContext,
  classifyError,
  isStuck,
  withRetry
};
