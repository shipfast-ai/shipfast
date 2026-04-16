#!/usr/bin/env node

/**
 * ShipFast CLI
 *
 * npm i -g @shipfast-ai/shipfast   → auto-detect AI tools + install for all
 * shipfast init                     → index current repo
 * shipfast update                   → update + re-detect new runtimes
 * shipfast uninstall                → remove everything
 * shipfast help                     → show commands
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync: safeRun } = require('child_process');

// WSL + Windows detection (from GSD's 49-release edge case fixes)
if (process.platform === 'win32') {
  let isWSL = false;
  try {
    if (process.env.WSL_DISTRO_NAME) isWSL = true;
    else if (fs.existsSync('/proc/version')) {
      const pv = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      if (pv.includes('microsoft') || pv.includes('wsl')) isWSL = true;
    }
  } catch {}
  if (isWSL) {
    console.error('\nDetected WSL with Windows-native Node.js.');
    console.error('Install a Linux-native Node.js inside WSL:');
    console.error('  curl -fsSL https://fnm.vercel.app/install | bash');
    console.error('  fnm install --lts\n');
    process.exit(1);
  }
}

const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

const pkg = require('../package.json');
const command = (process.argv[2] || '').toLowerCase().replace(/^--/, '');

// 14 runtimes — global config paths (relative to home dir)
const RUNTIMES = {
  claude:       { path: '.claude',                           name: 'Claude Code' },
  opencode:     { path: path.join('.config', 'opencode'),    name: 'OpenCode' },
  gemini:       { path: '.gemini',                           name: 'Gemini CLI' },
  kilo:         { path: path.join('.config', 'kilo'),        name: 'Kilo' },
  codex:        { path: '.codex',                            name: 'Codex' },
  copilot:      { path: '.copilot',                          name: 'Copilot' },
  cursor:       { path: '.cursor',                           name: 'Cursor' },
  windsurf:     { path: path.join('.codeium', 'windsurf'),   name: 'Windsurf' },
  antigravity:  { path: path.join('.gemini', 'antigravity'), name: 'Antigravity' },
  augment:      { path: '.augment',                          name: 'Augment' },
  trae:         { path: '.trae',                             name: 'Trae' },
  qwen:         { path: '.qwen',                             name: 'Qwen Code' },
  codebuddy:    { path: '.codebuddy',                        name: 'CodeBuddy' },
  cline:        { path: '.cline',                            name: 'Cline' },
};

// ============================================================
// Router
// ============================================================

function main() {
  console.log(`\n${bold}${cyan}ShipFast${reset} v${pkg.version}\n`);

  switch (command) {
    case 'init':
    case 'train':    return cmdInit();
    case 'link':     return cmdLink();
    case 'unlink':   return cmdUnlink();
    case 'update':   return cmdUpdate();
    case 'uninstall': return cmdUninstall();
    case 'status':   return cmdStatus();
    case 'doctor':      return cmdDoctor();
    case 'permissions': return cmdPermissions();
    case 'help':
    case 'h':        return cmdHelp();
    case 'version':
    case 'v':        return;
    case 'install':
    case '':         return cmdInstall();
    default:
      console.log(`Unknown: ${command}. Run ${cyan}shipfast help${reset}\n`);
  }
}

// ============================================================
// INSTALL — auto-detect + install for all detected runtimes
// ============================================================

function cmdInstall() {
  const detected = detectRuntimes();

  if (detected.length === 0) {
    console.log(`${yellow}No AI coding tools detected.${reset}`);
    console.log(`Installing for Claude Code by default.\n`);
    installFor('claude', RUNTIMES.claude);
    printDone(1);
    return;
  }

  console.log(`Detected: ${bold}${detected.map(([_, r]) => r.name).join(', ')}${reset}\n`);

  for (const [key, runtime] of detected) {
    installFor(key, runtime);
  }

  printDone(detected.length);
}

function detectRuntimes() {
  const home = os.homedir();
  return Object.entries(RUNTIMES).filter(([_, rt]) =>
    fs.existsSync(path.join(home, rt.path))
  );
}

function installFor(key, runtime) {
  const dir = path.join(os.homedir(), runtime.path);
  fs.mkdirSync(dir, { recursive: true });

  // Copy shipfast core (brain + core modules)
  const sfDir = path.join(dir, 'shipfast');
  const brainDir = path.join(sfDir, 'brain');
  const coreDir = path.join(sfDir, 'core');
  for (const d of [sfDir, brainDir, coreDir]) fs.mkdirSync(d, { recursive: true });

  // Write version file so /sf-status can read it
  fs.writeFileSync(path.join(sfDir, 'version'), pkg.version);

  for (const f of ['schema.sql', 'index.cjs', 'indexer.cjs'])
    copy('brain/' + f, path.join(brainDir, f));

  for (const f of ['architecture.cjs','autopilot.cjs','budget.cjs','checkpoint.cjs','constants.cjs','learning.cjs','ambiguity.cjs','context-builder.cjs','conversation.cjs','executor.cjs','git-intel.cjs','guardrails.cjs','model-selector.cjs','retry.cjs','session.cjs','skip-logic.cjs','templates.cjs','verify.cjs'])
    copy('core/' + f, path.join(coreDir, f));

  // Copy agents
  const agentsDir = path.join(dir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const f of ['scout.md','architect.md','builder.md','critic.md','scribe.md'])
    copy('agents/' + f, path.join(agentsDir, f));

  // Copy commands
  const cmdDir = path.join(dir, 'commands', 'sf');
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const f of ['do.md','plan.md','verify.md','check-plan.md','map.md','worktree.md','status.md','undo.md','config.md','brain.md','learn.md','discuss.md','project.md','resume.md','ship.md','help.md','milestone.md','rollback.md','cost.md','diff.md'])
    copy('commands/sf/' + f, path.join(cmdDir, f));

  // Copy hooks
  const hooksDir = path.join(dir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of ['sf-context-monitor.js','sf-statusline.js','sf-first-run.js','sf-prompt-guard.js'])
    copy('hooks/' + f, path.join(hooksDir, f));

  // Copy MCP server
  const mcpDir = path.join(sfDir, 'mcp');
  fs.mkdirSync(mcpDir, { recursive: true });
  copy('mcp/server.cjs', path.join(mcpDir, 'server.cjs'));

  // Runtime-specific config
  const claudeCompat = ['Claude Code', 'OpenCode', 'Kilo'];
  const geminiCompat = ['Gemini CLI', 'Antigravity'];

  if (claudeCompat.includes(runtime.name)) {
    writeSettings(dir, hooksDir);
    writeMcpConfig(dir);
    writeInstruction(path.join(dir, 'CLAUDE.md'));
  } else if (geminiCompat.includes(runtime.name)) {
    writeInstruction(path.join(dir, 'AGENTS.md'));
  } else if (runtime.name === 'Copilot') {
    writeInstruction(path.join(dir, 'copilot-instructions.md'));
  } else if (runtime.name === 'Cursor') {
    writeMcpConfig(dir);
    writeInstruction(path.join(dir, 'rules'));
  } else {
    writeInstruction(path.join(dir, 'AGENTS.md'));
  }

  console.log(`  ${green}${runtime.name}${reset} ${dim}${dir}${reset}`);
}

function printDone(count) {
  console.log(`\n${green}${bold}ShipFast v${pkg.version} installed for ${count} runtime${count > 1 ? 's' : ''}!${reset}\n`);
  console.log(`${bold}Next:${reset}`);
  console.log(`  ${cyan}cd your-project${reset}`);
  console.log(`  ${cyan}shipfast init${reset}        Index your codebase\n`);
  console.log(`${bold}In your AI tool:${reset}`);
  console.log(`  ${cyan}/sf-do${reset} <task>     Describe what you want`);
  console.log(`  ${cyan}/sf-help${reset}          Show all commands\n`);
}

// ============================================================
// INIT — index current repo
// ============================================================

function cmdInit() {
  const cwd = process.cwd();
  const fresh = process.argv.includes('--fresh');

  if (!fs.existsSync(path.join(cwd, '.git'))) {
    console.log(`${red}Not a git repo.${reset} Run this inside a git repository.\n`);
    return;
  }

  const indexer = findIndexer();
  if (!indexer) {
    console.log(`${red}ShipFast not installed.${reset} Run: ${cyan}npm i -g @shipfast-ai/shipfast${reset}\n`);
    return;
  }

  const brainExists = fs.existsSync(path.join(cwd, '.shipfast', 'brain.db'));

  // --fresh flag: clear existing brain for full reindex
  if (fresh && brainExists) {
    fs.unlinkSync(path.join(cwd, '.shipfast', 'brain.db'));
    console.log('Cleared existing brain.db');
  }

  console.log(brainExists && !fresh ? 'Re-indexing codebase...' : 'Indexing codebase...');

  try {
    const args = [indexer, cwd];
    if (fresh) args.push('--fresh');
    const out = safeRun(process.execPath, args, {
      encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`${green}${out.trim()}${reset}`);

    // Add .shipfast/ to .gitignore
    const gi = path.join(cwd, '.gitignore');
    if (fs.existsSync(gi)) {
      const c = fs.readFileSync(gi, 'utf8');
      if (!c.includes('.shipfast/')) fs.appendFileSync(gi, '\n# ShipFast brain\n.shipfast/\n');
    } else {
      fs.writeFileSync(gi, '# ShipFast brain\n.shipfast/\n');
    }

    // Detect and store default branch
    let defaultBranch = 'main';
    try {
      // Try to detect from remote HEAD
      const remoteHead = safeRun('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (remoteHead) defaultBranch = remoteHead.replace('refs/remotes/origin/', '');
    } catch {
      // Fallback: check which of main/master exists
      try {
        safeRun('git', ['rev-parse', '--verify', 'main'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        defaultBranch = 'main';
      } catch {
        try {
          safeRun('git', ['rev-parse', '--verify', 'master'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
          defaultBranch = 'master';
        } catch { /* keep 'main' as default */ }
      }
    }

    // Store in brain.db
    const dbPath = path.join(cwd, '.shipfast', 'brain.db');
    try {
      safeRun('sqlite3', [dbPath, `INSERT OR REPLACE INTO config (key, value) VALUES ('default_branch', '${defaultBranch}');`], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch { /* brain.db might not have config table yet on first run */ }

    // Prune stale learnings (>30 days old, low confidence, never used)
    try {
      safeRun('sqlite3', [dbPath, "DELETE FROM learnings WHERE confidence < 0.3 AND times_used = 0 AND created_at < strftime('%s', 'now') - 2592000;"], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch { /* learnings table may not exist yet */ }

    console.log(`\n${dim}Brain: .shipfast/brain.db${reset}`);
    console.log(`${dim}Default branch: ${defaultBranch}${reset}`);
    console.log(`${dim}Permissions: 19 safe patterns configured (no --dangerously-skip-permissions needed)${reset}`);
    console.log(`${dim}Use /sf-do in your AI tool.${reset}\n`);
  } catch (err) {
    console.log(`${red}Failed: ${err.message.slice(0, 100)}${reset}\n`);
  }
}

// Doctor command
function cmdDoctor() {
  const cwd = process.cwd();
  const dbPath = path.join(cwd, '.shipfast', 'brain.db');
  let issues = 0;

  console.log(`${bold}ShipFast Doctor${reset}\n`);

  // Check 1: brain.db exists
  if (!fs.existsSync(dbPath)) {
    console.log(`${red}ERROR${reset} brain.db not found. Run: ${cyan}shipfast init${reset}`);
    return;
  }
  console.log(`${green}OK${reset}    brain.db exists`);

  // Check 2: schema version
  try {
    const ver = safeRun('sqlite3', ['-json', dbPath, "SELECT MAX(version) as v FROM _migrations;"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const parsed = JSON.parse(ver);
    console.log(`${green}OK${reset}    schema version: ${parsed[0].v}`);
  } catch {
    console.log(`${yellow}WARN${reset}  could not read schema version`);
    issues++;
  }

  // Check 3: stale nodes (files that no longer exist)
  try {
    const nodes = safeRun('sqlite3', ['-json', dbPath, "SELECT file_path FROM nodes WHERE kind = 'file';"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (nodes) {
      const files = JSON.parse(nodes);
      const stale = files.filter(f => !fs.existsSync(path.join(cwd, f.file_path)));
      if (stale.length > 0) {
        console.log(`${yellow}WARN${reset}  ${stale.length} stale node(s) — run ${cyan}shipfast init --fresh${reset} to clean`);
        issues++;
      } else {
        console.log(`${green}OK${reset}    no stale nodes`);
      }
    }
  } catch {
    console.log(`${green}OK${reset}    no stale nodes`);
  }

  // Check 4: git repo
  try {
    safeRun('git', ['rev-parse', '--git-dir'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`${green}OK${reset}    git repo detected`);
  } catch {
    console.log(`${red}ERROR${reset} not a git repo`);
    issues++;
  }

  // Check 5: linked repos
  try {
    const links = safeRun('sqlite3', ['-json', dbPath, "SELECT value FROM config WHERE key = 'linked_repos';"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (links) {
      const parsed = JSON.parse(links);
      if (parsed.length && parsed[0].value) {
        const repos = JSON.parse(parsed[0].value);
        for (const r of repos) {
          const hasDb = fs.existsSync(path.join(r, '.shipfast', 'brain.db'));
          if (hasDb) {
            console.log(`${green}OK${reset}    linked: ${path.basename(r)}`);
          } else {
            console.log(`${yellow}WARN${reset}  linked repo missing brain.db: ${r}`);
            issues++;
          }
        }
      }
    }
  } catch { /* no linked repos */ }

  // Check 6: node counts
  try {
    const stats = safeRun('sqlite3', ['-json', dbPath,
      "SELECT 'nodes' as t, COUNT(*) as c FROM nodes UNION ALL SELECT 'edges', COUNT(*) FROM edges UNION ALL SELECT 'learnings', COUNT(*) FROM learnings;"],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (stats) {
      const parsed = JSON.parse(stats);
      const counts = {};
      parsed.forEach(r => counts[r.t] = r.c);
      console.log(`${green}OK${reset}    ${counts.nodes || 0} nodes, ${counts.edges || 0} edges, ${counts.learnings || 0} learnings`);
    }
  } catch { /* ok */ }

  console.log(`\n${issues === 0 ? green + 'All checks passed.' : yellow + issues + ' issue(s) found.'}${reset}\n`);
}

// Permissions command
function cmdPermissions() {
  const reset = process.argv.includes('--reset');

  // Find settings.json in known locations
  const home = os.homedir();
  const locations = [
    path.join(home, '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json')
  ];

  for (const sp of locations) {
    if (!fs.existsSync(sp)) continue;
    let s = {};
    try { s = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch { continue; }

    if (reset) {
      // Reset to ShipFast defaults
      const defaults = [
        'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent',
        'Bash(git *)', 'Bash(npm run build*)', 'Bash(npm test*)',
        'Bash(npx tsc*)', 'Bash(npx vitest*)', 'Bash(cargo check*)',
        'Bash(grep *)', 'Bash(find *)', 'Bash(wc *)', 'Bash(cat *)',
        'Bash(ls *)', 'Bash(mkdir *)', 'Bash(node *)'
      ];
      if (!s.permissions) s.permissions = {};
      s.permissions.allow = defaults;
      fs.writeFileSync(sp, JSON.stringify(s, null, 2));
      console.log(`${green}Permissions reset to ShipFast defaults (${defaults.length} rules).${reset}`);
      console.log(`${dim}File: ${sp}${reset}\n`);
      return;
    }

    const allow = (s.permissions && s.permissions.allow) || [];
    console.log(`${bold}ShipFast Permissions${reset}\n`);
    console.log(`${dim}File: ${sp}${reset}\n`);

    if (allow.length === 0) {
      console.log(`${yellow}No permissions configured.${reset} Run ${cyan}shipfast init${reset} to set up.\n`);
      return;
    }

    console.log(`${bold}Allowed (${allow.length} rules):${reset}`);
    for (const p of allow) {
      console.log(`  ${green}✓${reset} ${p}`);
    }

    const deny = (s.permissions && s.permissions.deny) || [];
    if (deny.length > 0) {
      console.log(`\n${bold}Denied:${reset}`);
      for (const p of deny) {
        console.log(`  ${red}✗${reset} ${p}`);
      }
    }

    console.log(`\n${dim}Everything not listed above will prompt for permission.${reset}`);
    console.log(`${dim}Reset with: ${cyan}shipfast permissions --reset${reset}\n`);
    return;
  }

  console.log(`${yellow}No settings.json found.${reset} Run ${cyan}shipfast init${reset} first.\n`);
}

// LINK — connect another repo's brain for cross-repo awareness

function cmdLink() {
  const targetPath = process.argv[3];
  if (!targetPath) {
    console.log(`${bold}Usage:${reset} shipfast link <path-to-other-repo>\n`);
    console.log(`Links another repo's brain.db so agents can query across repos.`);
    console.log(`Example: ${cyan}shipfast link ../backend${reset}\n`);

    // Show current links
    const cwd = process.cwd();
    const brainDb = path.join(cwd, '.shipfast', 'brain.db');
    if (fs.existsSync(brainDb)) {
      try {
        const links = safeRun('sqlite3', ['-json', brainDb, "SELECT value FROM config WHERE key = 'linked_repos';"], {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (links) {
          const parsed = JSON.parse(links);
          if (parsed.length && parsed[0].value) {
            const repos = JSON.parse(parsed[0].value);
            if (repos.length) {
              console.log(`${bold}Linked repos:${reset}`);
              repos.forEach(r => {
                const hasDb = fs.existsSync(path.join(r, '.shipfast', 'brain.db'));
                console.log(`  ${hasDb ? green : red}${r}${reset} ${hasDb ? '(brain.db found)' : '(brain.db missing — run shipfast init there)'}`);
              });
              console.log('');
            }
          }
        }
      } catch {}
    }
    return;
  }

  const cwd = process.cwd();
  const resolved = path.resolve(cwd, targetPath);

  // Validate target
  if (!fs.existsSync(resolved)) {
    console.log(`${red}Path not found: ${resolved}${reset}\n`);
    return;
  }

  if (!fs.existsSync(path.join(resolved, '.git'))) {
    console.log(`${yellow}Warning: ${resolved} is not a git repo.${reset}`);
  }

  const targetBrain = path.join(resolved, '.shipfast', 'brain.db');
  if (!fs.existsSync(targetBrain)) {
    console.log(`${yellow}Warning: No brain.db found at ${resolved}. Run ${cyan}shipfast init${reset}${yellow} there first.${reset}`);
  }

  // Ensure local brain exists
  const localBrain = path.join(cwd, '.shipfast', 'brain.db');
  if (!fs.existsSync(localBrain)) {
    console.log(`${red}No local brain.db. Run ${cyan}shipfast init${reset}${red} first.${reset}\n`);
    return;
  }

  // Get existing links
  let links = [];
  try {
    const existing = safeRun('sqlite3', ['-json', localBrain, "SELECT value FROM config WHERE key = 'linked_repos';"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed.length && parsed[0].value) links = JSON.parse(parsed[0].value);
    }
  } catch {}

  // Add if not already linked
  if (links.includes(resolved)) {
    console.log(`${dim}Already linked: ${resolved}${reset}\n`);
    return;
  }

  links.push(resolved);
  const escaped = JSON.stringify(links).replace(/'/g, "''");
  safeRun('sqlite3', [localBrain, `INSERT OR REPLACE INTO config (key, value) VALUES ('linked_repos', '${escaped}');`], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Detect and store default branch for the linked repo
  const repoName = path.basename(resolved);
  let linkedDefault = 'main';
  try {
    const remoteHead = safeRun('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: resolved, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (remoteHead) linkedDefault = remoteHead.replace('refs/remotes/origin/', '');
  } catch {
    try {
      safeRun('git', ['rev-parse', '--verify', 'main'], { cwd: resolved, stdio: ['pipe', 'pipe', 'pipe'] });
      linkedDefault = 'main';
    } catch {
      try {
        safeRun('git', ['rev-parse', '--verify', 'master'], { cwd: resolved, stdio: ['pipe', 'pipe', 'pipe'] });
        linkedDefault = 'master';
      } catch {}
    }
  }

  safeRun('sqlite3', [localBrain, `INSERT OR REPLACE INTO config (key, value) VALUES ('default_branch:${repoName}', '${linkedDefault}');`], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  console.log(`${green}Linked: ${resolved}${reset}`);
  console.log(`${dim}Default branch for ${repoName}: ${linkedDefault}${reset}`);
  console.log(`${dim}Agents will now query both local and linked brains.${reset}`);
  console.log(`${dim}Total linked repos: ${links.length}${reset}\n`);
}

function cmdUnlink() {
  const targetPath = process.argv[3];
  const cwd = process.cwd();
  const localBrain = path.join(cwd, '.shipfast', 'brain.db');

  if (!fs.existsSync(localBrain)) {
    console.log(`${red}No local brain.db.${reset}\n`);
    return;
  }

  // Get existing links
  let links = [];
  try {
    const existing = safeRun('sqlite3', ['-json', localBrain, "SELECT value FROM config WHERE key = 'linked_repos';"], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed.length && parsed[0].value) links = JSON.parse(parsed[0].value);
    }
  } catch {}

  if (!targetPath) {
    // Unlink all
    if (links.length === 0) {
      console.log(`${dim}No linked repos.${reset}\n`);
      return;
    }
    safeRun('sqlite3', [localBrain, "DELETE FROM config WHERE key = 'linked_repos';"], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`${green}Unlinked all ${links.length} repos.${reset}\n`);
    return;
  }

  const resolved = path.resolve(cwd, targetPath);
  links = links.filter(l => l !== resolved);
  const escaped = JSON.stringify(links).replace(/'/g, "''");
  safeRun('sqlite3', [localBrain, `INSERT OR REPLACE INTO config (key, value) VALUES ('linked_repos', '${escaped}');`], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  console.log(`${green}Unlinked: ${resolved}${reset}\n`);
}

function findIndexer() {
  // Check all global runtime dirs + package source
  const paths = Object.values(RUNTIMES)
    .map(r => path.join(os.homedir(), r.path, 'shipfast', 'brain', 'indexer.cjs'));
  paths.push(path.join(__dirname, '..', 'brain', 'indexer.cjs'));
  return paths.find(p => fs.existsSync(p)) || null;
}

// ============================================================
// UPDATE — update package + re-detect + re-install
// ============================================================

function cmdUpdate() {
  console.log(`Updating...\n`);
  try {
    safeRun('npm', ['install', '-g', '@shipfast-ai/shipfast@latest'], {
      encoding: 'utf8', stdio: 'inherit'
    });
    console.log(`\n${cyan}Re-detecting runtimes...${reset}\n`);
    cmdInstall();
  } catch {
    console.log(`${yellow}Auto-update failed.${reset} Run: npm i -g @shipfast-ai/shipfast@latest\n`);
  }
}

// ============================================================
// UNINSTALL — remove from all detected runtimes
// ============================================================

function cmdUninstall() {
  let removed = 0;

  for (const [key, runtime] of Object.entries(RUNTIMES)) {
    const dir = path.join(os.homedir(), runtime.path);
    if (fs.existsSync(path.join(dir, 'shipfast'))) {
      // Remove shipfast dir + commands
      for (const d of [path.join(dir, 'shipfast'), path.join(dir, 'commands', 'sf')]) {
        if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
      }
      // Remove agents
      const ad = path.join(dir, 'agents');
      if (fs.existsSync(ad)) {
        for (const f of ['scout.md','architect.md','builder.md','critic.md','scribe.md']) {
          const fp = path.join(ad, f);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
      }
      // Remove hooks
      const hd = path.join(dir, 'hooks');
      if (fs.existsSync(hd)) {
        for (const f of fs.readdirSync(hd)) {
          if (f.startsWith('sf-')) fs.unlinkSync(path.join(hd, f));
        }
      }
      // Clean settings.json hooks (#18: remove empty arrays too)
      cleanSettings(dir);
      // Clean instruction files (CLAUDE.md, AGENTS.md, etc.)
      cleanInstructionFile(path.join(dir, 'CLAUDE.md'));
      cleanInstructionFile(path.join(dir, 'AGENTS.md'));
      cleanInstructionFile(path.join(dir, 'copilot-instructions.md'));
      cleanInstructionFile(path.join(dir, 'rules'));
      console.log(`  ${green}${runtime.name}${reset} — removed`);
      removed++;
    }
  }

  // Remove brain from cwd
  const brain = path.join(process.cwd(), '.shipfast');
  if (fs.existsSync(brain)) {
    fs.rmSync(brain, { recursive: true });
    console.log(`  ${dim}Removed .shipfast/brain.db${reset}`);
  }

  if (removed === 0) {
    console.log(`${dim}No installations found.${reset}`);
  } else {
    console.log(`\n${green}Removed from ${removed} runtime${removed > 1 ? 's' : ''}.${reset}`);
  }
  console.log(`${dim}Run: npm uninstall -g @shipfast-ai/shipfast${reset}\n`);
}

function cleanSettings(dir) {
  const sp = path.join(dir, 'settings.json');
  if (!fs.existsSync(sp)) return;
  try {
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    if (!s.hooks) return;
    let changed = false;
    for (const evt of ['PostToolUse', 'Notification', 'PreToolUse']) {
      if (!s.hooks[evt]) continue;
      const before = s.hooks[evt].length;
      s.hooks[evt] = s.hooks[evt].filter(e => {
        const cmd = e.hooks ? ((e.hooks[0] || {}).command || '') : (e.command || '');
        return !cmd.includes('sf-');
      });
      if (s.hooks[evt].length === 0) { delete s.hooks[evt]; changed = true; }
      else if (s.hooks[evt].length !== before) changed = true;
    }
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
    if (changed) fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  } catch {}
}

// ============================================================
// HELP
// ============================================================

function cmdHelp() {
  console.log(`${bold}Terminal commands:${reset}\n`);
  console.log(`  ${cyan}shipfast init${reset}             Index current repo into .shipfast/brain.db`);
  console.log(`  ${cyan}shipfast init --fresh${reset}     Full reindex (clears existing brain.db)`);
  console.log(`  ${cyan}shipfast link <path>${reset}      Link another repo for cross-repo search`);
  console.log(`  ${cyan}shipfast unlink [path]${reset}    Unlink a repo (or all)`);
  console.log(`  ${cyan}shipfast status${reset}           Show installed runtimes + brain + links`);
  console.log(`  ${cyan}shipfast update${reset}           Update to latest + re-detect runtimes`);
  console.log(`  ${cyan}shipfast uninstall${reset}        Remove from all AI tools`);
  console.log(`  ${cyan}shipfast doctor${reset}          Check brain.db health + diagnose issues`);
  console.log(`  ${cyan}shipfast permissions${reset}     Show configured permission allowlist`);
  console.log(`  ${cyan}shipfast help${reset}             Show this help\n`);
  console.log(`${bold}In your AI tool:${reset}\n`);
  console.log(`  ${cyan}/sf-do${reset} <task>         The one command — describe what you want`);
  console.log(`  ${cyan}/sf-discuss${reset} <task>    Clarify ambiguity before planning`);
  console.log(`  ${cyan}/sf-project${reset} <desc>    Decompose a large project into phases`);
  console.log(`  ${cyan}/sf-ship${reset}              Create PR from completed work`);
  console.log(`  ${cyan}/sf-status${reset}            Show progress and token usage`);
  console.log(`  ${cyan}/sf-resume${reset}            Resume work from previous session`);
  console.log(`  ${cyan}/sf-undo${reset}              Rollback a task`);
  console.log(`  ${cyan}/sf-brain${reset} <query>     Query the knowledge graph`);
  console.log(`  ${cyan}/sf-learn${reset} <pattern>   Teach a pattern or lesson`);
  console.log(`  ${cyan}/sf-config${reset}            Set model tiers and preferences`);
  console.log(`  ${cyan}/sf-milestone${reset}         Complete or start a milestone`);
  console.log(`  ${cyan}/sf-help${reset}              Show all commands\n`);
}

// ============================================================
// Helpers
// ============================================================

function writeSettings(dir, hooksDir) {
  const sp = path.join(dir, 'settings.json');
  let s = {};
  if (fs.existsSync(sp)) { try { s = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch {} }
  if (!s.hooks) s.hooks = {};

  function has(arr, file) {
    return (arr || []).some(e => {
      if (e.hooks && Array.isArray(e.hooks)) return e.hooks.some(h => (h.command || '').includes(file));
      return (e.command || '').includes(file);
    });
  }
  function mk(cmd) { return { matcher: '', hooks: [{ type: 'command', command: cmd }] }; }

  for (const [evt, file] of [['PostToolUse','sf-context-monitor.js'],['Notification','sf-statusline.js'],['PreToolUse','sf-first-run.js'],['PreToolUse','sf-prompt-guard.js']]) {
    s.hooks[evt] = s.hooks[evt] || [];
    if (!has(s.hooks[evt], file)) s.hooks[evt].push(mk('node ' + path.join(hooksDir, file)));
  }

  // Auto-configure safe permission allowlist — no --dangerously-skip-permissions needed
  if (!s.permissions) s.permissions = {};
  if (!s.permissions.allow) s.permissions.allow = [];

  const shipfastPermissions = [
    'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent',
    'Bash(git *)', 'Bash(npm run build*)', 'Bash(npm test*)',
    'Bash(npx tsc*)', 'Bash(npx vitest*)', 'Bash(cargo check*)',
    'Bash(grep *)', 'Bash(find *)', 'Bash(wc *)', 'Bash(cat *)',
    'Bash(ls *)', 'Bash(mkdir *)', 'Bash(node *)'
  ];

  for (const perm of shipfastPermissions) {
    if (!s.permissions.allow.includes(perm)) {
      s.permissions.allow.push(perm);
    }
  }

  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
}

function writeMcpConfig(dir) {
  const serverPath = path.join(dir, 'shipfast', 'mcp', 'server.cjs');
  const settingsPath = path.join(dir, 'settings.json');
  let s = {};
  if (fs.existsSync(settingsPath)) { try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {} }

  if (!s.mcpServers) s.mcpServers = {};

  s.mcpServers['shipfast-brain'] = {
    command: 'node',
    args: [serverPath],
    env: {}
  };

  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

function writeInstruction(filePath) {
  const marker = '<!-- ShipFast -->';
  const close = '<!-- /ShipFast -->';
  const block = `${marker}\n## ShipFast\nThis repo uses ShipFast. Brain: .shipfast/brain.db\n\nFor any task: \`/sf-do <task>\` (recommended — full pipeline with fresh context per task).\nFor new projects: \`/sf-project <description>\` — runs discovery first (10-category questioning until the project is fully understood).\nFor quick edits: check brain_decisions and brain_learnings MCP tools before changes.\n\nContext: ShipFast saves progress to brain.db automatically.\nIf context runs low, run \`/sf-resume\` in a new session — all state persists.\nRun \`/sf-help\` for all 20 commands.\n${close}`;

  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    const s = content.indexOf(marker);
    const e = content.indexOf(close);
    if (s !== -1 && e !== -1) content = content.slice(0, s) + content.slice(e + close.length);
  }
  content = content.trimEnd() + '\n\n' + block + '\n';
  fs.writeFileSync(filePath, content);
}

// Remove ShipFast block from instruction files during uninstall
function cleanInstructionFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const marker = '<!-- ShipFast -->';
    const close = '<!-- /ShipFast -->';
    const s = content.indexOf(marker);
    const e = content.indexOf(close);
    if (s !== -1 && e !== -1) {
      content = content.slice(0, s) + content.slice(e + close.length);
      content = content.trim() + '\n';
      fs.writeFileSync(filePath, content);
    }
  } catch {}
}

// CLI status command — show installed runtimes + version + brain status
function cmdStatus() {
  console.log(`${bold}Installed runtimes:${reset}\n`);
  let count = 0;
  for (const [key, runtime] of Object.entries(RUNTIMES)) {
    const dir = path.join(os.homedir(), runtime.path);
    if (fs.existsSync(path.join(dir, 'shipfast'))) {
      console.log(`  ${green}${runtime.name}${reset} ${dim}${dir}${reset}`);
      count++;
    }
  }
  if (count === 0) {
    console.log(`  ${dim}(none)${reset}`);
  }

  // Brain status for current directory
  const cwd = process.cwd();
  const brainPath = path.join(cwd, '.shipfast', 'brain.db');
  console.log(`\n${bold}Current repo:${reset} ${cwd}\n`);
  if (fs.existsSync(brainPath)) {
    try {
      const out = safeRun('sqlite3', [brainPath,
        "SELECT 'nodes', COUNT(*) FROM nodes UNION ALL SELECT 'edges', COUNT(*) FROM edges UNION ALL SELECT 'decisions', COUNT(*) FROM decisions UNION ALL SELECT 'learnings', COUNT(*) FROM learnings;"
      ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`  Brain: ${green}indexed${reset}`);
      out.trim().split('\n').forEach(line => {
        const [k, v] = line.split('|');
        console.log(`  ${dim}${k}: ${v}${reset}`);
      });
    } catch {
      console.log(`  Brain: ${green}exists${reset} (.shipfast/brain.db)`);
    }
  } else {
    console.log(`  Brain: ${yellow}not indexed${reset} — run ${cyan}shipfast init${reset}`);
  }
  console.log('');
}

function copy(rel, dest) {
  const src = path.join(__dirname, '..', rel);
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

main();
