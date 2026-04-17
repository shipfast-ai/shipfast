#!/usr/bin/env node
/**
 * ShipFast Auto-Router — UserPromptSubmit hook (v1.9.1)
 *
 * When auto-route is enabled, intercepts every user prompt in Claude Code /
 * OpenCode and injects context telling the model to invoke /sf:do with the
 * user's message instead of editing directly.
 *
 * Toggle state lives at  ~/.shipfast/auto-route.enabled
 *   presence = enabled,  absence = disabled.
 *
 * Toggle from inside Claude Code with:
 *   /sf:enable   — create the flag file
 *   /sf:disable  — remove the flag file
 *
 * Passthrough (hook stays silent):
 *   - state file absent    → disabled
 *   - starts with `/`      → slash command
 *   - starts with `!`      → explicit raw escape
 *   - starts with `?`      → explicit question
 *   - ends with `?`        → question
 *   - <4 chars             → short ack (yes/no/ok)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_FILE = path.join(os.homedir(), '.shipfast', 'auto-route.enabled');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  // Disabled unless the flag file exists. Toggle with /sf:enable | /sf:disable.
  if (!fs.existsSync(STATE_FILE)) process.exit(0);

  try {
    const data = JSON.parse(input);
    const raw = (data.prompt || '').trim();
    if (!raw) process.exit(0);

    // Passthrough rules — hook is silent, Claude Code uses the original prompt.
    if (raw.startsWith('/')) process.exit(0);
    if (raw.startsWith('!')) process.exit(0);
    if (raw.startsWith('?')) process.exit(0);
    if (raw.endsWith('?'))   process.exit(0);
    if (raw.length < 4)      process.exit(0);

    // Inject context steering the model toward /sf:do. additionalContext is the
    // supported way to nudge the model from a UserPromptSubmit hook.
    const context =
      `[ShipFast auto-router] The user's request "${raw}" is a code task. ` +
      `Invoke the \`sf:do\` skill with this task instead of using Edit / Write / Bash directly. ` +
      `Disable this behavior with /sf:disable.`;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context
      }
    }));
  } catch {
    // Malformed JSON or any other failure → silent exit, don't block the user.
    process.exit(0);
  }
});
