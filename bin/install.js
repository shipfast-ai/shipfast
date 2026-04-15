#!/usr/bin/env node

/**
 * ShipFast CLI
 *
 * Global install: agents, commands, hooks, core go to ~/.claude/ (or other runtime)
 * Per-repo: `shipfast init` indexes codebase into .shipfast/brain.db
 *
 * Usage:
 *   npm install -g @shipfast-ai/shipfast    # Install globally (one time)
 *   shipfast install --claude               # Setup for a runtime
 *   shipfast install --all                  # Setup for all runtimes
 *   shipfast init                           # Index current repo's codebase
 *   shipfast train                          # Re-index (alias for init)
 *   shipfast update                         # Update to latest version
 *   shipfast uninstall                      # Remove ShipFast
 *
 * Also works with npx:
 *   npx @shipfast-ai/shipfast install --claude
 *   npx @shipfast-ai/shipfast init
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execFileSync: safeExec } = require('child_process');

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
const command = args[0] || '';

// Runtime detection — all 14 runtimes
const RUNTIMES = {
  claude:       { dir: '.claude',     global: '.claude',                          name: 'Claude Code' },
  opencode:     { dir: '.opencode',   global: path.join('.config', 'opencode'),   name: 'OpenCode' },
  gemini:       { dir: '.gemini',     global: '.gemini',                          name: 'Gemini CLI' },
  kilo:         { dir: '.kilo',       global: path.join('.config', 'kilo'),       name: 'Kilo' },
  codex:        { dir: '.codex',      global: '.codex',                           name: 'Codex' },
  copilot:      { dir: '.github',     global: '.copilot',                         name: 'Copilot' },
  cursor:       { dir: '.cursor',     global: '.cursor',                          name: 'Cursor' },
  windsurf:     { dir: '.windsurf',   global: path.join('.codeium', 'windsurf'),  name: 'Windsurf' },
  antigravity:  { dir: '.agent',      global: path.join('.gemini', 'antigravity'),name: 'Antigravity' },
  augment:      { dir: '.augment',    global: '.augment',                         name: 'Augment' },
  trae:         { dir: '.trae',       global: '.trae',                            name: 'Trae' },
  qwen:         { dir: '.qwen',       global: '.qwen',                            name: 'Qwen Code' },
  codebuddy:    { dir: '.codebuddy',  global: '.codebuddy',                       name: 'CodeBuddy' },
  cline:        { dir: '.cline',      global: '.cline',                           name: 'Cline' },
};

// Parse runtime flags
const hasAll = args.includes('--all');
let selectedRuntimes = [];
if (hasAll) {
  selectedRuntimes = Object.keys(RUNTIMES);
} else {
  for (const key of Object.keys(RUNTIMES)) {
    if (args.includes(`--${key}`)) selectedRuntimes.push(key);
  }
}

// ============================================================
// Main router
// ============================================================

async function main() {
  console.log(`\n${bold}${cyan}ShipFast${reset} v${pkg.version}`);
  console.log(`${dim}5 agents. 12 commands. SQLite brain. 3-5x less tokens than alternatives.${reset}\n`);

  const cmd = command.toLowerCase();

  // Route to subcommand
  if (cmd === 'init' || cmd === 'train') {
    return initRepo();
  }
  if (cmd === 'uninstall' || cmd === '--uninstall' || cmd === '-u') {
    return uninstallAll();
  }
  if (cmd === 'update') {
    return updateSelf();
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    return; // version already printed
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return showHelp();
  }

  // Default: install (handles `shipfast install --claude`, `shipfast --claude`, `npx ... --claude`)
  return installGlobal();
}

// ============================================================
// INSTALL — one-time global setup for runtimes
// ============================================================

async function installGlobal() {
  if (selectedRuntimes.length === 0) {
    selectedRuntimes = await promptRuntimeMultiSelect();
  }

  for (const rtKey of selectedRuntimes) {
    const runtime = RUNTIMES[rtKey];
    if (!runtime) { console.error(`${red}Unknown: ${rtKey}${reset}`); continue; }

    const targetDir = path.join(os.homedir(), runtime.global);
    console.log(`${cyan}Installing for ${runtime.name}...${reset}`);
    console.log(`${dim}  ${targetDir}${reset}`);
    installToDir(targetDir, runtime.name);
  }

  console.log(`\n${green}${bold}Installed for ${selectedRuntimes.length} runtime${selectedRuntimes.length > 1 ? 's' : ''}!${reset}`);
  console.log(`\nCommands available globally in all projects:`);
  printCommands();

  // If we're in a git repo, offer to init
  if (isGitRepo(process.cwd())) {
    console.log(`${yellow}Git repo detected.${reset} Indexing codebase...`);
    initRepo();
  } else {
    console.log(`${dim}Run ${cyan}shipfast init${reset}${dim} inside any git repo to index it.${reset}\n`);
  }
}

function installToDir(targetDir, runtimeName) {
  const sfDir = path.join(targetDir, 'shipfast');
  const commandsDir = path.join(targetDir, 'commands');
  const hooksDir = path.join(targetDir, 'hooks');

  for (const dir of [sfDir, commandsDir, hooksDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Copy brain module
  const brainDir = path.join(sfDir, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  for (const f of ['schema.sql', 'index.cjs', 'indexer.cjs']) {
    copyFile(path.join(__dirname, '..', 'brain', f), path.join(brainDir, f));
  }

  // Copy core module
  const coreDir = path.join(sfDir, 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  for (const f of ['autopilot.cjs', 'budget.cjs', 'checkpoint.cjs', 'learning.cjs', 'ambiguity.cjs', 'context-builder.cjs', 'conversation.cjs', 'executor.cjs', 'git-intel.cjs', 'guardrails.cjs', 'model-selector.cjs', 'retry.cjs', 'session.cjs', 'skip-logic.cjs', 'templates.cjs', 'verify.cjs']) {
    copyFile(path.join(__dirname, '..', 'core', f), path.join(coreDir, f));
  }

  // Copy agents
  const agentsDir = path.join(targetDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const f of ['scout.md', 'architect.md', 'builder.md', 'critic.md', 'scribe.md']) {
    copyFile(path.join(__dirname, '..', 'agents', f), path.join(agentsDir, f));
  }

  // Copy commands
  const sfCommandsDir = path.join(commandsDir, 'sf');
  fs.mkdirSync(sfCommandsDir, { recursive: true });
  for (const f of ['do.md', 'status.md', 'undo.md', 'config.md', 'brain.md', 'learn.md', 'discuss.md', 'project.md', 'resume.md', 'ship.md', 'help.md', 'milestone.md']) {
    copyFile(path.join(__dirname, '..', 'commands', 'sf', f), path.join(sfCommandsDir, f));
  }

  // Copy hooks
  for (const f of ['sf-context-monitor.js', 'sf-statusline.js', 'sf-first-run.js']) {
    copyFile(path.join(__dirname, '..', 'hooks', f), path.join(hooksDir, f));
  }

  // Runtime-specific config
  const claudeCompatible = ['Claude Code', 'OpenCode', 'Kilo'];
  const geminiCompatible = ['Gemini CLI', 'Antigravity'];

  if (claudeCompatible.includes(runtimeName)) {
    updateSettings(targetDir, hooksDir);
    updateInstructionFile(path.join(targetDir, 'CLAUDE.md'));
  } else if (geminiCompatible.includes(runtimeName)) {
    updateInstructionFile(path.join(targetDir, 'AGENTS.md'));
  } else if (runtimeName === 'Copilot') {
    updateInstructionFile(path.join(targetDir, 'copilot-instructions.md'));
  } else if (runtimeName === 'Cursor') {
    updateInstructionFile(path.join(targetDir, 'rules'));
  } else {
    updateInstructionFile(path.join(targetDir, 'AGENTS.md'));
  }
}

// ============================================================
// INIT — index current repo's codebase
// ============================================================

function initRepo() {
  const cwd = process.cwd();

  if (!isGitRepo(cwd)) {
    console.log(`${red}Not a git repo.${reset} Run this inside a git repository.`);
    return;
  }

  // Find the indexer (check global install locations)
  const indexerPath = findIndexer();
  if (!indexerPath) {
    console.log(`${red}ShipFast not installed.${reset} Run: ${cyan}shipfast install --claude${reset} first.`);
    return;
  }

  const brainDbPath = path.join(cwd, '.shipfast', 'brain.db');
  const isRetrain = fs.existsSync(brainDbPath);

  console.log(isRetrain ? `${cyan}Re-indexing codebase...${reset}` : `${cyan}Indexing codebase...${reset}`);

  try {
    const output = safeExec(process.execPath, [indexerPath, cwd], {
      encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`${green}${output.trim()}${reset}`);
    addToGitignore(cwd);
    console.log(`\n${dim}Brain ready at .shipfast/brain.db${reset}`);
    console.log(`${dim}Use /sf-do in your AI coding tool to start working.${reset}\n`);
  } catch (err) {
    console.log(`${red}Indexing failed: ${err.message.slice(0, 100)}${reset}`);
  }
}

function findIndexer() {
  // Check all possible global locations
  const candidates = [
    path.join(os.homedir(), '.claude', 'shipfast', 'brain', 'indexer.cjs'),
    path.join(os.homedir(), '.cursor', 'shipfast', 'brain', 'indexer.cjs'),
    path.join(os.homedir(), '.gemini', 'shipfast', 'brain', 'indexer.cjs'),
    path.join(os.homedir(), '.codex', 'shipfast', 'brain', 'indexer.cjs'),
    path.join(os.homedir(), '.config', 'opencode', 'shipfast', 'brain', 'indexer.cjs'),
    path.join(os.homedir(), '.config', 'kilo', 'shipfast', 'brain', 'indexer.cjs'),
    // Also check local .claude/ (backward compat with old local installs)
    path.join(process.cwd(), '.claude', 'shipfast', 'brain', 'indexer.cjs'),
    // Also check if running from the package source directly
    path.join(__dirname, '..', 'brain', 'indexer.cjs'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

// ============================================================
// UPDATE — update to latest version
// ============================================================

function updateSelf() {
  console.log(`${cyan}Updating ShipFast...${reset}`);
  try {
    safeExec('npm', ['install', '-g', '@shipfast-ai/shipfast@latest'], {
      encoding: 'utf8', stdio: 'inherit'
    });
    console.log(`${green}Updated! Run ${cyan}shipfast install --claude${reset}${green} to update runtime files.${reset}`);
  } catch {
    console.log(`${yellow}Auto-update failed. Run manually:${reset}`);
    console.log(`  npm install -g @shipfast-ai/shipfast@latest`);
  }
}

// ============================================================
// UNINSTALL — remove from all runtimes
// ============================================================

function uninstallAll() {
  let uninstalled = 0;

  const runtimesToCheck = selectedRuntimes.length > 0
    ? selectedRuntimes.map(k => [k, RUNTIMES[k]]).filter(([_, v]) => v)
    : Object.entries(RUNTIMES);

  for (const [rtKey, runtime] of runtimesToCheck) {
    // Check global
    const globalDir = path.join(os.homedir(), runtime.global);
    if (fs.existsSync(path.join(globalDir, 'shipfast'))) {
      uninstallFromDir(globalDir, runtime.name);
      uninstalled++;
    }
    // Check local (cwd)
    const localDir = path.join(process.cwd(), runtime.dir);
    if (fs.existsSync(path.join(localDir, 'shipfast'))) {
      uninstallFromDir(localDir, runtime.name);
      uninstalled++;
    }
  }

  // Also remove .shipfast/ brain from cwd
  const brainDir = path.join(process.cwd(), '.shipfast');
  if (fs.existsSync(brainDir)) {
    fs.rmSync(brainDir, { recursive: true });
    console.log(`${dim}Removed .shipfast/brain.db${reset}`);
  }

  if (uninstalled === 0) {
    console.log(`${dim}No ShipFast installations found.${reset}`);
  } else {
    console.log(`\n${green}Uninstalled from ${uninstalled} location${uninstalled > 1 ? 's' : ''}.${reset}`);
  }
}

function uninstallFromDir(targetDir, runtimeName) {
  const sfDir = path.join(targetDir, 'shipfast');
  const sfCommands = path.join(targetDir, 'commands', 'sf');
  const agentsDir = path.join(targetDir, 'agents');

  for (const dir of [sfDir, sfCommands]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  }

  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (['scout.md', 'architect.md', 'builder.md', 'critic.md', 'scribe.md'].includes(file)) {
        fs.unlinkSync(path.join(agentsDir, file));
      }
    }
  }

  const hooksDir = path.join(targetDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    for (const file of fs.readdirSync(hooksDir)) {
      if (file.startsWith('sf-')) fs.unlinkSync(path.join(hooksDir, file));
    }
  }

  console.log(`  ${green}Removed from ${runtimeName}${reset} (${targetDir})`);
}

// ============================================================
// HELP
// ============================================================

function showHelp() {
  console.log(`${bold}Usage:${reset}\n`);
  console.log(`  ${cyan}shipfast install --claude${reset}       Install globally for Claude Code`);
  console.log(`  ${cyan}shipfast install --all${reset}          Install for all 14 runtimes`);
  console.log(`  ${cyan}shipfast install --claude --cursor${reset}  Install for multiple runtimes`);
  console.log(`  ${cyan}shipfast init${reset}                   Index current repo's codebase`);
  console.log(`  ${cyan}shipfast train${reset}                  Re-index codebase (same as init)`);
  console.log(`  ${cyan}shipfast update${reset}                 Update to latest version`);
  console.log(`  ${cyan}shipfast uninstall${reset}              Remove from all runtimes`);
  console.log(`  ${cyan}shipfast help${reset}                   Show this help\n`);
  console.log(`${bold}Runtimes:${reset}`);
  console.log(`  Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot,`);
  console.log(`  Cursor, Windsurf, Antigravity, Augment, Trae, Qwen Code,`);
  console.log(`  CodeBuddy, Cline\n`);
  console.log(`${bold}Workflow:${reset}`);
  console.log(`  1. ${cyan}npm i -g @shipfast-ai/shipfast${reset}   Install package globally`);
  console.log(`  2. ${cyan}shipfast install --claude${reset}        Setup for your AI tool`);
  console.log(`  3. ${cyan}cd your-project && shipfast init${reset} Index your codebase`);
  console.log(`  4. Use /sf-do in your AI tool to start working\n`);
  printCommands();
}

function printCommands() {
  console.log(`\n${bold}Commands (in your AI tool):${reset}`);
  console.log(`  ${cyan}/sf-do${reset}         The one command — describe what you want`);
  console.log(`  ${cyan}/sf-discuss${reset}    Clarify ambiguity before planning`);
  console.log(`  ${cyan}/sf-project${reset}    Decompose a large project into phases`);
  console.log(`  ${cyan}/sf-ship${reset}       Create PR from completed work`);
  console.log(`  ${cyan}/sf-status${reset}     Show progress and token usage`);
  console.log(`  ${cyan}/sf-resume${reset}     Resume work from previous session`);
  console.log(`  ${cyan}/sf-undo${reset}       Rollback a task`);
  console.log(`  ${cyan}/sf-brain${reset}      Query the knowledge graph`);
  console.log(`  ${cyan}/sf-learn${reset}      Teach a pattern or lesson`);
  console.log(`  ${cyan}/sf-config${reset}     Set token budget and model tiers`);
  console.log(`  ${cyan}/sf-milestone${reset}  Complete or start a milestone`);
  console.log(`  ${cyan}/sf-help${reset}       Show all commands\n`);
}

// ============================================================
// Settings & config helpers
// ============================================================

function updateSettings(targetDir, hooksDir) {
  const settingsPath = path.join(targetDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
  }

  if (!settings.hooks) settings.hooks = {};
  settings.hooks['PostToolUse'] = settings.hooks['PostToolUse'] || [];
  settings.hooks['Notification'] = settings.hooks['Notification'] || [];
  settings.hooks['PreToolUse'] = settings.hooks['PreToolUse'] || [];

  function hasSfHook(arr, filename) {
    return (arr || []).some(entry => {
      if (entry.hooks && Array.isArray(entry.hooks)) {
        return entry.hooks.some(h => (h.command || '').includes(filename));
      }
      return (entry.command || '').includes(filename);
    });
  }

  function makeHook(cmd) {
    return { matcher: '', hooks: [{ type: 'command', command: cmd }] };
  }

  const ctxMon = path.join(hooksDir, 'sf-context-monitor.js');
  if (!hasSfHook(settings.hooks['PostToolUse'], 'sf-context-monitor')) {
    settings.hooks['PostToolUse'].push(makeHook('node ' + ctxMon));
  }

  const statusline = path.join(hooksDir, 'sf-statusline.js');
  if (!hasSfHook(settings.hooks['Notification'], 'sf-statusline')) {
    settings.hooks['Notification'].push(makeHook('node ' + statusline));
  }

  const firstRun = path.join(hooksDir, 'sf-first-run.js');
  if (!hasSfHook(settings.hooks['PreToolUse'], 'sf-first-run')) {
    settings.hooks['PreToolUse'].push(makeHook('node ' + firstRun));
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function updateInstructionFile(filePath) {
  const marker = '<!-- ShipFast Configuration -->';
  const closeMarker = '<!-- /ShipFast Configuration -->';

  const sfBlock = `${marker}
## ShipFast

This project uses ShipFast for autonomous development.

### Commands
- \`/sf-do <task>\` — Single entry point. Describe what you want in natural language.
- \`/sf-discuss <task>\` — Clarify ambiguity before planning.
- \`/sf-project <desc>\` — Decompose a large project into phases.
- \`/sf-ship\` — Create PR from completed work.
- \`/sf-status\` — Show progress, token usage, brain stats.
- \`/sf-resume\` — Resume work from previous session.
- \`/sf-undo [task-id]\` — Rollback a completed task.
- \`/sf-brain <query>\` — Query the codebase knowledge graph.
- \`/sf-learn <pattern>: <lesson>\` — Teach a reusable lesson.
- \`/sf-config [key] [value]\` — View/set token budget and model tiers.
- \`/sf-milestone [complete|new]\` — Complete or start a milestone.
- \`/sf-help\` — Show all commands.

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
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    const startIdx = content.indexOf(marker);
    const endIdx = content.indexOf(closeMarker);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + closeMarker.length);
    }
  }

  content = content.trimEnd() + '\n\n' + sfBlock + '\n';
  fs.writeFileSync(filePath, content);
}

// ============================================================
// Utilities
// ============================================================

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function addToGitignore(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.shipfast/';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (content.includes(entry)) return;
    fs.appendFileSync(gitignorePath, '\n# ShipFast brain (local, not committed)\n' + entry + '\n');
  } else {
    fs.writeFileSync(gitignorePath, '# ShipFast brain (local, not committed)\n' + entry + '\n');
  }
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

async function promptRuntimeMultiSelect() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Select runtimes (comma-separated numbers, or "all"):\n');
  const entries = Object.entries(RUNTIMES);
  entries.forEach(([key, rt], i) => {
    console.log(`  ${bold}${String(i + 1).padStart(2)}${reset}. ${rt.name}`);
  });
  console.log(`\n  ${bold} a${reset}. All runtimes`);

  return new Promise(resolve => {
    rl.question(`\n${cyan}>${reset} `, answer => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'all' || trimmed === 'a') { resolve(Object.keys(RUNTIMES)); return; }
      const nums = trimmed.split(/[\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
      const selected = nums.map(n => n - 1).filter(i => i >= 0 && i < entries.length).map(i => entries[i][0]);
      resolve(selected.length > 0 ? selected : ['claude']);
    });
  });
}

main().catch(err => {
  console.error(`${red}Error: ${err.message}${reset}`);
  process.exit(1);
});
