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

// Runtime detection — all 14 runtimes
const RUNTIMES = {
  claude:       { dir: '.claude',     global: '.claude',                         name: 'Claude Code' },
  opencode:     { dir: '.opencode',   global: path.join('.config', 'opencode'),  name: 'OpenCode' },
  gemini:       { dir: '.gemini',     global: '.gemini',                         name: 'Gemini CLI' },
  kilo:         { dir: '.kilo',       global: path.join('.config', 'kilo'),      name: 'Kilo' },
  codex:        { dir: '.codex',      global: '.codex',                          name: 'Codex' },
  copilot:      { dir: '.github',     global: '.copilot',                        name: 'Copilot' },
  cursor:       { dir: '.cursor',     global: '.cursor',                         name: 'Cursor' },
  windsurf:     { dir: '.windsurf',   global: path.join('.codeium', 'windsurf'),  name: 'Windsurf' },
  antigravity:  { dir: '.agent',      global: path.join('.gemini', 'antigravity'), name: 'Antigravity' },
  augment:      { dir: '.augment',    global: '.augment',                        name: 'Augment' },
  trae:         { dir: '.trae',       global: '.trae',                           name: 'Trae' },
  qwen:         { dir: '.qwen',       global: '.qwen',                           name: 'Qwen Code' },
  codebuddy:    { dir: '.codebuddy',  global: '.codebuddy',                      name: 'CodeBuddy' },
  cline:        { dir: '.cline',      global: '.cline',                          name: 'Cline' },
};

// Parse selected runtimes (supports multiple: --claude --cursor --gemini)
const hasAll = args.includes('--all');
let selectedRuntimes = [];

if (hasAll) {
  selectedRuntimes = Object.keys(RUNTIMES);
} else {
  for (const key of Object.keys(RUNTIMES)) {
    if (args.includes(`--${key}`)) {
      selectedRuntimes.push(key);
    }
  }
}

// Backward compat: single runtime variable for simple cases
let selectedRuntime = selectedRuntimes.length === 1 ? selectedRuntimes[0] : null;

