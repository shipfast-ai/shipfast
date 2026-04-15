/**
 * ShipFast Checkpoint System
 *
 * Snapshot/rollback for safe execution.
 * Creates git stash checkpoints before risky operations.
 * Supports undo per-task or per-phase.
 */

const { execFileSync } = require('child_process');
const brain = require('../brain/index.cjs');

function beforeTask(cwd, taskId, description) {
  const autoCheckpoint = brain.getConfig(cwd, 'auto_checkpoint');
  if (autoCheckpoint === 'false') return null;

  return brain.createCheckpoint(cwd, taskId, description || `Before task: ${taskId}`);
}

function afterTask(cwd, taskId, status, commitSha) {
  if (status === 'passed') {
    brain.updateTask(cwd, taskId, {
      status: 'passed',
      commit_sha: commitSha || '',
      finished_at: Math.floor(Date.now() / 1000)
    });
  } else if (status === 'failed') {
    // Keep checkpoint for rollback
    brain.updateTask(cwd, taskId, {
      status: 'failed',
      finished_at: Math.floor(Date.now() / 1000)
    });
  }
}

function rollback(cwd, taskId) {
  // Get the commit sha if task was committed
  const tasks = brain.getTasks(cwd);
  const task = tasks.find(t => t.id === taskId);

  if (task && task.commit_sha) {
    try {
      // Revert the commit
      execFileSync('git', ['revert', '--no-commit', task.commit_sha], { cwd, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', `revert: rollback task ${taskId}`], { cwd, stdio: 'pipe' });
    } catch {
      // Try stash-based rollback
      brain.rollbackCheckpoint(cwd, taskId);
    }
  } else {
    brain.rollbackCheckpoint(cwd, taskId);
  }

  brain.updateTask(cwd, taskId, { status: 'rolled_back' });
  return true;
}

function listCheckpoints(cwd) {
  return brain.query(cwd, `
    SELECT c.id, c.description, c.created_at, t.status as task_status
    FROM checkpoints c
    LEFT JOIN tasks t ON c.id = t.id
    ORDER BY c.created_at DESC
    LIMIT 20
  `);
}

module.exports = {
  beforeTask,
  afterTask,
  rollback,
  listCheckpoints
};
