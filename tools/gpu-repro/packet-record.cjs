'use strict';
// Attach-only, pre-world-entry recorder for allowlisted gameplay packets.
// No login credentials are read/logged; no packet is changed or suppressed.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.GPU_REPRO_PLAYWRIGHT_MODULE || 'playwright');

const OUT_DIR = path.resolve(process.env.GPU_REPRO_RECORD_DIR || path.join(require('node:os').tmpdir(), 'lineage2js-gpu-repro-recording'));
const OUT_FILE = path.join(OUT_DIR, 'packets.jsonl');
const CDP_URL = process.env.GPU_REPRO_CDP_URL || 'http://127.0.0.1:9224';
const GAME_PORT = process.env.GPU_REPRO_GAME_PORT || '8080';
const MAX_BYTES = 16 * 1024 * 1024, MAX_MS = 120000, READY_MS = 120000;
const REPLAYABLE = new Set([1,3,4,5,6,7,11,12,13,18,22,28,29,40,41,43,44,45,46,47,71,72,73,75,76,77,89,90,91,92,93,96,97,98,99,113,114,115,118,127,134,137,140,152,153,159,181,182,186,196,197,199,200,212,221,225,241,247,264,266,274,275,276,277]);
let browser, page, bytesWritten = 0, packetCount = 0, firstUserInfoAt = null, stopped = false, crashed = false;
let startWall = null, lastProgress = 0;

function emit(step, data = {}) { console.log(JSON.stringify({ utc: new Date().toISOString(), step, ...data })); }
function append(record) {
 if (stopped) return false;
 const line = Buffer.from(JSON.stringify(record) + '\n');
 if (bytesWritten + line.length > MAX_BYTES) { stopped = true; emit('capture-limit', { maxBytes: MAX_BYTES }); return false; }
 fs.appendFileSync(OUT_FILE, line, { mode: 0o600 }); bytesWritten += line.length;
 if (record.type === 'packet') {
  packetCount++;
  if (record.opcode === 4 && firstUserInfoAt === null) {
   firstUserInfoAt = record.wallTime; startWall = record.wallTime;
   emit('initial-userinfo-captured', { packetCount, at: record.wallTime });
  }
 }
 return true;
}
async function attach() {
 const endpoint = new URL(CDP_URL);
 if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('GPU_REPRO_CDP_URL must be a loopback HTTP(S) endpoint.');
 browser = await chromium.connectOverCDP(CDP_URL, { timeout: 4000 });
 const pages = browser.contexts().flatMap(context => context.pages()).filter(candidate => {
  try { const url = new URL(candidate.url()); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === GAME_PORT; } catch { return false; }
 });
 if (pages.length !== 1) throw new Error(`Expected exactly one local client page, found ${pages.length}.`);
 page = pages[0]; page.setDefaultTimeout(5000);
 page.on('crash', () => { crashed = true; stopped = true; emit('page-crash'); });
 page.on('pageerror', error => emit('page-error', { message: error.message.slice(0, 600) }));
 await page.waitForFunction(() => {
  const r = globalThis.renderManager, n = r?.manGame?.getComponent('network');
  return !!(r?.isRendering && n?.ui?.getScreen?.() === 'lobby' && n.session.game?.isConnected?.() && !n.actors.inWorld);
 }, null, { timeout: READY_MS });
}

