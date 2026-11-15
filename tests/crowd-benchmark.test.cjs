'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { instrumentSource, hash, sourceName } = require('../tools/gpu-repro/prepare-crowd-benchmark.cjs');
const { readBuild } = require('../tools/gpu-repro/benchmark-build.cjs');
const { installInPage } = require('../tools/gpu-repro/crowd-benchmark.cjs');
const { summarize } = require('../tools/gpu-repro/summarize-crowd.cjs');
const { readConfig, shouldStart } = require('../tools/gpu-repro/synthetic-phase.cjs');
const tail = "return; // a loose chain attached onto some other skeleton's bone, see attachLooseBoneChains";
const owned = 'for (let i = 0, len = bones.length; i < len; i++) indices.set(bones[i], i);';
test('preparation preserves the production difference and inserts safety before CPU traversal', () => {
 const base = `if (!this.ownsBones) ${tail}\n${owned}`;
 const candidate = `if (!this.ownsBones) {\n            this.parents.fill(-1);\n            ${tail}\n        }\n${owned}`;
 const b = instrumentSource(base, 'baseline', 'test'), c = instrumentSource(candidate, 'candidate', 'test');
 assert.equal((b.match(/this\.parents\.fill/g) || []).length, 0);
 assert.equal((c.match(/this\.parents\.fill/g) || []).length, 1);
 for (const s of [b,c]) {
  assert.equal(s.split('sanitizeParents(this.parents)').length, 2);
  assert.ok(s.indexOf('sanitizeParents') < s.indexOf(tail));
  assert.ok(s.includes('claimBones(true, bones.length)'));
 }
 assert.throws(() => instrumentSource(b,'baseline','test'), /already instrumented/);
 assert.throws(() => instrumentSource('changed upstream source','baseline','test'), /exactly one/);
});
test('build manifest rejects edited or unprepared source', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'crowd-build-'));
 try {
  fs.mkdirSync(path.dirname(path.join(dir,sourceName)),{recursive:true});
  fs.mkdirSync(path.join(dir,'.gpu-repro-benchmark'));
  fs.writeFileSync(path.join(dir,sourceName),'prepared');
  fs.writeFileSync(path.join(dir,'package-lock.json'),'{}');
  const manifest = {version:1,variant:'baseline',source:sourceName,token:'a'.repeat(64),instrumentedSha256:hash('prepared'),lockSha256:hash('{}')};
  fs.writeFileSync(path.join(dir,'.gpu-repro-benchmark/build.json'),JSON.stringify(manifest));
  assert.equal(readBuild(dir).variant,'baseline');
  fs.writeFileSync(path.join(dir,'package-lock.json'),'changed');
  assert.throws(()=>readBuild(dir),/Dependency lock/);
  fs.writeFileSync(path.join(dir,'package-lock.json'),'{}');
  fs.writeFileSync(path.join(dir,sourceName),'edited');
  assert.throws(()=>readBuild(dir),/changed/);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('timing isolates GameManager and retains asynchronous initialization attribution', () => {
 let scheduled, now=1;
 const manager={animationFrameCallback(){now+=2;}};
 const context=vm.createContext({performance:{now:()=>now},requestAnimationFrame:cb=>{scheduled=cb;return 1;},renderManager:{manGame:manager}});
 vm.runInContext(`(${installInPage.toString()})()`,context);
 const api=context.__l2SiegeBench; api.start();
 context.requestAnimationFrame(()=>{}); scheduled(1);
 api.claimBones(false,5);
 context.requestAnimationFrame(manager.animationFrameCallback); scheduled(10);
 api.claimBones(true,20);
 context.requestAnimationFrame(manager.animationFrameCallback); scheduled(26.7);
 const sample=api.take();
 assert.equal(sample.callbackDiagnostics.matched,2);
 assert.equal(sample.counters.looseSkeletonInits,1);
 assert.equal(sample.claimEvents[0].assignedGameTick,1);
 assert.equal(sample.claimEvents[0].insideGameTickCallback,false);
 assert.equal(sample.claimEvents[1].assignedGameTick,2);
 assert.equal(sample.gameTickCallbackMs.length,2);
 assert.ok(Math.abs(sample.gameTickIntervalsMs[0]-16.7)<1e-8);
 const parents=new Int32Array([0,0]);api.sanitizeParents(parents);assert.deepEqual([...parents],[-1,-1]);
 assert.equal(api.take().counters.cpuParentsSanitized,2);
 assert.equal(api.take().counters.claimBonesCalls,0);
});
test('summary rejects unsafe/incomplete runs and reports asynchronous loose bursts', () => {
 const sample={step:'sample',stage:'playback',actors:{total:20},contextLost:false,boneAudit:{valid:3,skipped:0,errors:0},bench:{perFrame:[{id:1,callbackMs:2,intervalMs:16.7}],claimEvents:[{assignedGameTick:1,ownsBones:false,boneCount:5}]}};
 const complete={step:'playback-complete',actualTeleportHandlerCalls:3,finalState:{replay:{duration:92},boneAudit:{valid:3,skipped:0,errors:0}}};
 const result=summarize([sample,complete]);assert.equal(result.totals.loose,1);assert.equal(result.maxLooseInTickWindow,1);assert.equal(result.callbackMs.p95,2);
 assert.throws(()=>summarize([sample]),/Incomplete/);
 assert.throws(()=>summarize([{...sample,boneAudit:{skipped:1}},complete]),/unsafe/);
 assert.throws(()=>summarize([{...sample,boneAudit:{valid:0,skipped:0,errors:0}},{...complete,finalState:{...complete.finalState,boneAudit:{valid:0,skipped:0,errors:0}}}]),/successful bone audit/);
});
test('synthetic configuration is bounded and trigger respects replay location', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crowd-config-')),file=path.join(dir,'config.json');
 const c={manifest:path.join(dir,'manifest.json'),count:30,seed:1234,batchSize:4,holdMs:5000,center:{x:0,y:0,z:0},trigger:{replayTime:70,teleports:3,level:[16,25]}};
 try {
  fs.writeFileSync(file,JSON.stringify(c));assert.equal(readConfig(file).count,30);
  assert.equal(shouldStart({replay:{time:71},teleportHandlerCount:3,level:[16,25]},c),true);
  assert.equal(shouldStart({replay:{time:71},teleportHandlerCount:2,level:[16,25]},c),false);
  fs.writeFileSync(file,JSON.stringify({...c,count:301}));assert.throws(()=>readConfig(file),/Invalid/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('atlas validation failures skip the unsafe GPU submission', async () => {
 const audit=require('../tools/gpu-repro/bone-atlas-parent-audit.cjs');let submitted=0;
 const renderer={renderBufferDirect(){submitted++;},getRenderTarget(){return null;}};
 const oldWindow=global.window,oldRender=global.renderManager,oldInfo=console.info;
 global.window=global;global.renderManager={renderer};console.info=()=>{};
 try {
  await audit.installBoneAtlasAudit({evaluate:(fn,arg)=>fn(arg)});
  const texture={isDataTexture:true,image:{width:1,height:1}};
  const material={isRawShaderMaterial:true,fragmentShader:'boneColumn while (true)',uniforms:{poseMap:{value:texture},bindMap:{value:texture},clipMap:{value:texture}}};
  renderer.renderBufferDirect(null,null,null,material,{},null);
  assert.equal(submitted,0);assert.equal(global.__l2BoneAtlasAudit.stats().errors,1);
  global.__l2BoneAtlasAudit.restore();
 } finally {global.window=oldWindow;global.renderManager=oldRender;console.info=oldInfo;}
});
test('synthetic phase clears successful actors and aborts failed work before replay resumes', async () => {
 const { runPhase } = require('../tools/gpu-repro/synthetic-phase.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crowd-phase-'));
 try {
  let present=0, cleared=0, aborted=false, failSafety=false;
  const playback={time:70,packetIndex:100};
  const game=Object.assign(Object.create({tickReplayPlayback(){return 'normal';}}),{replayPlayback:playback,isPlayingReplay:()=>true});
  const originalTick=game.tickReplayPlayback;
  const manifest={version:1,seed:1,descriptors:[{objectId:1}]};
  const context=vm.createContext({AbortController,setInterval,clearInterval,setTimeout,clearTimeout,
   renderManager:{renderer:{getContext:()=>({isContextLost:()=>false})},manGame:{getComponent:()=>({actors:{inWorld:true},session:{game}})}},
   __l2SiegeBench:{take:()=>({counters:{}})},__l2BoneAtlasAudit:{stats:()=>({valid:1,skipped:0,errors:failSafety?1:0})},
   __siegeSynthetic:{
    prepare:async()=>manifest,startDrawProbe(){},stopDrawProbe:()=>({}),clear(){present=0;cleared++;},status:()=>({ready:present,present}),
    async spawn(_m,{signal}) { present=1;if(!failSafety)return {ready:1};return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true})); }
   }});
  const page={evaluate:(fn,arg)=>{context.__arg=arg;return vm.runInContext(`(${fn.toString()})(__arg)`,context);}};
  const config={manifest:path.join(dir,'manifest.json'),createManifest:true,count:1,seed:1,batchSize:1,holdMs:1,center:{x:0,y:0,z:0}};
  const result=await runPhase(page,config);
  assert.equal(result.status.present,1);assert.equal(present,0);assert.equal(cleared,1);
  assert.equal(game.tickReplayPlayback,originalTick);assert.equal(Object.hasOwn(game,'tickReplayPlayback'),false);
  failSafety=true;
  await assert.rejects(runPhase(page,config),/safety/);
  assert.equal(aborted,true);assert.equal(present,0);assert.equal(cleared,2);assert.equal(game.tickReplayPlayback,originalTick);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
