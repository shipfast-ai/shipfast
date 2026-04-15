#!/usr/bin/env node

const cyan = '\x1b[36m';
const green = '\x1b[32m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

console.log(`
${green}${bold}ShipFast installed!${reset}

${bold}Next steps:${reset}

  ${cyan}shipfast install --claude${reset}       Setup for Claude Code
  ${cyan}shipfast install --cursor${reset}       Setup for Cursor
  ${cyan}shipfast install --all${reset}          Setup for all 14 runtimes

  ${cyan}cd your-project${reset}
  ${cyan}shipfast init${reset}                   Index your codebase

${bold}Other commands:${reset}

  ${cyan}shipfast train${reset}                  Re-index after changes
  ${cyan}shipfast update${reset}                 Update to latest version
  ${cyan}shipfast uninstall${reset}              Remove ShipFast
  ${cyan}shipfast help${reset}                   Show all commands

${dim}Docs: https://github.com/shipfast-ai/shipfast${reset}
`);
