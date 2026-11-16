'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installInPage } = require('../tools/gpu-repro/synthetic-crowd.cjs');
(async () => {
  let replay = true, starts = 0, removes = 0, blockReadiness = false;
  const objects = new Map();
  const infos = {
    40:{templateClass:'weapon',weaponType:1}, 41:{templateClass:'weapon',weaponType:4},
    50:{templateClass:'armor',bodyPart:10}, 51:{templateClass:'armor',bodyPart:11},
    52:{templateClass:'armor',bodyPart:9}, 53:{templateClass:'armor',bodyPart:12}
  };
  const actors = {
    inWorld:true, objects,
    hasServerObject: id => objects.has(id),
    spawnSimulatedPlayer(info) { starts++; const actor={visible:true}, object={objectId:info.objectId,actor,isRemoved:false,actorReady:blockReadiness ? new Promise(()=>{}) : Promise.resolve(actor)}; objects.set(info.objectId,object); return object; },
    removeObject(id) { removes++; objects.get(id).isRemoved=true; objects.delete(id); }
  };
  const network = { actors, session:{game:{isPlayingReplay:()=>replay}}, getParent:()=>({getComponent:name=>{ assert.equal(name,'asset'); return {getGameStrings:async()=>({itemInfos:infos})}; }}) };
  const scene={}, renderer={renderBufferDirect(){return 'forwarded';}};
  const ctx = vm.createContext({ location:{hostname:'127.0.0.1'}, renderManager:{scene,renderer,manGame:{getComponent:name=>{assert.equal(name,'network'); return network;}}}, performance, setTimeout, clearTimeout });
  vm.runInContext(`(${installInPage.toString()})()`,ctx);
  const api=ctx.__siegeSynthetic;
  const first=await api.prepare({count:10,seed:23,radius:200}), second=await api.prepare({count:10,seed:23,radius:200});
  assert.equal(JSON.stringify(first),JSON.stringify(second),'fixed seed/pools produce identical descriptors');
  assert.equal(first.descriptors.length,10);
  assert.ok(first.descriptors.every(d=>d.paperdoll[7] && d.paperdoll[10]),'generated characters carry weapons and armor');
  const ready=await api.spawn(first,{center:{x:10,y:20,z:30},batchSize:4});
  assert.equal(ready.ready,10); assert.equal(starts,10); assert.equal(api.status().present,10);
  api.startDrawProbe();
  const actor=objects.get(first.descriptors[0].objectId).actor; actor.isActor=true; actor.findComponent=()=>({equipmentMeshes:[]});
  assert.equal(renderer.renderBufferDirect(null,scene,null,null,{parent:actor,isPawnMesh:true,name:'test-mesh'},null),'forwarded');
  const draw=api.stopDrawProbe(); assert.equal(draw.totalSubmissions,1); assert.equal(draw.pawnMeshSubmissions,1); assert.equal(draw.actorIds.length,1);
  await assert.rejects(api.spawn(first,{center:{x:10,y:20,z:30}}),/already active/);
  api.clear(); assert.equal(removes,10); assert.equal(objects.size,0);
  objects.set(first.descriptors[0].objectId,{});
  await assert.rejects(api.spawn(first,{center:{x:10,y:20,z:30}}),/occupied/);
  assert.equal(starts,10,'collision rejected before spawning');
  objects.clear(); blockReadiness=true;
  const controller = new AbortController();
  const pending = api.spawn(first,{center:{x:10,y:20,z:30},batchSize:4,signal:controller.signal});
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending,/aborted/);
  assert.equal(starts,14,'abort stops subsequent batches');
  assert.equal(objects.size,0,'abort cleans up all first-batch objects');
  replay=false;
  await assert.rejects(api.prepare({count:1}),/active offline replay/);
  console.log('Synthetic crowd descriptor determinism, readiness, collision, cleanup and offline guard passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
