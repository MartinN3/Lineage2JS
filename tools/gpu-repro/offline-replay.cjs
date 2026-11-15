'use strict';
// OFFLINE ONLY: play an existing built-in .l2r through NetworkSession.playReplay.
// No login credentials, game-server connection, account/world write, or synthetic packet is used.
// Run only in a coordinated exclusive GPU window:
// GPU_REPRO_EXCLUSIVE=1 DEBUG=pw:browser node tools/gpu-repro/offline-replay.cjs file.l2r
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.GPU_REPRO_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '../..');
const REPLAY_PATH = process.argv[2] ? path.resolve(process.argv[2]) : '';
const ASSETS = process.env.GPU_REPRO_ASSETS || '';
const PROFILE = path.resolve(process.env.GPU_REPRO_PROFILE || path.join(os.tmpdir(), 'lineage2js-gpu-repro-offline'));
const USER_PROFILE = process.env.GPU_REPRO_USER_PROFILE || '';
const GAME_URL = new URL(process.env.GPU_REPRO_URL || 'http://127.0.0.1:8080/?login&diskAssets');
const ASSET_DIR = process.env.GPU_REPRO_OUTPUT_DIR || path.join(os.tmpdir(), 'lineage2js-gpu-repro-artifacts');
const CHROME = process.env.GPU_REPRO_CHROME || '';
const DEV_PORT = GAME_URL.port || (GAME_URL.protocol === 'https:' ? '443' : '80');
const KEEP_OPEN = process.env.GPU_REPRO_KEEP_OPEN === '1';
const REPLAY_SPEED = Number(process.env.GPU_REPRO_SPEED || 1);
const BONE_AUDIT = process.env.GPU_REPRO_BONE_AUDIT === '1';
const boneAuditHost=require('./bone-atlas-parent-audit.cjs');
let boneAuditSink;
const CDP_PORT = Number(process.env.GPU_REPRO_CDP_PORT || 9225);
const HARD_LIMIT_MS = 180000;
let context, page, launchAttempted = false, pageFailed = false, pageCrashed = false, closing = false, timer, forceTimer;
const instanceToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceArg = `--l2-offline-replay-instance=${instanceToken}`;
const ownedBrowserPids = new Set();
let startedAt = Date.now(), lastFrame = null, lastTeleportCount = 0;

