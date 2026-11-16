'use strict';

// Fork benchmark helper. Install into a loopback offline-replay page via
// page.addInitScript(installInPage). No browser, server, or GPU is launched here.
function installInPage() {
  const raceClasses = [
    [0,1,2,3,4,5,6,7,8,9,88,89,90,91,92,93,10,11,12,13,14,15,16,17,94,95,96,97,98],
    [18,19,20,21,22,23,24,99,100,101,102,25,26,27,28,29,30,103,104,105],
    [31,32,33,34,35,36,37,106,107,108,109,38,39,40,41,42,43,110,111,112],
    [44,45,46,47,48,113,114,49,50,51,52,115,116],
    [53,54,55,56,57,117,118]
  ];
  const ours = new Map(), actorIds = new WeakMap();
  let busy = false, drawProbe = null;

  function offlineNetwork() {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) throw new Error('Synthetic crowd requires a loopback replay page.');
    const network = globalThis.renderManager?.manGame?.getComponent('network');
    if (!network?.session?.game?.isPlayingReplay?.()) throw new Error('Synthetic crowd requires active offline replay playback.');
    if (!network.actors?.inWorld) throw new Error('Replay character must be in the world.');
    return network;
  }
  function makeRandom(seed) {
    let state = seed | 0;
    return () => {
      state = state + 0x6D2B79F5 | 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(random, values) { return values[Math.floor(random() * values.length)]; }
  function itemPools(itemInfos) {
    const pools = { weapon: [], weapon2h: [], shield: [], chest: [], full: [], legs: [], gloves: [], feet: [], head: [] };
    const armorSlots = { 6: 'head', 9: 'gloves', 10: 'chest', 11: 'legs', 12: 'feet', 15: 'full' };
    for (const id of Object.keys(itemInfos).map(Number).filter(Number.isSafeInteger).sort((a,b) => a-b)) {
      const info = itemInfos[id];
      if (info.templateClass === 'armor' && armorSlots[info.bodyPart]) pools[armorSlots[info.bodyPart]].push(id);
      if (info.templateClass !== 'weapon') continue;
      if ([1,2,3,7].includes(info.weaponType)) pools.weapon.push(id);
      else if ([4,5,6,8].includes(info.weaponType)) pools.weapon2h.push(id);
      else if (info.weaponType === 0 && info.shieldPDef > 0) pools.shield.push(id);
    }
    return pools;
  }
  function paperdoll(random, pools) {
    const p = Array(16).fill(0);
    if (pools.weapon2h.length && random() < .35) p[7] = p[14] = pick(random, pools.weapon2h);
    else if (pools.weapon.length) { p[7] = pick(random, pools.weapon); if (pools.shield.length && random() < .4) p[8] = pick(random,pools.shield); }
    if (pools.full.length && random() < .3) p[10] = p[11] = pick(random,pools.full);
    else { if (pools.chest.length) p[10] = pick(random,pools.chest); if (pools.legs.length) p[11] = pick(random,pools.legs); }
    if (pools.gloves.length && random() < .85) p[9] = pick(random,pools.gloves);
    if (pools.feet.length && random() < .85) p[12] = pick(random,pools.feet);
    if (pools.head.length && random() < .3) p[6] = pick(random,pools.head);
    return p;
  }
  function validateDescriptors(descriptors) {
    if (!Array.isArray(descriptors) || descriptors.length < 1 || descriptors.length > 300) throw new Error('Expected 1–300 synthetic descriptors.');
    const ids = new Set();
    for (const d of descriptors) {
      if (!Number.isSafeInteger(d.objectId) || d.objectId < 2146800000 || d.objectId >= 2146800300 || ids.has(d.objectId)) throw new Error('Synthetic IDs must be unique within reserved range.');
      ids.add(d.objectId);
      if (!Array.isArray(d.paperdoll) || d.paperdoll.length !== 16 || !d.paperdoll.every(Number.isSafeInteger)) throw new Error('Invalid paperdoll.');
      if (![d.dx,d.dy].every(Number.isFinite)) throw new Error('Invalid relative position.');
    }
  }
  async function prepare({ count = 100, seed = 1, radius = 200 } = {}) {
    const network = offlineNetwork();
    if (!Number.isSafeInteger(count) || count < 1 || count > 300 || !Number.isSafeInteger(seed) || !Number.isFinite(radius) || radius < 0 || radius > 1000) throw new Error('Invalid synthetic crowd parameters.');
    const strings = await network.getParent().getComponent('asset').getGameStrings();
    offlineNetwork();
    const pools = itemPools(strings.itemInfos);
    if ((!pools.weapon.length && !pools.weapon2h.length) || (!pools.chest.length && !pools.full.length)) throw new Error('Required weapon/armor pools are empty; refusing unequipped workload.');
    const random = makeRandom(seed);
    const descriptors = [];
    for (let index = 0; index < count; index++) {
      const race = Math.floor(random()*5), classId = pick(random,raceClasses[race]), sex = random() < .5 ? 0 : 1;
      const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * radius;
      descriptors.push({ objectId: 2146800000 + index, name: `SyntheticSiege${index}`, race, classId, sex,
        dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance,
        hairStyle: Math.floor(random() * (sex ? 7 : 5)), hairColor: Math.floor(random()*4), face: Math.floor(random()*3),
        enchantLevel: random() < .2 ? 4 + Math.floor(random()*12) : 0,
        heading: Math.floor(random()*65536), isRunning: random() < .7, paperdoll: paperdoll(random,pools) });
    }
    validateDescriptors(descriptors);
    return { version: 1, seed, radius, poolCounts: Object.fromEntries(Object.entries(pools).map(([k,v]) => [k,v.length])), descriptors };
  }
  function clear() {
    const network = offlineNetwork();
    for (const [id, object] of ours) if (network.actors.objects.get(id) === object) network.actors.removeObject(id);
    ours.clear();
  }
  async function spawn(manifest, { center, batchSize = 4, timeoutMs = 30000, totalTimeoutMs = 120000, signal = null } = {}) {
    const network = offlineNetwork();
    if (signal?.aborted) throw new Error('Synthetic crowd loading aborted.');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new Error('Invalid abort signal.');
    if (busy || ours.size) throw new Error('Synthetic crowd already active; clear before respawning.');
    const descriptors = manifest?.descriptors;
    validateDescriptors(descriptors);
    if (!center || ![center.x,center.y,center.z].every(Number.isFinite)) throw new Error('Provide a finite fixed center from the target replay scene.');
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 8 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1000 || totalTimeoutMs > 300000) throw new Error('Invalid bounded load settings.');
    for (const d of descriptors) if (network.actors.hasServerObject(d.objectId)) throw new Error(`Reserved synthetic ID ${d.objectId} is occupied.`);
    busy = true;
    const startedAt = performance.now();
    try {
      for (let i = 0; i < descriptors.length; i += batchSize) {
        offlineNetwork();
        if (signal?.aborted) throw new Error('Synthetic crowd loading aborted.');
        const remainingMs = totalTimeoutMs - (performance.now() - startedAt);
        if (remainingMs <= 0) throw new Error('Synthetic crowd total loading timeout.');
        const group = descriptors.slice(i,i+batchSize).map(d => {
          const info = {
            objectId:d.objectId, name:d.name, title:'', race:d.race, classId:d.classId, sex:d.sex,
            hairStyle:d.hairStyle, hairColor:d.hairColor, face:d.face, enchantLevel:d.enchantLevel,
            x:center.x+d.dx, y:center.y+d.dy, z:center.z, heading:d.heading, isRunning:d.isRunning,
            isAlikeDead:false, isInCombat:false, mountType:0, mountNpcId:0, cubics:[], abnormalState:0,
            paperdoll:d.paperdoll.slice(), privateStoreType:0, isSitting:false, runSpd:160, walkSpd:80,
            swimRunSpd:100, swimWalkSpd:50, airRunSpd:300, airWalkSpd:150, moveMultiplier:1,
            attackSpeedMultiplier:1, collisionRadius:9, collisionHeight:23, karma:0, pvpFlag:0,
            recommendations:0, nameColor:0xffffff, isHero:false, clanId:0, clanCrestId:0,
            allyId:0, allyCrestId:0, largeCrestId:0, clanRelation:0, team:0
          };
          const object = network.actors.spawnSimulatedPlayer(info);
          ours.set(d.objectId,object);
          return object;
        });
        let timer, onAbort;
        try {
          const aborted = new Promise((_,reject) => { if (signal) { onAbort = () => reject(new Error('Synthetic crowd loading aborted.')); signal.addEventListener('abort',onAbort,{once:true}); if (signal.aborted) onAbort(); } });
          const actors = await Promise.race([
            Promise.all(group.map(o => o.actorReady.then(actor => { if (actor) actorIds.set(actor, o.objectId); return actor; }))),
            aborted,
            new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Synthetic crowd actor readiness timed out.')), Math.min(timeoutMs, remainingMs)); })
          ]);
          offlineNetwork();
          if (actors.some((actor,j) => !actor || group[j].isRemoved)) throw new Error('Synthetic pawn removed or failed to load.');
        } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort',onAbort); }
      }
      return { requested:descriptors.length, ready:ours.size, durationMs:performance.now()-startedAt, actions:'disabled', batchSize };
    } catch (error) {
      // Avoid mutating an unrelated session if playback stopped during loading.
      try { clear(); } catch (_) { /* caller must discard replay page */ }
      throw error;
    } finally { busy = false; }
  }
  function startDrawProbe() {
    const network = offlineNetwork(), render = globalThis.renderManager, renderer = render.renderer;
    if (drawProbe) throw new Error('Synthetic draw probe already active.');
    const original = renderer.renderBufferDirect;
    const counts = { totalSubmissions: 0, pawnMeshSubmissions: 0, equipmentMeshSubmissions: 0, actorIds: new Set(), meshNames: new Set() };
    const wrapper = function(...args) {
      if (args[1] === render.scene) {
        const mesh = args[4];
        let actor = mesh;
        while (actor && !actor.isActor) actor = actor.parent;
        const id = actor && actorIds.get(actor), object = id && ours.get(id);
        if (object && object.actor === actor && network.actors.objects.get(id) === object) {
          counts.totalSubmissions++;
          counts.actorIds.add(id);
          if (mesh.isPawnMesh) counts.pawnMeshSubmissions++;
          const component = actor.findComponent?.('pawnRenderable');
          if (component?.equipmentMeshes?.includes(mesh)) counts.equipmentMeshSubmissions++;
          if (mesh.name && counts.meshNames.size < 30) counts.meshNames.add(String(mesh.name).slice(0,120));
        }
      }
      return original.apply(this,args);
    };
    renderer.renderBufferDirect = wrapper;
    drawProbe = { renderer, original, wrapper, counts };
  }
  function stopDrawProbe() {
    if (!drawProbe) throw new Error('Synthetic draw probe not active.');
    const { renderer, original, wrapper, counts } = drawProbe;
    if (renderer.renderBufferDirect !== wrapper) throw new Error('Render wrapper changed while synthetic probe was active; discard page.');
    renderer.renderBufferDirect = original;
    drawProbe = null;
    return { totalSubmissions:counts.totalSubmissions, pawnMeshSubmissions:counts.pawnMeshSubmissions,
      equipmentMeshSubmissions:counts.equipmentMeshSubmissions, actorIds:[...counts.actorIds], meshNames:[...counts.meshNames],
      scope:'renderBufferDirect entry calls before crowd batching; not proof of individual GPU draws' };
  }
  function status() {
    const network = offlineNetwork();
    let present = 0, ready = 0, visible = 0, equippedMeshes = 0, bodyMeshes = 0, batchedMeshes = 0, renderSeen = 0;
    for (const [id,object] of ours) if (network.actors.objects.get(id) === object && !object.isRemoved) {
      present++;
      if (object.actor) {
        ready++; if (object.actor.visible) visible++;
        const comp = object.actor.findComponent?.('pawnRenderable');
        if (comp) { equippedMeshes += comp.equipmentMeshes?.length || 0; bodyMeshes += comp.meshes?.length || 0; batchedMeshes += comp.batches?.length || 0; if (comp.isRendered) renderSeen++; }
      }
    }
    return { requested:ours.size, present, ready, actorVisible:visible, bodyMeshes, equippedMeshes, batchedMeshes, renderSeen, actions:'disabled', busy };
  }
  Object.defineProperty(globalThis,'__siegeSynthetic',{ value:Object.freeze({prepare,spawn,status,clear,startDrawProbe,stopDrawProbe}), configurable:false });
}

module.exports = { installInPage };
