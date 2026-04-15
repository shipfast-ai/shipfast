#!/usr/bin/env node

/**
 * ShipFast Installer
 *
 * Installs ShipFast into Claude Code, OpenCode, Gemini CLI, Codex, or other AI runtimes.
 * Copies agents, commands, hooks, brain, and core modules to the runtime's config directory.
 *
 * Usage:
 *   npx shipfast                    # Interactive — asks which runtime
 *   npx shipfast --claude            # Install for Claude Code
 *   npx shipfast --claude --global   # Install globally (~/.claude/)
 *   npx shipfast --claude --local    # Install in current project (.claude/)
 *   npx shipfast --uninstall         # Remove ShipFast
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

const pkg = require('../package.json');

// Parse args
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal = args.includes('--local') || args.includes('-l');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');

// Runtime detection
const RUNTIMES = {
  claude: { dir: '.claude', global: '.claude', name: 'Claude Code' },
  opencode: { dir: '.opencode', global: path.join('.config', 'opencode'), name: 'OpenCode' },
  gemini: { dir: '.gemini', global: '.gemini', name: 'Gemini CLI' },
  codex: { dir: '.codex', global: '.codex', name: 'Codex' },
  cursor: { dir: '.cursor', global: '.cursor', name: 'Cursor' },
  windsurf: { dir: '.windsurf', global: '.windsurf', name: 'Windsurf' },
};

let selectedRuntime = null;
for (const [key, _] of Object.entries(RUNTIMES)) {
  if (args.includes(`--${key}`)) {
    selectedRuntime = key;
    break;
  }
}

async function main() {
  console.log(`\n${bold}${cyan}ShipFast${reset} v${pkg.version}`);
  console.log(`${dim}5 agents. 6 commands. SQLite brain. 3-5x cheaper than GSD.${reset}\n`);

  if (!selectedRuntime) {
    selectedRuntime = await promptRuntime();
  }

  const runtime = RUNTIMES[selectedRuntime];
  if (!runtime) {
    console.error(`${red}Unknown runtime: ${selectedRuntime}${reset}`);
    process.exit(1);
  }

  const isGlobal = hasGlobal || (!hasLocal && await promptScope());
  const targetDir = isGlobal
    ? path.join(os.homedir(), runtime.global)
    : path.join(process.cwd(), runtime.dir);

  if (hasUninstall) {
    return uninstall(targetDir, runtime.name);
  }

  console.log(`${dim}Installing to: ${targetDir}${reset}\n`);
  install(targetDir, runtime.name, isGlobal);
}

function install(targetDir, runtimeName, isGlobal) {
  const sfDir = path.join(targetDir, 'shipfast');
  const commandsDir = path.join(targetDir, 'commands');
  const hooksDir = path.join(targetDir, 'hooks');

  // Create directories
  for (const dir of [sfDir, commandsDir, hooksDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Copy brain module
  const brainDir = path.join(sfDir, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  copyFile(path.join(__dirname, '..', 'brain', 'schema.sql'), path.join(brainDir, 'schema.sql'));
  copyFile(path.join(__dirname, '..', 'brain', 'index.cjs'), path.join(brainDir, 'index.cjs'));
  copyFile(path.join(__dirname, '..', 'brain', 'indexer.cjs'), path.join(brainDir, 'indexer.cjs'));

  // Copy core module
  const coreDir = path.join(sfDir, 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  for (const file of ['autopilot.cjs', 'budget.cjs', 'checkpoint.cjs', 'learning.cjs', 'ambiguity.cjs', 'context-builder.cjs', 'conversation.cjs', 'executor.cjs', 'git-intel.cjs', 'guardrails.cjs', 'model-selector.cjs', 'retry.cjs', 'session.cjs', 'skip-logic.cjs', 'templates.cjs', 'verify.cjs']) {
    copyFile(path.join(__dirname, '..', 'core', file), path.join(coreDir, file));
  }

  // Copy agents
  const agentsDir = path.join(targetDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const file of ['scout.md', 'architect.md', 'builder.md', 'critic.md', 'scribe.md']) {
    copyFile(path.join(__dirname, '..', 'agents', file), path.join(agentsDir, file));
  }

  // Copy commands
  const sfCommandsDir = path.join(commandsDir, 'sf');
  fs.mkdirSync(sfCommandsDir, { recursive: true });
  for (const file of ['do.md', 'status.md', 'undo.md', 'config.md', 'brain.md', 'learn.md', 'discuss.md', 'project.md', 'resume.md', 'ship.md', 'help.md', 'milestone.md']) {
    copyFile(path.join(__dirname, '..', 'commands', 'sf', file), path.join(sfCommandsDir, file));
  }

  // Copy hooks
  for (const file of ['sf-context-monitor.js', 'sf-statusline.js']) {
    copyFile(path.join(__dirname, '..', 'hooks', file), path.join(hooksDir, file));
  }

  // Update settings.json with hooks
  updateSettings(targetDir, runtimeName, hooksDir);

  // Update CLAUDE.md (or equivalent) with ShipFast instructions
  updateClaudeMd(targetDir, isGlobal);

  console.log(`${green}${bold}Installed!${reset}\n`);
  console.log(`Commands available:`);
  console.log(`  ${cyan}/sf-do${reset}      The one command — describe what you want`);
  console.log(`  ${cyan}/sf-status${reset}  Show progress and token usage`);
  console.log(`  ${cyan}/sf-undo${reset}    Rollback a task`);
  console.log(`  ${cyan}/sf-config${reset}  Set token budget and model tiers`);
  console.log(`  ${cyan}/sf-brain${reset}   Query the knowledge graph`);
  console.log(`  ${cyan}/sf-learn${reset}   Teach a pattern or lesson\n`);
  console.log(`${dim}Start with: /sf-do add user authentication${reset}\n`);
}

function uninstall(targetDir, runtimeName) {
  const sfDir = path.join(targetDir, 'shipfast');
  const sfCommands = path.join(targetDir, 'commands', 'sf');
  const agentsDir = path.join(targetDir, 'agents');

  // Remove ShipFast files
  for (const dir of [sfDir, sfCommands]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }

  // Remove agent files (only sf- prefixed)
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (['scout.md', 'architect.md', 'builder.md', 'critic.md', 'scribe.md'].includes(file)) {
        fs.unlinkSync(path.join(agentsDir, file));
      }
    }
  }

  // Remove hooks
  const hooksDir = path.join(targetDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    for (const file of fs.readdirSync(hooksDir)) {
      if (file.startsWith('sf-')) {
        fs.unlinkSync(path.join(hooksDir, file));
      }
    }
  }

  console.log(`${green}ShipFast uninstalled from ${runtimeName}.${reset}`);
}

function updateSettings(targetDir, runtimeName, hooksDir) {
  const settingsPath = path.join(targetDir, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
  }

  // Add hooks
  if (!settings.hooks) settings.hooks = {};

  settings.hooks['PostToolUse'] = settings.hooks['PostToolUse'] || [];
  settings.hooks['Notification'] = settings.hooks['Notification'] || [];

  // Add context monitor if not present
  const contextMonitorPath = path.join(hooksDir, 'sf-context-monitor.js');
  const hasContextMonitor = (settings.hooks['PostToolUse'] || []).some(
    h => (typeof h === 'string' ? h : h.command || '').includes('sf-context-monitor')
  );
  if (!hasContextMonitor) {
    settings.hooks['PostToolUse'].push({
      command: `node "${contextMonitorPath}"`,
      description: 'ShipFast context monitor'
    });
  }

  // Add statusline if not present
  const statuslinePath = path.join(hooksDir, 'sf-statusline.js');
  const hasStatusline = (settings.hooks['Notification'] || []).some(
    h => (typeof h === 'string' ? h : h.command || '').includes('sf-statusline')
  );
  if (!hasStatusline) {
    settings.hooks['Notification'].push({
      command: `node "${statuslinePath}"`,
      description: 'ShipFast statusline'
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function updateClaudeMd(targetDir, isGlobal) {
  const claudeMdPath = isGlobal
    ? path.join(targetDir, 'CLAUDE.md')
    : path.join(process.cwd(), 'CLAUDE.md');

  const marker = '<!-- ShipFast Configuration -->';
  const closeMarker = '<!-- /ShipFast Configuration -->';

  const sfBlock = `${marker}
## ShipFast

This project uses ShipFast for autonomous development.

### Commands
- \`/sf-do <task>\` — Single entry point. Describe what you want in natural language.
- \`/sf-status\` — Show progress, token usage, brain stats.
- \`/sf-undo [task-id]\` — Rollback a completed task.
- \`/sf-config [key] [value]\` — View/set token budget and model tiers.
- \`/sf-brain <query>\` — Query the codebase knowledge graph.
- \`/sf-learn <pattern>: <lesson>\` — Teach a reusable lesson.

### How It Works
- Brain: SQLite knowledge graph at \`.shipfast/brain.db\` — auto-indexes codebase
- Agents: 5 composable agents (Scout, Architect, Builder, Critic, Scribe)
- Workflow: Auto-selects depth (trivial/medium/complex) based on task complexity
- Learning: Records failures and solutions, gets smarter over time

### Rules
- Do NOT create .planning/ directories or markdown state files
- All state goes to brain.db via the ShipFast core modules
- Prefer /sf-do over manual multi-step workflows
${closeMarker}`;

  let content = '';
  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf8');
    // Remove existing block
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(closeMarker);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + closeMarker.length);
    }
  }

  content = content.trimEnd() + '\n\n' + sfBlock + '\n';
  fs.writeFileSync(claudeMdPath, content);
}

// ============================================================
// Interactive prompts
// ============================================================

async function promptRuntime() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Select runtime:\n');
  const entries = Object.entries(RUNTIMES);
  entries.forEach(([key, rt], i) => {
    console.log(`  ${bold}${i + 1}${reset}. ${rt.name}`);
  });

  return new Promise(resolve => {
    rl.question(`\n${cyan}>${reset} `, answer => {
      rl.close();
      const idx = parseInt(answer) - 1;
      if (idx >= 0 && idx < entries.length) {
        resolve(entries[idx][0]);
      } else {
        resolve('claude'); // default
      }
    });
  });
}

async function promptScope() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    rl.question(`Install ${bold}globally${reset} (all projects) or ${bold}locally${reset} (this project)? [g/l] `, answer => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('g'));
    });
  });
}

// ============================================================
// Utils
// ============================================================

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

main().catch(err => {
  console.error(`${red}Error: ${err.message}${reset}`);
  process.exit(1);
});
