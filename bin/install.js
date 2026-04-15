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
    case 'update':   return cmdUpdate();
    case 'uninstall': return cmdUninstall();
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

  for (const f of ['schema.sql', 'index.cjs', 'indexer.cjs'])
    copy('brain/' + f, path.join(brainDir, f));

  for (const f of ['autopilot.cjs','budget.cjs','checkpoint.cjs','learning.cjs','ambiguity.cjs','context-builder.cjs','conversation.cjs','executor.cjs','git-intel.cjs','guardrails.cjs','model-selector.cjs','retry.cjs','session.cjs','skip-logic.cjs','templates.cjs','verify.cjs'])
    copy('core/' + f, path.join(coreDir, f));

  // Copy agents
  const agentsDir = path.join(dir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const f of ['scout.md','architect.md','builder.md','critic.md','scribe.md'])
    copy('agents/' + f, path.join(agentsDir, f));

  // Copy commands
  const cmdDir = path.join(dir, 'commands', 'sf');
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const f of ['do.md','status.md','undo.md','config.md','brain.md','learn.md','discuss.md','project.md','resume.md','ship.md','help.md','milestone.md'])
    copy('commands/sf/' + f, path.join(cmdDir, f));

  // Copy hooks
  const hooksDir = path.join(dir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of ['sf-context-monitor.js','sf-statusline.js','sf-first-run.js'])
    copy('hooks/' + f, path.join(hooksDir, f));

  // Runtime-specific config
  const claudeCompat = ['Claude Code', 'OpenCode', 'Kilo'];
  const geminiCompat = ['Gemini CLI', 'Antigravity'];

  if (claudeCompat.includes(runtime.name)) {
    writeSettings(dir, hooksDir);
    writeInstruction(path.join(dir, 'CLAUDE.md'));
  } else if (geminiCompat.includes(runtime.name)) {
    writeInstruction(path.join(dir, 'AGENTS.md'));
  } else if (runtime.name === 'Copilot') {
    writeInstruction(path.join(dir, 'copilot-instructions.md'));
  } else if (runtime.name === 'Cursor') {
    writeInstruction(path.join(dir, 'rules'));
  } else {
    writeInstruction(path.join(dir, 'AGENTS.md'));
  }

  console.log(`  ${green}${runtime.name}${reset} ${dim}${dir}${reset}`);
}

function printDone(count) {
  console.log(`\n${green}${bold}Installed for ${count} runtime${count > 1 ? 's' : ''}!${reset}\n`);
  console.log(`${bold}Next:${reset}`);
  console.log(`  ${cyan}cd your-project${reset}`);
  console.log(`  ${cyan}shipfast init${reset}        Index your codebase\n`);
  console.log(`${bold}In your AI tool:${reset}`);
  console.log(`  ${cyan}/sf-do${reset} <task>     Describe what you want`);
  console.log(`  ${cyan}/sf-help${reset}          Show all 12 commands\n`);
}

// ============================================================
// INIT — index current repo
// ============================================================

function cmdInit() {
  const cwd = process.cwd();
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
  console.log(brainExists ? 'Re-indexing codebase...' : 'Indexing codebase...');

  try {
    const out = safeRun(process.execPath, [indexer, cwd], {
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

    console.log(`\n${dim}Brain: .shipfast/brain.db${reset}`);
    console.log(`${dim}Use /sf-do in your AI tool.${reset}\n`);
  } catch (err) {
    console.log(`${red}Failed: ${err.message.slice(0, 100)}${reset}\n`);
  }
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
      // Clean settings.json
      cleanSettings(dir);
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
  console.log(`  ${cyan}shipfast init${reset}           Index current repo into .shipfast/brain.db`);
  console.log(`  ${cyan}shipfast update${reset}         Update to latest + re-detect runtimes`);
  console.log(`  ${cyan}shipfast uninstall${reset}      Remove from all AI tools`);
  console.log(`  ${cyan}shipfast help${reset}           Show this help\n`);
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
  console.log(`  ${cyan}/sf-config${reset}            Set token budget and model tiers`);
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

  for (const [evt, file] of [['PostToolUse','sf-context-monitor.js'],['Notification','sf-statusline.js'],['PreToolUse','sf-first-run.js']]) {
    s.hooks[evt] = s.hooks[evt] || [];
    if (!has(s.hooks[evt], file)) s.hooks[evt].push(mk('node ' + path.join(hooksDir, file)));
  }
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
}

function writeInstruction(filePath) {
  const marker = '<!-- ShipFast -->';
  const close = '<!-- /ShipFast -->';
  const block = `${marker}\n## ShipFast\n- \`/sf-do <task>\` — Describe what you want.\n- \`/sf-help\` — Show all 12 commands.\n- Brain: \`.shipfast/brain.db\`\n${close}`;

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

function copy(rel, dest) {
  const src = path.join(__dirname, '..', rel);
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

main();
