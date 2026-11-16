# Offline crowd comparisons

This fork keeps a repeatable crowd benchmark alongside the replay tools. It uses a
saved packet replay and local game files: no login, game-server connection, account
or world writes. The normal replay socket guard permits only loopback webpack
traffic. Recordings, game files, generated equipment manifests, and raw results
are user-supplied local artifacts and must not be committed.

The benchmark counts actual `LocalSpaceSkeleton.claimBones` calls, loose chains,
and bone counts. It timestamps every claim, including asynchronous claims between
frames, and assigns it to the current or next main GameManager callback. It records
the main callback's JavaScript duration and timestamp cadence, excluding unrelated
UI callbacks. These are **not GPU completion or displayed-frame timings**.

## Prepare two isolated builds

Choose the baseline and candidate commits deliberately. Use separate worktrees;
never instrument the active LAN/game checkout. Keep dependency revisions, viewport,
camera, hardware, renderer, replay file, browser, and settings identical.

```sh
# Run from the fork checkout containing these tools.
TOOL_REPO="$PWD"
git worktree add --detach /tmp/crowd-baseline BASELINE_COMMIT
git worktree add --detach /tmp/crowd-candidate CANDIDATE_COMMIT
node tools/gpu-repro/prepare-crowd-benchmark.cjs /tmp/crowd-baseline baseline
node tools/gpu-repro/prepare-crowd-benchmark.cjs /tmp/crowd-candidate candidate
# Inspect the dry-run output, then instrument explicitly:
node tools/gpu-repro/prepare-crowd-benchmark.cjs /tmp/crowd-baseline baseline --write
node tools/gpu-repro/prepare-crowd-benchmark.cjs /tmp/crowd-candidate candidate --write
```

The preparer refuses dirty skeleton source, repeated preparation, or an unknown
source layout. It supports the loose-skeleton layouts used by the upstream parent
cycle fix and this fork. A build stamp and exact source hashes are stored in the
ignored `.gpu-repro-benchmark/` directory. After preparation, install dependencies,
build, and serve each checkout on loopback using its normal build workflow. The
runner checks that the served build token matches the prepared source manifest;
it rejects stale or uninstrumented bundles.

Older upstream revisions may need the same build-only TypeScript dependency
transpilation adjustment in both builds. Apply and record that separately; the
preparer changes only skeleton instrumentation. Restore or discard the isolated
worktrees afterward. Never commit an instrumented skeleton source file.

## Recorded route

Close competing Chrome/Chromium sessions during the coordinated GPU window.
Keep the live server and LAN client running. Start one isolated webpack server at
a time, for example on `127.0.0.1:8090`. Then run the tools from this fork checkout:

```sh
GPU_REPRO_EXCLUSIVE=1 \
GPU_REPRO_ASSETS="/path/to/local/game-assets" \
GPU_REPRO_URL="http://127.0.0.1:8090/?login&diskAssets" \
GPU_REPRO_PROFILE="/tmp/crowd-baseline-profile" \
GPU_REPRO_BENCHMARK=1 \
GPU_REPRO_BENCHMARK_REPO="/tmp/crowd-baseline" \
DEBUG=pw:browser \
node tools/gpu-repro/offline-replay.cjs /path/to/recording.l2r \
  > /path/to/results/baseline-01.jsonl 2> /path/to/results/baseline-01-native.log
```

Use `GPU_REPRO_PLAYWRIGHT_MODULE` and `GPU_REPRO_CHROME` as described in
[README.md](README.md) if Playwright/browser binaries are installed elsewhere.
The current renderer requirement remains Chrome ANGLE Metal; do not label this a
Linux/Windows GPU benchmark. Benchmark mode forces the pre-draw CPU parent audit,
normal-speed playback, and automatic owned-browser teardown. It stops on invalid
parents, failed audits, context loss, page errors, or a missing main callback.

Warm each variant once and discard those measurements. Alternate measured order
(e.g. baseline/candidate then candidate/baseline), using the same saved replay.
Keep raw JSONL and native stderr. Compare workload counts and replay windows
before comparing time quantiles; reject or explain differences in actor population,
initializations, packets, teleports, skipped draws, or audit errors.

```sh
node tools/gpu-repro/summarize-crowd.cjs \
  /path/to/results/baseline-01.jsonl /path/to/results/candidate-01.jsonl
```

The summary reports per-run p50/p95/p99/max, initialization totals and bursts,
workload counts and audit status. It refuses failed/incomplete/unaudited runs.
Review individual runs and paired differences; do not infer significance from a
single maximum spike or silently pool frames with different instrumentation.

### Safety instrumentation and interpretation

Both variants normalize loose parent arrays to roots immediately after claiming
bones, before CPU traversal and atlas uploads. This prevents the known unsafe
baseline cycle. The candidate's production initialization is retained, so it
executes its production fill plus the shared safety fill. This changes/cache-warms
the workload and makes the baseline safe; it is **not** an unmodified failure
comparison or precise measurement of the one-line fix. Audit and metric collection
also add overhead. Use the separate production-method benchmark for direct cost;
use this replay for crowd counts, approximate callback tails and correlations.

A CPU audit cannot prove what the GPU sampled. A crowded teleport recording is
not a castle siege with siege actions/effects. Report those limits with results.

## Optional deterministic equipped crowd

`GPU_REPRO_CROWD_CONFIG` selects a local JSON configuration. The synthetic hook
uses the normal `spawnSimulatedPlayer` appearance loader, fixed sorted item pools,
and a saved manifest. It does not run the debug tool's random action timer.
The trigger is explicit because teleports remove simulated actors.

```json
{
  "manifest": "/absolute/local/path/equipment-manifest.json",
  "createManifest": true,
  "count": 30,
  "seed": 1234,
  "batchSize": 4,
  "holdMs": 5000,
  "center": { "x": 0, "y": 0, "z": 0 },
  "trigger": { "replayTime": 70, "teleports": 3, "level": [16, 25] }
}
```

Select a valid fixed center and sector for your own recording; the example center
is a placeholder, not a known game destination. Run one discarded pilot with
`createManifest: true`, then set it to false and use the identical manifest in all
measured variants. The runner refuses seed/item-pool differences or ID collisions.
It freezes recorded packet advancement during bounded loading/hold while game and
rendering ticks continue, emits a distinct `synthetic-crowd-phase`, then removes
its local actors before resuming the replay. This hybrid workload is explicitly
different from the original recording. The synthetic phase is excluded from the
normal playback sample summary and reported separately.

Readiness, equipment mesh counts, and pre-batch `renderBufferDirect` submissions
are useful evidence, but do not prove individual GPU draws for every weapon or
character. Count actual loose chains: many equipped characters can still create
very few. On failure, further batches are cancelled and the offline page is
closed; already-started engine asset loads themselves are not cancellable.

## Tool checks

```sh
node --test tests/crowd-benchmark.test.cjs
node tests/synthetic-crowd.cjs
```

These exercise source preparation, asynchronous claim attribution, main-callback
filtering, build identity, failed-run summary rejection, bounded triggers,
descriptor determinism, readiness/abort/cleanup, and fail-closed audit behavior.
They do not substitute for a real asset/browser replay after changing tooling.
