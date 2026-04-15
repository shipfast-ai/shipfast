/**
 * ShipFast Session Recovery (Phase 4)
 *
 * Handles context exhaustion, mid-session crashes, cross-session resume.
 * All state persisted in brain.db — no markdown files.
 */

'use strict';

const { execFileSync: safeRun } = require('child_process');
const brain = require('../brain/index.cjs');

// ============================================================
// Session state management
// ============================================================

/**
 * Save full session state to brain.db.
 * Called periodically and on context exhaustion.
 */
function saveState(cwd, sessionId, state) {
  const snapshot = {
    sessionId,
    phase: state.phase || null,
    currentTask: state.currentTask || null,
    completedTasks: (state.completedTasks || []).map(t => ({
      id: t.id,
      description: (t.description || '').slice(0, 100),
      commitSha: t.commitSha || null
    })),
    pendingTasks: (state.pendingTasks || []).map(t => ({
      id: t.id,
      description: (t.description || '').slice(0, 100)
    })),
    decisions: (state.decisions || []).slice(-10),
    lastAction: state.lastAction || null,
    stoppedAt: state.stoppedAt || null,
    savedAt: Date.now()
  };

  brain.setContext(cwd, 'session', 'state:' + sessionId, snapshot);
  brain.setContext(cwd, 'session', 'state:latest', snapshot);
}

/**
 * Load session state from brain.db.
 * Returns null if no saved state.
 */
function loadState(cwd, sessionId) {
  if (sessionId) {
    return brain.getContext(cwd, 'session', 'state:' + sessionId);
  }
  return brain.getContext(cwd, 'session', 'state:latest');
}

/**
 * Verify that saved commits still exist in git history.
 */
function verifyCommits(cwd, completedTasks) {
  const verified = [];
  const missing = [];

  for (const task of completedTasks) {
    if (!task.commitSha) {
      verified.push(task); // no commit to verify
      continue;
    }
    try {
      safeRun('git', ['cat-file', '-t', task.commitSha], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      });
      verified.push(task);
    } catch {
      missing.push(task);
    }
  }

  return { verified, missing };
}

/**
 * Build a compact resume prompt from saved state.
 * ~300-500 tokens instead of full context reload.
 */
function buildResumePrompt(state) {
  if (!state) return '';

  const parts = [];

  parts.push('<session_resume>');
  parts.push('Resuming from previous session.');

  if (state.completedTasks && state.completedTasks.length) {
    parts.push('');
    parts.push('Completed tasks (do NOT redo):');
    state.completedTasks.forEach(t => {
      parts.push('  - ' + t.id + ': ' + t.description + (t.commitSha ? ' [' + t.commitSha.slice(0, 7) + ']' : ''));
    });
  }

  if (state.pendingTasks && state.pendingTasks.length) {
    parts.push('');
    parts.push('Pending tasks (continue from here):');
    state.pendingTasks.forEach(t => {
      parts.push('  - ' + t.id + ': ' + t.description);
    });
  }

  if (state.decisions && state.decisions.length) {
    parts.push('');
    parts.push('Decisions from previous session:');
    state.decisions.forEach(d => {
      parts.push('  - ' + (d.question || d.q) + ' -> ' + (d.decision || d.a));
    });
  }

  if (state.stoppedAt) {
    parts.push('');
    parts.push('Stopped at: ' + state.stoppedAt);
  }

  parts.push('</session_resume>');

  return parts.join('\n');
}

// ============================================================
// Context exhaustion protocol
// ============================================================

/**
 * Determine context-aware behavior adjustments.
 * Returns guidance for the agent based on remaining context.
 */
function getContextGuidance(remainingPct) {
  if (remainingPct > 65) {
    return { level: 'normal', adjustments: [] };
  }

  if (remainingPct > 50) {
    return {
      level: 'conserve',
      adjustments: [
        'Be concise in all outputs',
        'Skip optional exploration',
        'Prefer direct implementation over research'
      ]
    };
  }

  if (remainingPct > 35) {
    return {
      level: 'warning',
      adjustments: [
        'Skip Scribe agent',
        'Use Haiku for all agents',
        'No code review — trust tests only',
        'Minimize output text'
      ]
    };
  }

  if (remainingPct > 20) {
    return {
      level: 'critical',
      adjustments: [
        'STOP new tasks after current one',
        'Save state to brain.db immediately',
        'Commit current work',
        'Report to user: context is running low'
      ]
    };
  }

  return {
    level: 'emergency',
    adjustments: [
      'EMERGENCY: Save state and stop ALL work',
      'Commit anything uncommitted',
      'Save full session state to brain.db',
      'Tell user to run /sf-resume in new session'
    ]
  };
}

/**
 * Format resume status for user display.
 */
function formatResumeStatus(state, commitCheck) {
  const lines = [];

  lines.push('Session Recovery');
  lines.push('================');

  if (state.savedAt) {
    const ago = Math.round((Date.now() - state.savedAt) / 60000);
    lines.push('Saved: ' + ago + ' minutes ago');
  }

  if (state.stoppedAt) {
    lines.push('Stopped at: ' + state.stoppedAt);
  }

  lines.push('');
  lines.push('Completed: ' + (state.completedTasks || []).length + ' tasks');
  lines.push('Pending: ' + (state.pendingTasks || []).length + ' tasks');

  if (commitCheck) {
    if (commitCheck.missing.length > 0) {
      lines.push('');
      lines.push('WARNING: ' + commitCheck.missing.length + ' commits not found in git history');
      commitCheck.missing.forEach(t => lines.push('  - ' + t.id + ': ' + t.commitSha));
    }
  }

  if (state.decisions && state.decisions.length) {
    lines.push('');
    lines.push('Decisions carried forward: ' + state.decisions.length);
  }

  return lines.join('\n');
}

module.exports = {
  saveState,
  loadState,
  verifyCommits,
  buildResumePrompt,
  getContextGuidance,
  formatResumeStatus
};
