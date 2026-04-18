/**
 * ShipFast Git Intelligence — Co-Change Prediction (P8)
 *
 * Analyzes git history to predict which files change together.
 * Used by Scout to narrow search scope and by Architect to identify impact.
 */

const { execFileSync } = require('child_process');
const brain = require('../brain/index.cjs');

/**
 * Analyze commit-level co-change patterns and store in brain.db
 */
function analyzeCoChanges(cwd, commitLimit = 200) {
  try {
    // Get commit hashes
    const logOutput = execFileSync('git', ['log', '--format=%H', `-${commitLimit}`], {
      cwd, encoding: 'utf8'
    }).trim();

    if (!logOutput) return { commits: 0, pairs: 0 };

    const commits = logOutput.split('\n');
    const pairCounts = {};

    for (const sha of commits) {
      try {
        const files = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sha], {
          cwd, encoding: 'utf8'
        }).trim().split('\n').filter(Boolean);

        // Record co-change pairs (files that change in the same commit)
        for (let i = 0; i < files.length; i++) {
          for (let j = i + 1; j < files.length; j++) {
            const key = [files[i], files[j]].sort().join('|');
            pairCounts[key] = (pairCounts[key] || 0) + 1;
          }
        }
      } catch { /* skip bad commits */ }
    }

    // Store top co-change pairs in brain.db. Cap at 300 (up from 100) to
    // retain more signal on larger repos while still bounding edge count.
    // Pairs are already sorted by frequency; low-ranked pairs have lowest
    // weight so truncation sheds the least useful signal.
    const topPairs = Object.entries(pairCounts)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 300);

    if (topPairs.length > 0) {
      const statements = ['BEGIN TRANSACTION;'];
      statements.push("DELETE FROM edges WHERE kind = 'co_changes';");

      for (const [key, count] of topPairs) {
        const [fileA, fileB] = key.split('|');
        const weight = Math.min(count / 10, 1.0);
        statements.push(
          `INSERT OR REPLACE INTO edges (source, target, kind, weight) VALUES ('file:${brain.esc(fileA)}', 'file:${brain.esc(fileB)}', 'co_changes', ${weight});`
        );
      }

      statements.push('COMMIT;');
      const dbPath = brain.getBrainPath(cwd);
      execFileSync('sqlite3', [dbPath], {
        input: statements.join('\n'),
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    return { commits: commits.length, pairs: topPairs.length };
  } catch {
    return { commits: 0, pairs: 0 };
  }
}

/**
 * Predict files that will likely change alongside the given file.
 */
function predictRelatedFiles(cwd, filePath, limit = 5) {
  const escaped = brain.esc(filePath);
  return brain.query(cwd, `
    SELECT
      CASE WHEN source = 'file:${escaped}' THEN REPLACE(target, 'file:', '')
           ELSE REPLACE(source, 'file:', '') END as related_file,
      weight as co_change_score
    FROM edges
    WHERE kind = 'co_changes'
    AND (source = 'file:${escaped}' OR target = 'file:${escaped}')
    ORDER BY weight DESC
    LIMIT ${limit}
  `);
}

/**
 * Get files that frequently change together (cluster detection).
 * Returns groups of files that form "change clusters".
 */
function getChangeClusters(cwd, minClusterSize = 3) {
  const pairs = brain.query(cwd, `
    SELECT source, target, weight FROM edges
    WHERE kind = 'co_changes' AND weight > 0.3
    ORDER BY weight DESC
    LIMIT 50
  `);

  // Build adjacency graph
  const graph = {};
  for (const { source, target } of pairs) {
    const s = source.replace('file:', '');
    const t = target.replace('file:', '');
    if (!graph[s]) graph[s] = new Set();
    if (!graph[t]) graph[t] = new Set();
    graph[s].add(t);
    graph[t].add(s);
  }

  // Simple connected components
  const visited = new Set();
  const clusters = [];

  for (const node of Object.keys(graph)) {
    if (visited.has(node)) continue;
    const cluster = [];
    const queue = [node];
    while (queue.length) {
      const current = queue.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const neighbor of (graph[current] || [])) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (cluster.length >= minClusterSize) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Get recently changed files (for incremental indexing hints).
 */
function getRecentChanges(cwd, since = '1 day ago') {
  try {
    const output = execFileSync('git', ['log', `--since=${since}`, '--name-only', '--pretty='], {
      cwd, encoding: 'utf8'
    });
    return [...new Set(output.split('\n').filter(Boolean))];
  } catch {
    return [];
  }
}

module.exports = {
  analyzeCoChanges,
  predictRelatedFiles,
  getChangeClusters,
  getRecentChanges
};
