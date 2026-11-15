'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sourceName = 'src/objects/local-space-skeleton.ts';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function instrumentSource(source, variant, token) {
 if (!['baseline', 'candidate'].includes(variant)) throw new Error('Variant must be baseline or candidate');
 if (source.includes('__l2CrowdBenchmarkBuild')) throw new Error('Source is already instrumented');
 const tail = "return; // a loose chain attached onto some other skeleton's bone, see attachLooseBoneChains";
 if (source.split(tail).length !== 2) throw new Error('Expected exactly one loose-skeleton return');
 const hook = `globalThis.__l2SiegeBench.claimBones(false, bones.length);\n            globalThis.__l2SiegeBench.sanitizeParents(this.parents);\n            ${tail}`;
 const early = `if (!this.ownsBones) ${tail}`;
 if (source.includes(early)) source = source.replace(early, `if (!this.ownsBones) {\n            ${hook}\n        }`);
 else {
  const before = source.slice(0, source.indexOf(tail));
  if (!/if \(!(?:this\.)?ownsBones\) \{[^}]*$/s.test(before)) throw new Error('Unsupported loose-skeleton branch; inspect before adapting');
  source = source.replace(tail, hook);
 }
 const owned = 'for (let i = 0, len = bones.length; i < len; i++) indices.set(bones[i], i);';
 if (source.split(owned).length !== 2) throw new Error('Expected exactly one owned-skeleton loop');
 source = source.replace(owned, `globalThis.__l2SiegeBench.claimBones(true, bones.length);\n\n        ${owned}`);
 return `globalThis.__l2CrowdBenchmarkBuild = ${JSON.stringify({ version: 1, variant, token })};\n` + source;
}
function prepare(repo, variant, write = false) {
 const root = fs.realpathSync(repo);
 if (!fs.existsSync(path.join(root, '.git'))) throw new Error('Target must be an isolated Git checkout or worktree');
 const file = path.join(root, sourceName), original = fs.readFileSync(file, 'utf8');
 const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'), lock = JSON.parse(lockText);
 const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
 const changes = execFileSync('git', ['status', '--porcelain', '--', sourceName], { cwd: root, encoding: 'utf8' }).trim();
 if (changes) throw new Error('Target skeleton source must be clean; use a separate worktree');
 const token = hash(`${revision}:${variant}:${hash(original)}:${hash(lockText)}`), text = instrumentSource(original, variant, token);
 const manifest = { version: 1, variant, revision, token, source: sourceName, originalSha256: hash(original), instrumentedSha256: hash(text), lockSha256: hash(lockText), coreResolved: lock.packages?.['node_modules/@l2js/core']?.resolved || null,
  safety: 'identical normalization fill after loose initialization in both variants; candidate production fill is retained' };
 if (write) {
  if (fs.existsSync(path.join(root, '.gpu-repro-benchmark/build.json'))) throw new Error('Benchmark manifest already exists; restore source and remove the old manifest before preparing again');
  fs.mkdirSync(path.join(root, '.gpu-repro-benchmark'), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(root, '.gpu-repro-benchmark/build.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
 }
 return manifest;
}
if (require.main === module) {
 const [repo, variant, flag] = process.argv.slice(2);
 if (!repo || !variant || (flag && flag !== '--write')) throw new Error('Usage: node prepare-crowd-benchmark.cjs <isolated-worktree> baseline|candidate [--write]');
 console.log(JSON.stringify(prepare(repo, variant, flag === '--write'), null, 2));
}
module.exports = { instrumentSource, prepare, hash, sourceName };
