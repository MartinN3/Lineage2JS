'use strict';
const fs = require('node:fs');
function quantile(values, fraction) {
 if (!values.length) return null;
 const sorted = [...values].sort((a,b) => a-b);
 return sorted[Math.ceil(fraction * sorted.length) - 1];
}
function distribution(values) {
 const finite = values.filter(Number.isFinite);
 return { count: finite.length, p50: quantile(finite,.5), p95: quantile(finite,.95), p99: quantile(finite,.99), max: finite.length ? Math.max(...finite) : null };
}
function summarize(records) {
 const start = records.find(r => r.step === 'start'), completed = records.find(r => r.step === 'playback-complete');
 if (!completed || records.some(r => ['failed','page-error','page-crash','hard-timeout'].includes(r.step))) throw new Error('Incomplete or failed replay; refusing performance summary');
 const samples = records.filter(r => r.step === 'sample' && ['playback','playback-final'].includes(r.stage));
 if (!samples.length || samples.some(r => !r.bench || r.contextLost || r.boneAudit?.skipped || r.boneAudit?.errors)) throw new Error('Missing metrics or unsafe replay');
 if (!samples.every(r => r.boneAudit && Number.isFinite(r.boneAudit.valid)) || !(completed.finalState.boneAudit?.valid > 0)) throw new Error('Benchmark requires at least one successful bone audit');
 const frames = samples.flatMap(r => r.bench.perFrame), events = samples.flatMap(r => r.bench.claimEvents);
 if (!frames.length) throw new Error('No game callback samples');
 const totals = events.reduce((a,e) => { a.claims++; if (!e.ownsBones) { a.loose++; a.looseBones += e.boneCount; } return a; }, {claims:0,loose:0,looseBones:0});
 const counts = new Map();
 for (const event of events.filter(e => !e.ownsBones)) counts.set(event.assignedGameTick, (counts.get(event.assignedGameTick) || 0) + 1);
 const synthetic = records.find(r => r.step === 'synthetic-crowd-phase');
 return { build: start?.benchmarkBuild, replaySha256: start?.replaySha256, replayDuration: completed.finalState.replay?.duration,
  teleports: completed.actualTeleportHandlerCalls, peakActors: Math.max(...samples.map(r => r.actors.total)), totals,
  looseTickWindows: counts.size, maxLooseInTickWindow: counts.size ? Math.max(...counts.values()) : 0,
  unmatchedClaimEvents: events.filter(e => !frames.some(f => f.id === e.assignedGameTick)).length,
  callbackMs: distribution(frames.map(f => f.callbackMs)), intervalMs: distribution(frames.map(f => f.intervalMs)),
  audit: completed.finalState.boneAudit && {valid:completed.finalState.boneAudit.valid,skipped:completed.finalState.boneAudit.skipped,errors:completed.finalState.boneAudit.errors},
  synthetic: synthetic && {manifestSha256:synthetic.manifestSha256,status:synthetic.status,draws:synthetic.draws,spawn:synthetic.spawn,
   counters:synthetic.frames.counters,callbackMs:distribution(synthetic.frames.gameTickCallbackMs),intervalMs:distribution(synthetic.frames.gameTickIntervalsMs)},
  limits: ['Instrumented safe replay; baseline is normalized before CPU/GPU traversal.', 'Candidate retains its production fill in addition to common benchmark normalization.',
   'Game callback timing and cadence are not completed GPU frame timing.', 'Actor readiness and render submissions do not prove individual GPU equipment draws.',
   'A recorded crowd or synthetic addition is not a captured castle siege.'] };
}
if (require.main === module) {
 const files = process.argv.slice(2);
 if (!files.length) throw new Error('Usage: node summarize-crowd.cjs <replay.jsonl> [more runs...]');
 console.log(JSON.stringify(files.map(file => ({file, ...summarize(fs.readFileSync(file,'utf8').trim().split('\n').map(line => JSON.parse(line)))})), null, 2));
}
module.exports = { quantile, distribution, summarize };