function emit(step, data = {}) { console.log(JSON.stringify({ utc: new Date().toISOString(), step, ...data })); }
function chromeProcesses() {
 return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .map(line => { const m = line.trim().match(/^(\d+)\s+(.+)$/); return m && { pid: Number(m[1]), command: m[2] }; })
  .filter(p => p && /Google Chrome(?:\.app| Helper)|\/Chromium(?:\.app| Helper)|(?:^|\/)(?:google-chrome|chrome|chromium)(?:\s|$)/i.test(p.command));
}
function userDataDir(command) { return command.match(/--user-data-dir=(?:"([^"]+)"|([^\s]+))/)?.slice(1).find(Boolean) || ''; }
function assertExclusive() {
 const processes = chromeProcesses();
 if (USER_PROFILE && processes.some(p => p.command.includes(USER_PROFILE))) throw new Error('Refusing offline replay: dedicated user debug Chrome is active.');
 const competing = processes.find(p => {
  const profile = userDataDir(p.command);
  return profile && profile !== PROFILE;
 });
 if (competing) throw new Error(`Refusing offline replay: another browser profile is active (${userDataDir(competing.command)}).`);
 if (processes.some(p => userDataDir(p.command) === PROFILE)) throw new Error('Refusing offline replay: replay profile is already in use.');
}
async function recordOwnedBrowser() {
 const deadline = Date.now() + 3000;
 while (Date.now() < deadline) {
  const p = chromeProcesses().find(item =>
   userDataDir(item.command) === PROFILE && item.command.includes(instanceArg) && !item.command.includes(' --type='));
  if (p) { ownedBrowserPids.add(p.pid); emit('owned-browser', { pid: p.pid, instanceToken }); return; }
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 emit('owned-browser-pid-unavailable', { note: 'No profile-wide fallback cleanup will be used.' });
}
function killOwnBrowser() {
 for (const p of chromeProcesses().filter(item => ownedBrowserPids.has(item.pid) &&
  userDataDir(item.command) === PROFILE && item.command.includes(instanceArg) && !item.command.includes(' --type='))) {
  try { process.kill(p.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') emit('kill-failed', { pid: p.pid, code: error.code }); }
 }
}
function hardDeadline() {
 timer = setTimeout(() => {
  emit('hard-timeout', { milliseconds: HARD_LIMIT_MS }); process.exitCode = 3; void finish();
  forceTimer = setTimeout(() => { killOwnBrowser(); process.exit(3); }, 2000);
 }, HARD_LIMIT_MS + (KEEP_OPEN ? 300000 : 0));
}
async function finish() {
 if (closing) return;
 closing = true; clearTimeout(timer);
 if (context) await Promise.race([context.close(), new Promise(resolve => setTimeout(resolve, 1200))]).catch(() => {});
 killOwnBrowser(); clearTimeout(forceTimer); emit(context ? 'browser-closed' : 'no-browser-launched');
 if(boneAuditSink){emit('bone-audit-artifacts',{saved:boneAuditSink.saved,errors:boneAuditSink.errors});boneAuditSink.close();}
}
function readReplay() {
 const stat = fs.statSync(REPLAY_PATH);
 if (!stat.isFile() || stat.size < 100 || stat.size > 128 * 1024 * 1024) throw new Error('Replay file must be a regular file between 100 bytes and 128 MiB.');
 return fs.readFileSync(REPLAY_PATH);
}
async function sample(stage) {
 const value = await page.evaluate(stage => {
  const r = renderManager, n = r.manGame.getComponent('network'), game = n.session.game;
  const gl = r.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info'), playback = game?.replayPlayback;
  const physics = r.manGame.getComponent('physics');
  let emitters = [], particles = 0;
  try { emitters = physics.getParticleEmitters(); particles = emitters.reduce((sum, emitter) => sum + (emitter.activeCount || 0), 0); } catch {}
  const actors = [...n.actors.objects.values()];
  const target = r.manGame.getComponent('input').getOrbitTarget?.();
  const environment = r.getEnvironment();
  return { stage, utc: new Date().toISOString(), pageTime: performance.now(), contextLost: gl.isContextLost(),
   contextEvents: window.__offlineReplayEvents || [], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
   buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], dpr: devicePixelRatio,
   frame: r.renderer.info.render.frame, renderCalls: r.renderer.info.render.calls, triangles: r.renderer.info.render.triangles,
   geometries: r.renderer.info.memory.geometries, textures: r.renderer.info.memory.textures, programs: r.renderer.info.programs.length,
   actors: { total: actors.length, users: actors.filter(x => x.kind === 'user').length, players: actors.filter(x => x.kind === 'player').length, npcs: actors.filter(x => x.kind === 'npc').length },
   actorDraws: window.__offlineReplayActorDraws || 0, teleportHandlerCount: window.__offlineReplayTeleportCount || 0,
   boneAudit:window.__l2BoneAtlasAudit?.stats()||null, atlasSizes:window.__offlineAtlasSizes||[],
   player: r.player.position.toArray(), sector: r.getSectorId(r.player.position), level: r.getLevel()?.index ? [r.getLevel().index.x, r.getLevel().index.y] : null,
   camera: r.camera.position.toArray(), cameraQuaternion: r.camera.quaternion.toArray(), orbitTarget: target?.toArray?.() || null,
   timeOfDay: environment.getTimeOfDay(), timeScale: environment.getTimeScale(),
   particleEmitters: emitters.length, activeParticles: particles,
   replay: playback ? { active: game.isPlayingReplay(), time: playback.time, duration: playback.duration, ended: playback.ended,
    speed: game.getReplayPlaySpeed(), packetIndex: playback.packetIndex, packetCount: playback.file.arrPackets.length, cameraIndex: playback.cameraIndex } : null,
   npcSpawnCount: n.actors.npcSpawnCount, npcSpawnWaiters: n.actors.npcSpawnWaiters.length };
 }, stage);
 emit('sample', value);
 if(value.boneAudit?.skipped||value.boneAudit?.errors) throw new Error('Bone atlas audit found invalid inputs or an audit error; diagnostic workload stopped.');
 if (value.contextLost || value.contextEvents.some(event => event.type === 'lost' || event.type === 'restored')) throw new Error('WebGL context loss/restoration observed.');
 if (!/ANGLE.*Metal/.test(value.renderer)) throw new Error(`Expected real ANGLE Metal renderer, got ${value.renderer}.`);
 if (pageFailed) throw new Error('Page error observed.');
 if (stage !== 'playback-final' && lastFrame !== null && value.frame <= lastFrame) throw new Error('Renderer frame counter did not advance.');
 lastFrame = value.frame;
 if (value.teleportHandlerCount > lastTeleportCount) {
  emit('teleport-handler-observed', { count: value.teleportHandlerCount, position: value.player, sector: value.sector });
  lastTeleportCount = value.teleportHandlerCount;
 }
 return value;
}

(async () => {
 if (!REPLAY_PATH) throw new Error('Pass a replay file path as the first argument.');
 if (!ASSETS) throw new Error('Set GPU_REPRO_ASSETS to the local game asset directory.');
 if (!['http:', 'https:'].includes(GAME_URL.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(GAME_URL.hostname) || GAME_URL.username || GAME_URL.password) throw new Error('GPU_REPRO_URL must be a loopback HTTP(S) URL.');
 if (process.env.GPU_REPRO_EXCLUSIVE !== '1') throw new Error('Refusing offline replay without explicit GPU_REPRO_EXCLUSIVE=1.');
 if (![1, 2, 4, 8].includes(REPLAY_SPEED)) throw new Error('GPU_REPRO_SPEED must be one of 1, 2, 4, or 8.');
 const bytes = readReplay(); assertExclusive();
 const base64 = bytes.toString('base64');
 emit('start', { replay: path.relative(ROOT, REPLAY_PATH), bytes: bytes.byteLength, viewport: [2560, 1267], dpr: 1,
  lockCamera: true, useChatData: false, headless: false, profile: PROFILE, cdpPort: KEEP_OPEN ? CDP_PORT : null,
  hardLimitMs: HARD_LIMIT_MS, keepOpen: KEEP_OPEN, replaySpeed: REPLAY_SPEED,
  nativeLog: 'For Chromium/ANGLE stderr, launch with DEBUG=pw:browser and redirect this process stderr.',
  note: 'Built-in ReplayFile is parsed by normal NetworkSession.playReplay; no server socket, login credentials, account/world writes, or synthetic game packets.' });
 hardDeadline(); launchAttempted = true;
 context = await chromium.launchPersistentContext(PROFILE, {
  headless: false, ...(CHROME ? { executablePath: CHROME } : {}),
  viewport: { width: 2560, height: 1267 }, deviceScaleFactor: 1,
  args: ['--use-angle=metal', '--enable-webgl', '--enable-logging=stderr', instanceArg,
   ...(KEEP_OPEN ? ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${CDP_PORT}`] : [])], timeout: 15000
 });
 await recordOwnedBrowser();
 const pages = context.pages(); page = pages[0] || await context.newPage();
 for (const extra of pages.slice(1)) await extra.close();
 page.setDefaultTimeout(15000);
 await context.addInitScript(devPort => {
  delete window.showDirectoryPicker; window.__offlineReplayEvents = [];
  for (const type of ['webglcontextlost', 'webglcontextrestored']) window.addEventListener(type, event => {
   const data = { type: type === 'webglcontextlost' ? 'lost' : 'restored', utc: new Date().toISOString(), pageTime: performance.now(), status: event.statusMessage || '' };
   window.__offlineReplayEvents.push(data); console.error('OFFLINE_REPLAY_CONTEXT', JSON.stringify(data));
  }, true);
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
   constructor(url, protocols) {
    const endpoint = new URL(url, location.href);
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== devPort || endpoint.pathname !== '/ws' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
     throw new Error('Offline replay forbids all WebSocket connections except local WDS /ws.');
    super(endpoint.href, protocols);
   }
  };
 }, DEV_PORT);
 page.on('console', message => { if (message.type() === 'error') emit('console-error', { text: message.text().slice(0, 1200) }); });
 page.on('pageerror', error => { pageFailed = true; process.exitCode = 2; emit('page-error', { stack: error.stack?.slice(0, 1500) }); });
 page.on('crash', () => { pageCrashed = true; emit('page-crash'); });
 await page.goto(GAME_URL.href, { timeout: 15000 });
 const chooserPromise = page.waitForEvent('filechooser');
 await page.locator('button.choose').click(); await (await chooserPromise).setFiles(ASSETS);
 await page.waitForFunction(() => {
  const r = globalThis.renderManager, n = r?.manGame?.getComponent('network'), asset = r?.manGame?.getComponent('asset');
  return !!(r?.isRendering && asset?.playerController && n?.ui?.getScreen?.() === 'login');
 }, null, { timeout: 60000 });
 const before = await page.evaluate(() => {
  const r = renderManager, n = r.manGame.getComponent('network'), gl = r.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { screen: n.ui.getScreen(), actorsInWorld: n.actors.inWorld, gamePresent: !!n.session.game,
   renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() };
 });
 if (before.screen !== 'login' || before.actorsInWorld || before.gamePresent || before.contextLost || !/ANGLE.*Metal/.test(before.renderer))
  throw new Error(`Replay requires an initialized offline login screen with healthy ANGLE Metal: ${JSON.stringify(before)}`);
 if(BONE_AUDIT){const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');const dir=path.join(ASSET_DIR,`bone-atlas-audit-${Date.now()}`);boneAuditSink=boneAuditHost.createAuditSink(cdp,dir);emit('bone-audit-installed',{directory:dir,...await boneAuditHost.installBoneAtlasAudit(page)});}
 const started = await page.evaluate(async ({ base64, speed }) => {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const r = renderManager, n = r.manGame.getComponent('network'), original = n.movement.onTeleport;
  window.__offlineReplayTeleportCount = 0; window.__offlineReplayActorDraws = 0;
  window.__offlineAtlasSizes=[];
  n.movement.onTeleport = function(packet) { window.__offlineReplayTeleportCount++; return original.call(this, packet); };
  const originalDraw = r.renderer.renderBufferDirect;
  r.renderer.renderBufferDirect = function(camera, scene, geometry, material, object, group) {
   const u=material.uniforms;
   if(u?.poseMap?.value&&u?.bindMap?.value){const pose=u.poseMap.value,bind=u.bindMap.value,clip=u.clipMap?.value,key=[pose.uuid,bind.uuid,clip?.uuid].join(':');if(window.__offlineAtlasSizes.at(-1)?.key!==key)window.__offlineAtlasSizes.push({key,pageTime:performance.now(),pose:[pose.image.width,pose.image.height],bind:[bind.image.width,bind.image.height],clip:clip?[clip.image.width,clip.image.height]:null});}
   let parent = object; while (parent && parent !== r.player) parent = parent.parent;
   if (parent === r.player) window.__offlineReplayActorDraws++;
   return originalDraw.call(this, camera, scene, geometry, material, object, group);
  };
  const play = async () => {
   await n.session.playReplay(bytes, true, false);
   const game = n.session.game;
   while (game.getReplayPlaySpeed() < speed) {
    if (!game.inputReplay(107, 3)) throw new Error(`Could not increase replay playback speed to ${speed}x.`);
   }
   if (game.getReplayPlaySpeed() !== speed) throw new Error(`Replay speed mismatch: requested ${speed}x, got ${game.getReplayPlaySpeed()}x.`);
  };
  window.__offlineReplay = { play, bytes, async repeat() {
   if (n.session.game?.isPlayingReplay()) await n.session.stopReplayPlayback();
   await play();
   return true;
  }, state() { const playback = n.session.game?.replayPlayback; return playback && { time: playback.time, duration: playback.duration, ended: playback.ended }; } };
  await play();
  const playback = n.session.game?.replayPlayback;
  return { started: new Date().toISOString(), replayDurationSec: playback?.duration, packetCount: playback?.file?.arrPackets?.length,
   replaySpeed: n.session.game?.getReplayPlaySpeed?.(),
   screen: n.ui.getScreen(), replayActive: n.session.game?.isPlayingReplay?.() || false };
 }, { base64, speed: REPLAY_SPEED });
 emit('playback-started', started);
 const playbackStart = Date.now();
 const durationLimit = Number.isFinite(started.replayDurationSec) ? Math.ceil(started.replayDurationSec * 1000 / REPLAY_SPEED) + 10000 : 120000;
 const remainingHardLimit = HARD_LIMIT_MS - (Date.now() - startedAt) - 5000;
 const playbackLimitMs = Math.max(1000, Math.min(durationLimit, remainingHardLimit));
 emit('playback-observation-limit', { playbackLimitMs, replayDurationSec: started.replayDurationSec, replaySpeed: REPLAY_SPEED, graceMs: 10000 });
 let ended = false;
 while (Date.now() - playbackStart < playbackLimitMs) {
  if (pageCrashed) throw new Error('Page crashed during replay.');
  const state = await sample('playback');
  if (!state.replay || state.replay.ended || state.replay.time > state.replay.duration + 0.01) { ended = true; break; }
  await page.waitForTimeout(1000);
 }
 const finalState = await sample('playback-final');
 if (pageCrashed) throw new Error('Page crashed during replay.');
 if (!ended && !finalState.replay?.ended) throw new Error('Replay did not reach its recorded end within the bounded observation window.');
 if (finalState.teleportHandlerCount < 1) throw new Error('Replay contained no observed NetworkMovement.onTeleport handler call.');
 emit('playback-complete', { elapsedMs: Date.now() - playbackStart, finalState, actualTeleportHandlerCalls: finalState.teleportHandlerCount,
  replayPlaybackEnded: !!finalState.replay?.ended, replaySpeed: REPLAY_SPEED,
  coverage: 'Actual replayed UserInfo and incoming packets through normal NetworkSession.playReplay; teleport handler observed.' });
 if (KEEP_OPEN) {
  emit('cdp-ready', { port: CDP_PORT, repeat: 'window.__offlineReplay.repeat() after the prior replay has ended', maxHoldMs: 300000 });
  const holdUntil = Date.now() + 300000;
  while (!pageCrashed && Date.now() < holdUntil) {
   await page.waitForTimeout(1000);
   const state = await sample('keep-open');
   if (state.replay?.ended) continue;
  }
 }
})().catch(error => { emit('failed', { message: error.message, stack: error.stack?.slice(0, 1600) }); process.exitCode = process.exitCode || 1; })
 .finally(finish);