(async () => {
 fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
 fs.writeFileSync(OUT_FILE, '', { mode: 0o600, flag: 'wx' });
 await attach();
 await page.exposeBinding('__persistGameplayRecord', (_source, record) => append(record));
 const installed = await page.evaluate(() => {
  const n = renderManager.manGame.getComponent('network'), original = n.onPacket;
  if (window.__gameplayCaptureInstalled) throw new Error('Gameplay packet hook already installed.');
  window.__gameplayCaptureInstalled = true;
  window.__gameplayCaptureActive = true;
  window.__gameplayCapturePackets = 0;
  window.__gameplayCaptureSceneSaved = false;
  let firstInfoPageTime = null, chain = Promise.resolve();
  const enqueue = record => {
   chain = chain.then(() => window.__persistGameplayRecord(record)).then(active => {
    if (!active) window.__gameplayCaptureActive = false;
   }).catch(error => { window.__gameplayCaptureActive = false; console.error('GAMEPLAY_CAPTURE_WRITE_FAILED', error.message); });
  };
  const captureScene = () => {
   if (!window.__gameplayCaptureActive || window.__gameplayCaptureSceneSaved || !n.actors.inWorld || n.ui?.getScreen?.() !== 'world') return;
   const r = renderManager, input = r.manGame.getComponent('input'), asset = r.manGame.getComponent('asset'), properties = asset.playerController?.scriptProperties;
   if (!properties) return;
   const scene = { type: 'scene', wallTime: new Date().toISOString(), position: r.camera.position.toArray(),
    yaw: Math.trunc(Math.atan2(-r.camera.matrixWorld.elements[8], -r.camera.matrixWorld.elements[9]) * 32768 / Math.PI),
    pitch: 0, zoom: properties.get('CurZoomingDist'), desiredZoom: properties.get('DesiredZoomingDist'),
    hour: Math.floor(r.getEnvironment().getTimeOfDay()), minute: Math.floor((r.getEnvironment().getTimeOfDay() % 1) * 60),
    second: 0, cameraMode: 0, firstPerson: properties.get('CurFixedDefaultCameraNo') === 1 ? 1 : 0,
    observerMode: n.movement.observation ? 1 : 0, actorYaw: r.player.getRotationYaw(), fixedCamera: properties.get('CurFixedDefaultCameraNo'),
    player: r.player.position.toArray(), cameraQuaternion: r.camera.quaternion.toArray(),
    target: input.getOrbitTarget?.()?.toArray?.() || null, sector: r.getSectorId(r.player.position),
    buffer: [r.renderer.domElement.width, r.renderer.domElement.height], dpr: devicePixelRatio };
   window.__gameplayCaptureSceneSaved = true; enqueue(scene);
  };
  window.__gameplayCaptureSceneTimer = setInterval(captureScene, 75);
  n.onPacket = function(opcode, packet) {
   try {
    if (window.__gameplayCaptureActive) {
     const view = packet.view, offset = packet.getOffset();
     let extendedOpcode = -1, payloadOffset = offset;
     if (opcode === 254) { extendedOpcode = view.getInt16(view.byteOffset + offset, true); payloadOffset += 2; }
     const id = opcode === 254 ? 255 + extendedOpcode : opcode;
     // Explicitly omit chat (2/74), key/auth/handshake opcodes, and all non-replayable packets.
     if (id !== 2 && id !== 74 && REPLAYABLE.has(id)) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + payloadOffset, view.byteLength - payloadOffset);
      const pageTime = performance.now();
      if (opcode === 4 && firstInfoPageTime === null) firstInfoPageTime = pageTime;
      if (firstInfoPageTime !== null) {
       let binary = '';
       for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
       enqueue({ type: 'packet', t: (pageTime - firstInfoPageTime) / 1000, pageTime,
        wallTime: new Date().toISOString(), opcode, extendedOpcode, payloadB64: btoa(binary) });
       window.__gameplayCapturePackets++;
      }
     }
    }
   } catch (error) { window.__gameplayCaptureActive = false; console.error('GAMEPLAY_CAPTURE_HOOK_FAILED', error.message); }
   return original.call(this, opcode, packet);
  };
  return { installed: true, screen: n.ui.getScreen(), inWorld: n.actors.inWorld, connected: n.session.game.isConnected() };
 });
 append({ type: 'meta', startedAt: new Date().toISOString(), maxDurationMs: MAX_MS,
  packetAllowlist: 'L2ReplayRecorder.isReplayPacket; chat opcodes 2 and 74 excluded', firstPacketMustBeUserInfo: 4,
  target: 'offline replay conversion input; allowlisted gameplay packets only' });
 emit('hook-installed', { ...installed, output: OUT_FILE, maxDurationMs: MAX_MS, maxBytes: MAX_BYTES,
  note: 'Hook is armed on lobby before Start/world entry; packets are copied before the original handler and then forwarded unchanged.' });
 const started = Date.now();
 while (!stopped && Date.now() - started < MAX_MS) {
  if (crashed) break;
  try {
   const state = await page.evaluate(() => {
    const r = renderManager, n = r?.manGame?.getComponent('network'), gl = r?.renderer?.getContext?.();
    return { active: window.__gameplayCaptureActive, packets: window.__gameplayCapturePackets,
     sceneSaved: window.__gameplayCaptureSceneSaved, inWorld: !!n?.actors?.inWorld, screen: n?.ui?.getScreen?.(),
     contextLost: gl?.isContextLost?.() || false, contextEvents: window.__gpuEvents || [] };
   });
   if (state.contextLost || state.contextEvents.some(event => event.type === 'lost' || event.type === 'restored')) {
    stopped = true; emit('context-loss-stop', state); break;
   }
   if (!state.active) { stopped = true; emit('hook-stopped', state); break; }
   if (Date.now() - lastProgress >= 5000) {
    lastProgress = Date.now(); emit('progress', { packets: packetCount, bytesWritten, firstUserInfoAt,
     elapsedMs: Date.now() - started, sceneSaved: state.sceneSaved, inWorld: state.inWorld, screen: state.screen });
   }
  } catch (error) {
   stopped = true; emit('page-unavailable-stop', { message: error.message }); break;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 stopped = true;
 try { await page.evaluate(() => { clearInterval(window.__gameplayCaptureSceneTimer); window.__gameplayCaptureActive = false; }); } catch {}
 emit('recording-finished', { reason: crashed ? 'page-crash' : Date.now() - started >= MAX_MS ? 'duration-limit' : 'stopped',
  packets: packetCount, bytesWritten, firstUserInfoAt, hasUserInfo: fs.readFileSync(OUT_FILE, 'utf8').split('\n').some(line => line.includes('"opcode":4')),
  output: OUT_FILE, sceneMetadataIncluded: fs.readFileSync(OUT_FILE, 'utf8').includes('"type":"scene"') });
})().catch(error => { emit('failed', { message: error.message, stack: error.stack?.slice(0, 1400) }); process.exitCode = 1; })
 .finally(async () => { if (browser) await browser.close().catch(() => {}); });
