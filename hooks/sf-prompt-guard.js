#!/usr/bin/env node
/**
 * ShipFast Prompt Injection Guard — PreToolUse hook
 *
 * Scans Write/Edit operations targeting brain.db-related files
 * for embedded prompt injection patterns.
 *
 * Advisory only — warns but doesn't block.
 */

const fs = require('fs');
const path = require('path');

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(all\s+)?prior/i,
  /forget\s+(everything|all)\s+(you|your)/i,
  /new\s+instruction[s]?\s*:/i,
  /system\s*:\s*you\s+are/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /OVERRIDE\s*:/i,
];

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';

    // Only check Write and Edit operations
    if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

    // Check content for injection patterns
    const content = data.tool_input?.content || data.tool_input?.new_string || '';
    if (!content) process.exit(0);

    const found = INJECTION_PATTERNS.filter(p => p.test(content));
    if (found.length === 0) process.exit(0);

    // Advisory warning — don't block
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'PROMPT INJECTION WARNING: Content being written contains ' + found.length +
          ' potential injection pattern(s). This may be an attempt to override agent instructions. ' +
          'Review the content carefully before proceeding.'
      }
    }));
  } catch {
    process.exit(0);
  }
});
