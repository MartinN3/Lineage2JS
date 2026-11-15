'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { browserExecutable, findCompetingBrowser, listBrowserProcesses, parseProcessLine, userDataDir } = require('../tools/gpu-repro/browser-processes.cjs');

test('process listing ignores Codex and other Electron apps even when profile paths contain spaces', () => {
 const ps = [
  '  100 /Applications/ChatGPT.app/Contents/MacOS/Codex --type=gpu-process --user-data-dir=/Users/martin/Library/Application Support/Codex --gpu-preferences=x',
  '  101 /Applications/Visual Studio Code.app/Contents/MacOS/Electron --type=renderer --user-data-dir=/Users/martin/Library/Application Support/Code --no-sandbox',
  '  102 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/martin/Library/Application Support/Google/Chrome --no-first-run'
 ].join('\n');

 assert.deepEqual(listBrowserProcesses(ps).map(process => process.pid), [102]);
});

test('recognizes Chrome helper and Chromium app executables with spaces in their paths', () => {
 assert.equal(browserExecutable('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper (GPU) --type=gpu-process'), true);
 assert.equal(browserExecutable('/Applications/Chromium.app/Contents/MacOS/Chromium --type=renderer'), true);
 assert.equal(browserExecutable('/Applications/Code Editor.app/Contents/MacOS/Electron --type=renderer'), false);
});

test('reads quoted and unquoted user-data-dir values with spaces', () => {
 assert.equal(userDataDir('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir="/Users/martin/Chrome Profile" --no-first-run'), '/Users/martin/Chrome Profile');
 assert.equal(userDataDir('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/martin/Library/Application Support/Google/Chrome --no-first-run'), '/Users/martin/Library/Application Support/Google/Chrome');
 assert.equal(userDataDir('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir /Users/martin/ChromeProfile'), '/Users/martin/ChromeProfile');
});

test('blocks competing and unknown browser profiles but allows the owned profile', () => {
 const process = command => ({ pid: 200, command });
 const owned = process('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir="/tmp/replay profile" --no-first-run');
 const other = process('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir="/Users/martin/Chrome Profile" --no-first-run');
 const unknown = process('/Applications/Chromium.app/Contents/MacOS/Chromium --no-first-run');

 assert.equal(findCompetingBrowser([owned], '/tmp/replay profile'), undefined);
 assert.equal(findCompetingBrowser([other], '/tmp/replay profile'), other);
 assert.equal(findCompetingBrowser([unknown], '/tmp/replay profile'), unknown);
});

test('parses process identifiers without losing command paths that contain spaces', () => {
 assert.deepEqual(parseProcessLine('  4321 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir="/tmp/Profile One"'), {
  pid: 4321,
  command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir="/tmp/Profile One"'
 });
 assert.equal(parseProcessLine('not a process line'), null);
});
