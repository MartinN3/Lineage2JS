import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ObjectComponent } from '../src/game/components';
import Actor from '../src/objects/actor';
import PhysicsManager from '../src/physics/physics-manager';

const calls: string[] = [];
class ScriptStub extends ObjectComponent<any> {
    readonly componentName = 'script';
    call(name: string) { calls.push(`${this.getParent().name}:${name}`); return null; }
    getVM() { return { invokeNative: () => false }; }
}
class TransformStub extends ObjectComponent<any> {
    readonly componentName = 'transform';
    getBasedActors() { return new Set(); }
    updateRelativeLocation() {}
}
function actor(name: string, script = true) {
    const host = new Actor({ uuid: name, name, scriptClassId: 'engine.Actor', scriptProperties: {} }, false);
    if (script) host.addComponent(new ScriptStub());
    return host;
}
const levelInfo = actor('level');
const zone = actor('zone');
const destination = actor('destination');
const level = {
    levelInfoActor: levelInfo,
    pointRegion: () => ({ Zone: zone, iLeaf: 0, ZoneNumber: 1 }),
    getDefaultPhysicsVolume: () => destination
};
const render = { getLoadedSectors: () => [level], getLevel: () => level, needsUpdate: false };
const physics: any = Object.create(PhysicsManager.prototype);
physics.manGame = { getComponent: (name: string) => { assert.equal(name, 'render'); return render; } };
physics.collisionWorld = {
    moveActor: (query: any) => { query.location.add(query.delta); return null; },
    notifyMove() {}
};
function pawnLeaving(volume: Actor, previousZone = zone) {
    const pawn: any = actor('pawn');
    pawn.addComponent(new TransformStub());
    pawn.getCollisionHeight = () => 10;
    for (const [key, value] of Object.entries({
        Level: levelInfo, Region: { Zone: previousZone, iLeaf: 0, ZoneNumber: 1 },
        Location: [0, 0, 0], bMovable: true, bCollideActors: true,
        PhysicsVolume: volume, HeadVolume: volume, FootVolume: volume
    })) pawn.setUnrealScriptProperty(key, value as any);
    return pawn;
}
function walk(pawn: any) {
    assert(physics.moveActor({ location: new Vector3(), delta: new Vector3(1, 0, 0), sourceProfile: { collideActors: true, collideWorld: true } }, pawn));
}
function assertTransition(pawn: any) {
    assert.equal(pawn.getUnrealScriptProperty('PhysicsVolume'), destination);
    assert.equal(pawn.getUnrealScriptProperty('HeadVolume'), destination);
    assert.equal(pawn.getUnrealScriptProperty('FootVolume'), destination);
    assert(calls.includes('pawn:PhysicsVolumeChange'));
    assert(calls.includes('destination:PawnEnteredVolume'));
    assert(calls.includes('pawn:HeadVolumeChange'));
}

// A surviving pawn can retain an old volume after its streamed sector releases
// the actor. Reproduce the actual moveActor -> setPawnZone -> leaving event path.
const retired = actor('retired');
const pawn = pawnLeaving(retired);
retired.release(false);
assert(retired.isPendingKill());
assert.equal(retired.findComponent('script'), null);
walk(pawn);
assertTransition(pawn);
assert(!calls.includes('retired:PawnLeavingVolume'));

calls.length = 0;
const live = actor('live');
walk(pawnLeaving(live));
assert(calls.includes('live:PawnLeavingVolume'), 'Live volume leaving events must still run');

calls.length = 0;
const retiredZone = actor('retired-zone');
retiredZone.release(false);
walk(pawnLeaving(retired, retiredZone));
assert(!calls.includes('retired-zone:ActorLeaving'));
assert(calls.includes('pawn:ZoneChange'));
assert(calls.includes('zone:ActorEntered'));

const releasing = actor('releasing');
releasing.setUnrealScriptProperty('bPendingDelete', true);
releasing.detachComponents();
walk(pawnLeaving(releasing));
assert(!calls.includes('releasing:PawnLeavingVolume'), 'Hosts already releasing must not be called');

// Missing components on live actors remain programming errors.
assert.throws(() => walk(pawnLeaving(actor('broken-live', false))), /Component 'script' is not attached/);
console.log('Retired volume/zone movement lifecycle regression passed');