async function main() {
  console.log(`\n${bold}${cyan}ShipFast${reset} v${pkg.version}`);
  console.log(`${dim}5 agents. 12 commands. SQLite brain. 3-5x less tokens than alternatives.${reset}\n`);

  // Uninstall: auto-detect what's installed, no prompts needed
  if (hasUninstall) {
    let uninstalled = 0;

    // If specific runtimes given, uninstall those
    if (selectedRuntimes.length > 0) {
      for (const rtKey of selectedRuntimes) {
        const runtime = RUNTIMES[rtKey];
        if (!runtime) continue;
        for (const dir of [
          path.join(process.cwd(), runtime.dir),
          path.join(os.homedir(), runtime.global)
        ]) {
          const sfDir = path.join(dir, 'shipfast');
          if (fs.existsSync(sfDir)) {
            uninstall(dir, runtime.name);
            uninstalled++;
          }
        }
      }
    } else {
      // No runtime specified: scan all possible locations and remove whatever exists
      for (const [rtKey, runtime] of Object.entries(RUNTIMES)) {
        for (const dir of [
          path.join(process.cwd(), runtime.dir),
          path.join(os.homedir(), runtime.global)
        ]) {
          const sfDir = path.join(dir, 'shipfast');
          if (fs.existsSync(sfDir)) {
            uninstall(dir, runtime.name);
            uninstalled++;
          }
        }
      }
    }

    if (uninstalled === 0) {
      console.log(`${dim}No ShipFast installations found.${reset}`);
    }
    return;
  }

  // Install: prompt if no runtimes selected
  if (selectedRuntimes.length === 0) {
    selectedRuntimes = await promptRuntimeMultiSelect();
  }

  const isGlobal = hasGlobal || (!hasLocal && await promptScope());

  for (const rtKey of selectedRuntimes) {
    const runtime = RUNTIMES[rtKey];
    if (!runtime) {
      console.error(`${red}Unknown runtime: ${rtKey}${reset}`);
      continue;
    }

    const targetDir = isGlobal
      ? path.join(os.homedir(), runtime.global)
      : path.join(process.cwd(), runtime.dir);

    console.log(`${cyan}Installing for ${runtime.name}...${reset}`);
    console.log(`${dim}  → ${targetDir}${reset}`);
    install(targetDir, runtime.name, isGlobal);
  }

  console.log(`${green}${bold}Installed for ${selectedRuntimes.length} runtime${selectedRuntimes.length > 1 ? 's' : ''}!${reset}\n`);
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
  for (const file of ['sf-context-monitor.js', 'sf-statusline.js', 'sf-first-run.js']) {
    copyFile(path.join(__dirname, '..', 'hooks', file), path.join(hooksDir, file));
  }

  // Runtime-specific config
  // Claude Code, OpenCode, Kilo use settings.json + hooks + CLAUDE.md
  // Gemini uses .gemini/ with AGENTS.md
  // Copilot uses .github/copilot-instructions.md
  // Cursor uses .cursor/rules and .cursorrules
  // Others: just copy files, instructions go in their native format

  const claudeCompatible = ['Claude Code', 'OpenCode', 'Kilo'];
  const geminiCompatible = ['Gemini CLI', 'Antigravity'];

  if (claudeCompatible.includes(runtimeName)) {
    updateSettings(targetDir, runtimeName, hooksDir);
    updateInstructionFile(targetDir, isGlobal, 'CLAUDE.md');
  } else if (geminiCompatible.includes(runtimeName)) {
    updateInstructionFile(targetDir, isGlobal, 'AGENTS.md');
  } else if (runtimeName === 'Copilot') {
    updateInstructionFile(targetDir, isGlobal, 'copilot-instructions.md');
  } else if (runtimeName === 'Cursor') {
    updateInstructionFile(targetDir, isGlobal, 'rules');
  } else {
    // For other runtimes, write a generic instruction file
    updateInstructionFile(targetDir, isGlobal, 'AGENTS.md');
  }

  console.log(`Commands available:`);
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

  // Auto-train: detect if this is a git repo and offer to index
  if (!isGlobal) {
    trainRepo(process.cwd(), sfDir);
  } else {
    // For global install, check if cwd is a git repo
    const cwd = process.cwd();
    if (isGitRepo(cwd)) {
      trainRepo(cwd, path.join(cwd, getDirName(selectedRuntime), 'shipfast'));
    } else {
      console.log(`${dim}Not a git repo — brain will auto-index on first /sf-do in any repo.${reset}\n`);
    }
  }
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function trainRepo(cwd, sfDir) {
  if (!isGitRepo(cwd)) {
    console.log(`${dim}Not a git repo — brain will auto-index on first /sf-do in any repo.${reset}\n`);
    return;
  }

  const brainDbPath = path.join(cwd, '.shipfast', 'brain.db');
  if (fs.existsSync(brainDbPath)) {
    console.log(`${dim}Brain already trained for this repo.${reset}\n`);
    return;
  }

  // Count indexable files to show scope
  const indexerPath = path.join(sfDir, 'brain', 'indexer.cjs');
  if (!fs.existsSync(indexerPath)) {
    return;
  }

  console.log(`${yellow}Git repo detected.${reset}`);
  console.log(`Training ShipFast brain on this codebase will:`);
  console.log(`  - Index all source files (JS/TS/Rust/Python/Go)`);
  console.log(`  - Build a knowledge graph (functions, types, imports)`);
  console.log(`  - Analyze git history for change patterns`);
  console.log(`  - Store everything in .shipfast/brain.db\n`);

  // Auto-train without asking — it's fast and non-destructive
  console.log(`${cyan}Training...${reset}`);
  try {
    const { execFileSync: run } = require('child_process');
    const output = run(process.execPath, [indexerPath, cwd], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`${green}${output.trim()}${reset}\n`);

    // Add .shipfast/ to .gitignore if not already there
    addToGitignore(cwd);

    console.log(`${dim}Brain is ready. Start with: /sf-do <describe your task>${reset}\n`);
  } catch (err) {
    console.log(`${yellow}Training skipped: ${err.message.slice(0, 100)}${reset}`);
    console.log(`${dim}Brain will auto-index on first /sf-do.${reset}\n`);
  }
}

function addToGitignore(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.shipfast/';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (content.includes(entry)) return; // already there
    fs.appendFileSync(gitignorePath, '\n# ShipFast brain (local, not committed)\n' + entry + '\n');
  } else {
    fs.writeFileSync(gitignorePath, '# ShipFast brain (local, not committed)\n' + entry + '\n');
  }
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

  // Helper: check if a ShipFast hook already exists in an event array
  function hasSfHook(eventHooks, filename) {
    return (eventHooks || []).some(entry => {
      // Check nested hooks array format
      if (entry.hooks && Array.isArray(entry.hooks)) {
        return entry.hooks.some(h => (h.command || '').includes(filename));
      }
      // Check flat format (legacy)
      return (entry.command || '').includes(filename);
    });
  }

  // Helper: create a properly formatted hook entry
  function makeHookEntry(command) {
    return {
      matcher: '',
      hooks: [{ type: 'command', command }]
    };
  }

  // Add context monitor if not present
  const contextMonitorPath = path.join(hooksDir, 'sf-context-monitor.js');
  if (!hasSfHook(settings.hooks['PostToolUse'], 'sf-context-monitor')) {
    settings.hooks['PostToolUse'].push(makeHookEntry('node ' + contextMonitorPath));
  }

  // Add statusline if not present
  const statuslinePath = path.join(hooksDir, 'sf-statusline.js');
  if (!hasSfHook(settings.hooks['Notification'], 'sf-statusline')) {
    settings.hooks['Notification'].push(makeHookEntry('node ' + statuslinePath));
  }

  // Add first-run hook (auto-train on first /sf-* command in untrained repo)
  settings.hooks['PreToolUse'] = settings.hooks['PreToolUse'] || [];
  const firstRunPath = path.join(hooksDir, 'sf-first-run.js');
  if (!hasSfHook(settings.hooks['PreToolUse'], 'sf-first-run')) {
    settings.hooks['PreToolUse'].push(makeHookEntry('node ' + firstRunPath));
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function updateInstructionFile(targetDir, isGlobal, filename) {
  const filePath = isGlobal
    ? path.join(targetDir, filename)
    : path.join(process.cwd(), filename);

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
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    // Remove existing block
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
// Interactive prompts
// ============================================================

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

      // "all" or "a"
      if (trimmed === 'all' || trimmed === 'a') {
        resolve(Object.keys(RUNTIMES));
        return;
      }

      // Parse comma-separated numbers: "1,3,5" or "1 3 5" or "1, 3, 5"
      const nums = trimmed.split(/[\s,]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
      const selected = nums
        .map(n => n - 1)
        .filter(i => i >= 0 && i < entries.length)
        .map(i => entries[i][0]);

      if (selected.length > 0) {
        resolve(selected);
      } else {
        resolve(['claude']); // default
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
