import assert from "node:assert/strict";
import { Bone, Matrix4, Object3D } from "three";
import boneAtlas, { BoneAtlas } from "../src/objects/bone-atlas";
import { LocalSpaceSkeleton } from "../src/objects/local-space-skeleton";

class ProbedSkeleton extends LocalSpaceSkeleton {
    public captureParents(): Int32Array {
        (this as any).claimBones();
        return (this as any).parents;
    }

    public atlasState() {
        return { references: (this as any).atlasReferences, offset: this.atlasOffset, packed: this.isAtlasPacked, parents: (this as any).parents };
    }
}

const externalParent = new Bone();
const looseRoot = new Bone();
const looseChild = new Bone();
externalParent.add(looseRoot);
looseRoot.add(looseChild);
const skeleton = new ProbedSkeleton([looseRoot, looseChild]);
skeleton.mesh = new Object3D() as any;
assert.deepEqual(Array.from(skeleton.captureParents()), [-1, -1]);

const invalidMesh = new Object3D();
const invalidRoot = new Bone();
const invalidChild = new Bone();
invalidMesh.add(invalidRoot);
invalidChild.parent = externalParent;
const invalidSkeleton = new ProbedSkeleton([invalidRoot, invalidChild]);
invalidSkeleton.mesh = invalidMesh as any;
for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => invalidSkeleton.retainAtlas(), /outside its own skeleton/);
    const state = invalidSkeleton.atlasState();
    assert.equal(state.references, 0);
    assert.equal(state.offset, -1);
    assert.equal(state.packed, false);
    assert.equal(state.parents, null);
}

const rollbackMesh = new Object3D();
const rollbackRoot = new Bone();
const rollbackChild = new Bone();
rollbackMesh.add(rollbackRoot);
rollbackRoot.add(rollbackChild);
const rollbackSkeleton = new ProbedSkeleton([rollbackRoot, rollbackChild]);
rollbackSkeleton.mesh = rollbackMesh as any;
rollbackSkeleton.boneInverses = [new Matrix4(), new Matrix4()];
const originalSetBind = boneAtlas.setBind;
const allocationCount = (boneAtlas as any).counts.size;
try {
    boneAtlas.setBind = () => { throw new Error("injected bind failure"); };
    assert.throws(() => rollbackSkeleton.retainAtlas(), /injected bind failure/);
    const state = rollbackSkeleton.atlasState();
    assert.equal(state.references, 0);
    assert.equal(state.offset, -1);
    assert.equal(state.packed, false);
    assert.equal((boneAtlas as any).counts.size, allocationCount);
} finally { boneAtlas.setBind = originalSetBind; }

const atlas = new BoneAtlas(1);
const start = atlas.allocate(3);
const inverses = [new Matrix4(), new Matrix4(), new Matrix4()];

// Valid parent-before-child links are preserved, and invalid forward links are
// rejected before they can become shader traversal cycles.
atlas.setBind(start, inverses, new Int32Array([-1, 0, 1]));
const bind = atlas.bind as Float32Array;
assert.deepEqual([bind[start * 16 + 12], bind[(start + 1) * 16 + 12], bind[(start + 2) * 16 + 12]], [-1, start, start + 1]);
const bindSnapshot = Array.from(bind.slice(start * 16, (start + 3) * 16));
const bindVersion = atlas.bindTexture.version;
assert.throws(() => atlas.setBind(start, inverses, new Int32Array([0, 0, 1])), /parent that is not before it/);
assert.throws(() => atlas.setBind(start, inverses, new Int32Array([-1, 0])), /matching lengths/);
assert.deepEqual(Array.from(bind.slice(start * 16, (start + 3) * 16)), bindSnapshot);
assert.equal(atlas.bindTexture.version, bindVersion);

atlas.dirtyStart = Infinity;
atlas.dirtyEnd = -1;
const textureVersion = atlas.bindTexture.version;
atlas.free(start);

assert.deepEqual([bind[start * 16 + 12], bind[(start + 1) * 16 + 12], bind[(start + 2) * 16 + 12]], [-1, -1, -1]);
assert.ok(atlas.bindTexture.version > textureVersion);
assert.equal(atlas.dirtyStart, 0);
assert.equal(atlas.dirtyEnd, 0);

console.log("Bone atlas lifecycle: invalid parent edges terminate; freed ranges clear parents and dirty their row.");
