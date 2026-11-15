'use strict';

const { execFileSync } = require('node:child_process');

function parseProcessLine(line) {
 const match = line.trim().match(/^(\d+)\s+(.+)$/);
 return match ? { pid: Number(match[1]), command: match[2] } : null;
}

function browserExecutable(command) {
 // macOS `ps` may print executable paths containing spaces without quotes.
 // Browser executables are followed by switches, so preserve the whole path.
 const executable = command.trim().split(/\s+--(?=[\w-]+(?:=|\s|$))/, 1)[0]
  .replace(/^['"]|['"]$/g, '');
 const name = executable.split(/[\\/]/).pop() || '';
 return /^(?:Google Chrome(?: for Testing)?|Google Chrome Helper(?: \([^)]+\))?|Chromium|Chromium Helper(?: \([^)]+\))?|google-chrome(?:-(?:stable|beta|unstable))?|chrome|chromium(?:-browser)?)(?:\.exe)?$/i.test(name);
}

function listBrowserProcesses(psOutput = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })) {
 return psOutput.split('\n').map(parseProcessLine).filter(process => process && browserExecutable(process.command));
}

function userDataDir(command) {
 const boundary = /(?=\s+--[\w-]+(?:=|\s|$)|$)/;
 const match = command.match(new RegExp(`(?:^|\\s)--user-data-dir=(?:"([^"]*)"|'([^']*)'|([\\s\\S]*?))${boundary.source}`));
 if (match) return (match[1] ?? match[2] ?? match[3] ?? '').trim();

 const separate = command.match(new RegExp(`(?:^|\\s)--user-data-dir\\s+(?:"([^"]*)"|'([^']*)'|([\\s\\S]*?))${boundary.source}`));
 return separate ? (separate[1] ?? separate[2] ?? separate[3] ?? '').trim() : '';
}

function findCompetingBrowser(processes, expectedProfile) {
 // An actual browser with no readable profile is still unsafe to run beside.
 return processes.find(process => userDataDir(process.command) !== expectedProfile);
}

module.exports = { browserExecutable, findCompetingBrowser, listBrowserProcesses, parseProcessLine, userDataDir };
