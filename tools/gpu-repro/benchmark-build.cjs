'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash, sourceName } = require('./prepare-crowd-benchmark.cjs');
function readBuild(repo) {
 if (!repo) throw new Error('Set GPU_REPRO_BENCHMARK_REPO to the isolated, prepared build');
 const root = fs.realpathSync(repo);
 const manifest = JSON.parse(fs.readFileSync(path.join(root, '.gpu-repro-benchmark/build.json'), 'utf8'));
 if (manifest.version !== 1 || !['baseline', 'candidate'].includes(manifest.variant) || manifest.source !== sourceName || !/^[a-f0-9]{64}$/.test(manifest.token || '')) throw new Error('Invalid benchmark build manifest');
 if (manifest.lockSha256 && hash(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) !== manifest.lockSha256) throw new Error('Dependency lock changed after benchmark preparation');
 if (hash(fs.readFileSync(path.join(root, sourceName), 'utf8')) !== manifest.instrumentedSha256) throw new Error('Prepared source changed after instrumentation');
 return manifest;
}
module.exports = { readBuild };
