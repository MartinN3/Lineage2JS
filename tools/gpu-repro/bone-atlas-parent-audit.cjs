'use strict';
// Local diagnostic only. The same pure function below is serialized into the page.
const fs = require('node:fs');
const path = require('node:path');
const SENTINEL = '__L2_BONE_PARENT_AUDIT__:';
function validateBoneAtlasParents({ pose, bind, width, height, scissor, viewport, maxFailures = 1 }) {
  if (!Number.isSafeInteger(width) || width <= 0 || width % 4 || !Number.isSafeInteger(height) || height <= 0
    || width * height > 4 * 1024 * 1024 || pose.length !== width * height * 4 || bind.length !== pose.length) {
    throw new Error('Invalid bone-atlas dimensions/data lengths');
  }
  if (!Number.isSafeInteger(maxFailures) || maxFailures < 1 || maxFailures > 8) throw new Error('Invalid failure limit');
  const rect = value => {
    if (!value) return [0, 0, width, height];
    if (value.length !== 4 || value.some(v => !Number.isFinite(v) || Math.abs(v) > 2147483647)) throw new Error('Invalid rectangle');
    const result = value.map(Math.trunc);
    if (result[2] < 0 || result[3] < 0) throw new Error('Negative rectangle size');
    return result;
  };
  const s = rect(scissor), v = rect(viewport);
  const x0 = Math.max(0, s[0], v[0]), y0 = Math.max(0, s[1], v[1]);
  const x1 = Math.min(width, s[0] + s[2], v[0] + v[2]), y1 = Math.min(height, s[1] + s[3], v[1] + v[3]);
  const perRow = width / 4, total = perRow * height;
  const knownTerminates = new Uint8Array(total);
  const failures = [], warnings = [];
  let checkedStartBones = 0, skinMatrixBypassed = 0, visited = 0;
  const bad = (kind, startBone, chain, extra = {}) => failures.push({ kind, startBone, chain, ...extra });
  for (let row = y0; row < y1; row++) {
    if (x1 <= x0) continue;
    for (let column = Math.floor(x0 / 4); column <= Math.floor((x1 - 1) / 4); column++) {
      const start = row * perRow + column;
      checkedStartBones++;
      // This branch exists ONLY at the initial fragment bone, not inside while.
      if (pose[start * 16 + 12] === 2) { skinMatrixBypassed++; continue; }
      const chain = [], local = new Map();
      let current = start, success = false;
      while (true) {
        if (knownTerminates[current]) { success = true; break; }
        if (local.has(current)) { bad('cycle', start, [...chain, current], { cycleStart: local.get(current) }); break; }
        local.set(current, chain.length); chain.push(current); visited++;
        const value = bind[current * 16 + 12];
        // int(float) is truncation toward zero; nonfinite/out-of-int32 conversions
        // are undefined in GLSL, so this is invalid input, not proof of a cycle.
        if (!Number.isFinite(value) || value < -2147483648 || value > 2147483647) {
          bad('undefined-parent-conversion', start, chain, { bone: current, value: String(value) }); break;
        }
        const parent = Math.trunc(value) || 0;
        if (value !== parent && warnings.length < 8) warnings.push({ kind: 'fractional-parent-truncated', bone: current, value, parent });
        if (parent < 0) { success = true; break; }
        if (parent >= total) { bad('parent-out-of-bounds', start, chain, { bone: current, value, parent, totalBones: total }); break; }
        current = parent;
      }
      if (success) for (const bone of chain) knownTerminates[bone] = 1;
      if (failures.length >= maxFailures) return { valid: false, checkedStartBones, skinMatrixBypassed, visited,
        failures, warnings, region: { x0, y0, x1, y1 }, width, height, totalBones: total };
    }
  }
  return { valid: failures.length === 0, checkedStartBones, skinMatrixBypassed, visited,
    failures, warnings, region: { x0, y0, x1, y1 }, width, height, totalBones: total };
}
async function installBoneAtlasAudit(page) {
  return page.evaluate(({ source, sentinel }) => {
    if (window.__l2BoneAtlasAudit) return { installed: true, alreadyInstalled: true };
    const validate = (0, eval)(`(${source})`);
    const renderer = globalThis.renderManager?.renderer;
    if (!renderer?.renderBufferDirect) throw new Error('Renderer unavailable for atlas audit');
    const original = renderer.renderBufferDirect;
    const stats = { audits: 0, valid: 0, skipped: 0, errors: 0, firstFailure: null, last: null };
    let published = false;
    const vector = v => v ? [v.x, v.y, v.z, v.w] : null;
    const tag = value => value?.__SPECTOR_Object_TAG || null;
    const textureInfo = texture => {
      const props = renderer.properties.get(texture);
      return { uuid: texture.uuid, name: texture.name, width: texture.image.width, height: texture.image.height,
        cpuVersion: texture.version, rendererVersion: props.__version ?? null, gpuTag: tag(props.__webglTexture),
        hasGpuTexture: !!props.__webglTexture, type: texture.type, format: texture.format };
    };
    const encoded = data => {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { type: data.constructor.name, byteLength: bytes.length, base64: btoa(text) };
    };
    const wrapper = function(camera, scene, geometry, material, object, group) {
      const u = material?.uniforms;
      if (!material?.isRawShaderMaterial || !u?.poseMap?.value?.isDataTexture || !u?.bindMap?.value?.isDataTexture
        || !u?.clipMap?.value?.isDataTexture || !material.fragmentShader?.includes('boneColumn')
        || !material.fragmentShader.includes('while (true)')) return original.call(this,camera,scene,geometry,material,object,group);
      let unsafeGraph = false;
      try {
        const pose = u.poseMap.value, bind = u.bindMap.value, clip = u.clipMap.value, target = renderer.getRenderTarget();
        if (!target || pose.image.width !== bind.image.width || pose.image.height !== bind.image.height) throw new Error('Atlas target/data dimensions mismatch');
        const result = validate({ pose: pose.image.data, bind: bind.image.data, width: pose.image.width,
          height: pose.image.height, scissor: target.scissorTest ? vector(target.scissor) : null, viewport: vector(target.viewport) });
        stats.audits++;
        const metadata = { utc: new Date().toISOString(), result, pose: textureInfo(pose), bind: textureInfo(bind), clip: textureInfo(clip),
          target: { width: target.width, height: target.height, viewport: vector(target.viewport), scissor: vector(target.scissor),
            scissorTest: target.scissorTest, textureUuid: target.texture.uuid, textureName: target.texture.name },
          material: { id: material.id, name: material.name },
          cpuGpuCaveat: 'Audited CPU DataTexture bytes before draw. Renderer version mismatch may be normal pending upload; raw row uploads do not update renderer __version. This does not prove GPU sampler contents.' };
        stats.last = metadata;
        if (result.valid) { stats.valid++; } else {
        unsafeGraph = true; stats.skipped++;
        if (!stats.firstFailure) stats.firstFailure = metadata;
        if (!published) {
          published = true;
          console.info(sentinel + JSON.stringify({ ...metadata, diagnosticQuadSkipped: true,
            shader: material.fragmentShader, poseBytes: encoded(pose.image.data), bindBytes: encoded(bind.image.data) }));
        }
        }
      } catch (error) {
        stats.errors++;
        if (!published) { published = true; console.info(sentinel + JSON.stringify({ utc: new Date().toISOString(),
          auditError: String(error?.stack || error), diagnosticQuadSkipped: false })); }
      }
      if (unsafeGraph) return; // Never submit the verified invalid diagnostic quad.
      return original.call(this,camera,scene,geometry,material,object,group);
    };
    renderer.renderBufferDirect = wrapper;
    const api = { stats: () => JSON.parse(JSON.stringify(stats)), restore: () => {
      if (renderer.renderBufferDirect === wrapper) renderer.renderBufferDirect = original;
      delete window.__l2BoneAtlasAudit;
    } };
    window.__l2BoneAtlasAudit = api;
    return { installed: true, semantics: 'Validate every addressed start bone; bypass initial mode2 only; skip invalid diagnostic quad, retain valid draws' };
  }, { source: validateBoneAtlasParents.toString(), sentinel: SENTINEL });
}
function createAuditSink(cdpSession, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const saved = [], errors = [];
  const listener = params => {
    const text = (params.args || []).map(arg => arg.value ?? '').join('');
    if (!text.startsWith(SENTINEL) || saved.length) return;
    const body = text.slice(SENTINEL.length);
    if (Buffer.byteLength(body) > 32 * 1024 ** 2) { errors.push('Atlas audit snapshot exceeded 32 MiB'); return; }
    try {
      const data = JSON.parse(body);
      for (const [key, name] of [['poseBytes', 'pose.bin'], ['bindBytes', 'bind.bin']]) {
        if (!data[key]) continue;
        const bytes = Buffer.from(data[key].base64, 'base64');
        if (bytes.length !== data[key].byteLength) throw new Error('Atlas binary snapshot length mismatch');
        fs.writeFileSync(path.join(outputDir, name), bytes, { mode: 0o600, flag: 'wx' });
        data[key] = { ...data[key], base64: undefined, file: name };
      }
      const target = path.join(outputDir, 'bone-parent-failure.json');
      fs.writeFileSync(target, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
      saved.push({ path: target, invalidGraph: !!data.result && !data.result.valid,
        diagnosticQuadSkipped: data.diagnosticQuadSkipped, auditError: data.auditError || null });
    } catch (error) { errors.push(error.message); }
  };
  cdpSession.on('Runtime.consoleAPICalled', listener);
  return { saved, errors, close: () => cdpSession.off('Runtime.consoleAPICalled', listener) };
}
async function getBoneAtlasAuditStats(page) { return page.evaluate(() => window.__l2BoneAtlasAudit?.stats() || null); }
module.exports = { SENTINEL, validateBoneAtlasParents, installBoneAtlasAudit, createAuditSink, getBoneAtlasAuditStats };
