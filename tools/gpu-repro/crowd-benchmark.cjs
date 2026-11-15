'use strict';

// Serialized into an offline page; this module does not launch a browser.
function installInPage() {
 let active = false, tick = 0, previous = null, current = null;
 let counters, intervals, durations, frames, events, matched;
 function resetSample() {
  counters = { claimBonesCalls: 0, looseSkeletonInits: 0, looseBones: 0, ownedSkeletonInits: 0, cpuParentsSanitized: 0 };
  intervals = []; durations = []; frames = []; events = []; matched = 0;
 }
 resetSample();
 const api = {
  claimBones(ownsBones, boneCount) {
   if (!active) return;
   if (!Number.isSafeInteger(boneCount) || boneCount < 0) throw new Error('Invalid benchmark bone count');
   counters.claimBonesCalls++;
   if (ownsBones) counters.ownedSkeletonInits++; else { counters.looseSkeletonInits++; counters.looseBones += boneCount; }
   events.push({ pageTimeMs: performance.now(), assignedGameTick: current ? tick : tick + 1, insideGameTickCallback: !!current, ownsBones, boneCount });
   if (current) { current.claimBonesCalls++; if (ownsBones) current.ownedSkeletonInits++; else { current.looseSkeletonInits++; current.looseBones += boneCount; } }
  },
  sanitizeParents(parents) {
   let changed = 0;
   for (let i = 0; i < parents.length; i++) if (parents[i] !== -1) changed++;
   parents.fill(-1);
   if (active) counters.cpuParentsSanitized += changed;
  },
  start() { active = true; tick = 0; previous = null; current = null; resetSample(); },
  take() {
   const result = { version: 1, frameCount: tick, counters, gameTickIntervalsMs: intervals, gameTickCallbackMs: durations,
    perFrame: frames, claimEvents: events, callbackDiagnostics: { matched } };
   resetSample(); return result;
  }
 };
 Object.defineProperty(globalThis, '__l2SiegeBench', { value: api });
 const request = globalThis.requestAnimationFrame.bind(globalThis);
 globalThis.requestAnimationFrame = callback => request(timestamp => {
  const manager = globalThis.renderManager?.manGame;
  if (!active || !manager || callback !== manager.animationFrameCallback) return callback(timestamp);
  const id = ++tick, interval = previous === null ? null : timestamp - previous;
  previous = timestamp;
  const record = { id, timestampMs: timestamp, intervalMs: interval, callbackMs: null,
   claimBonesCalls: 0, ownedSkeletonInits: 0, looseSkeletonInits: 0, looseBones: 0 };
  frames.push(record); matched++; if (interval !== null) intervals.push(interval);
  current = record;
  const begin = performance.now();
  try { return callback(timestamp); }
  finally { record.callbackMs = performance.now() - begin; durations.push(record.callbackMs); current = null; }
 });
}
module.exports = { installInPage };
