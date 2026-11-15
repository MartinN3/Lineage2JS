'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function readConfig(file) {
 if (!file) return null;
 const c = JSON.parse(fs.readFileSync(file, 'utf8'));
 const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
 if (!path.isAbsolute(c.manifest || '') || !integer(c.count, 1, 300) || !integer(c.seed, -2147483648, 2147483647)
  || !integer(c.batchSize, 1, 8) || !integer(c.holdMs, 1000, 30000)
  || !c.center || ![c.center.x,c.center.y,c.center.z].every(Number.isFinite)
  || !Number.isFinite(c.trigger?.replayTime) || c.trigger.replayTime < 0 || !integer(c.trigger.teleports, 1, 100)
  || !Array.isArray(c.trigger.level) || c.trigger.level.length !== 2 || !c.trigger.level.every(Number.isSafeInteger)) throw new Error('Invalid bounded synthetic crowd configuration');
 return c;
}
function shouldStart(state, config) {
 return !!config && state.replay?.time >= config.trigger.replayTime && state.teleportHandlerCount >= config.trigger.teleports
  && state.level?.[0] === config.trigger.level[0] && state.level?.[1] === config.trigger.level[1];
}
async function runPhase(page, config) {
 const current = await page.evaluate(async ({seed,count}) => globalThis.__siegeSynthetic.prepare({seed,count,radius:200}), config);
 let manifest;
 if (fs.existsSync(config.manifest)) {
  manifest = JSON.parse(fs.readFileSync(config.manifest, 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(manifest)) throw new Error('Saved crowd manifest differs from seed/item-pool configuration');
 } else {
  if (config.createManifest !== true) throw new Error('Saved crowd manifest missing; explicitly create it in a discarded pilot');
  fs.writeFileSync(config.manifest, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  manifest = current;
 }
 const result = await page.evaluate(async ({manifest, config}) => {
  const r = renderManager, network = r.manGame.getComponent('network'), game = network.session.game, playback = game?.replayPlayback;
  if (!game?.isPlayingReplay() || !network.actors.inWorld || !playback || playback.ended) throw new Error('Offline replay is not ready for synthetic phase');
  if (typeof game.tickReplayPlayback !== 'function' || Object.hasOwn(game, 'tickReplayPlayback')) throw new Error('Unexpected replay tick override');
  const startReplayTime = playback.time, startPacketIndex = playback.packetIndex;
  const controller = new AbortController(); let watchdog, drawStarted = false;
  const safety = new Promise((_, reject) => { watchdog = setInterval(() => {
   const audit = globalThis.__l2BoneAtlasAudit?.stats();
   if (!audit || audit.skipped || audit.errors || r.renderer.getContext().isContextLost() || !game.isPlayingReplay()) reject(new Error('Synthetic phase safety audit/context/replay failed'));
  }, 100); });
  game.tickReplayPlayback = function() { return true; };
  try {
   globalThis.__l2SiegeBench.take();
   globalThis.__siegeSynthetic.startDrawProbe(); drawStarted = true;
   const work = (async () => {
    const spawn = await globalThis.__siegeSynthetic.spawn(manifest, { center: config.center, batchSize: config.batchSize, timeoutMs:30000,totalTimeoutMs:120000,signal:controller.signal });
    await new Promise((resolve, reject) => {
     const cancel = () => { clearTimeout(timer); reject(new Error('Synthetic hold aborted')); };
     const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, config.holdMs);
     controller.signal.addEventListener('abort', cancel, {once:true});
     if (controller.signal.aborted) cancel();
    });
    return spawn;
   })();
   let spawn;
   try { spawn = await Promise.race([work, safety]); }
   catch (error) { controller.abort(); await work.catch(() => {}); throw error; }
   const status = globalThis.__siegeSynthetic.status(), draws = globalThis.__siegeSynthetic.stopDrawProbe(); drawStarted = false;
   const frames = globalThis.__l2SiegeBench.take(), audit = globalThis.__l2BoneAtlasAudit.stats();
   if (audit.skipped || audit.errors || r.renderer.getContext().isContextLost()) throw new Error('Synthetic final audit failed');
   if (playback.time !== startReplayTime || playback.packetIndex !== startPacketIndex) throw new Error('Replay advanced during synthetic phase');
   if (status.ready !== manifest.descriptors.length || status.present !== manifest.descriptors.length) throw new Error('Synthetic readiness barrier failed');
   return { spawn, status, draws, frames, audit, startReplayTime, startPacketIndex, packetStreamFrozen: true, simulationTicksContinue: true };
  } finally {
   clearInterval(watchdog); controller.abort();
   try {
    if (drawStarted) globalThis.__siegeSynthetic.stopDrawProbe();
    globalThis.__siegeSynthetic.clear();
    if (globalThis.__siegeSynthetic.status().present !== 0) throw new Error('Synthetic cleanup left actors in the replay');
   } finally { delete game.tickReplayPlayback; }
  }
 }, {manifest, config});
 return { manifestSha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifestCount: manifest.descriptors.length,
  seed: config.seed, batchSize: config.batchSize, holdMs: config.holdMs, ...result };
}
module.exports = { readConfig, shouldStart, runPhase };
