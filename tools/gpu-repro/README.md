# Offline GPU repro tools

This folder contains an offline replay runner, a bounded gameplay packet recorder and converter, and an optional CPU-side bone-atlas parent audit. The replay is intended for a local Lineage2JS development build on macOS with a Metal-capable browser. It runs the client's built-in replay path from an actual session capture, without logging in or connecting to the game server. Once a recording exists, repeated replay runs avoid manual character selection and teleporting.

## Requirements

- A checkout of this repository with its normal development server and game client source.
- Node.js, `playwright` (with Chromium support), and `typescript` resolvable by Node. The scripts accept `GPU_REPRO_PLAYWRIGHT_MODULE` and `GPU_REPRO_TYPESCRIPT_MODULE` if those packages are installed outside normal module lookup.
- A local game asset directory selected with `GPU_REPRO_ASSETS`.
- For Metal results, macOS and a Chrome/Chromium build that exposes ANGLE Metal. Set `GPU_REPRO_CHROME` to its executable when Playwright's bundled browser is not the desired build.

Install dependencies according to the repository's development setup. These tools do not modify `package.json` or install dependencies themselves.

## Record once from the normal UI

The recorder attaches to an already-open local browser through loopback CDP. The user signs in through the visible UI; the script neither reads nor supplies credentials. After the user reaches the connected lobby, start the hook **before** selecting/starting the character. Then use the ordinary UI to enter the world and perform the route that reproduces the issue.

```sh
GPU_REPRO_CDP_URL=http://127.0.0.1:9224 \
GPU_REPRO_RECORD_DIR="$HOME/gpu-repro-private" \
node tools/gpu-repro/packet-record.cjs
```

The recording is limited to 120 seconds and 16 MiB. It stores an allowlist of replayable gameplay packets and one scene record; chat and authentication/handshake packets are excluded, and packets are forwarded unchanged. The capture is not known to be end-to-end validated in every client build. Confirm the final event reports an initial UserInfo packet and scene metadata before relying on its output.

Recordings can contain character/object identifiers, coordinates, equipment, and world state. Treat them as private diagnostic data; do not commit them or publish the output directory. Credentials are not recorded by this hook, but keep the source session private.

Convert the JSONL capture into the normal client replay format:

```sh
node tools/gpu-repro/packets-to-replay.cjs \
  "$HOME/gpu-repro-private/packets.jsonl" \
  "$HOME/gpu-repro-private/repro.l2r"
```

The converter requires a UserInfo packet first and validates packet ordering, size, replay allowlist, and the serialized replay. It reports whether a teleport packet exists. A successful conversion alone does not establish that the recording reproduces a hang.

## Replay offline

Start the local development server normally. Coordinate an exclusive GPU window: close other GPU-heavy applications and diagnostic browsers, and do not run a second replay at the same time. The explicit flag is a guard, not permission to interrupt another session.

```sh
GPU_REPRO_EXCLUSIVE=1 \
GPU_REPRO_ASSETS="/path/to/local/game-assets" \
GPU_REPRO_SPEED=8 \
DEBUG=pw:browser \
node tools/gpu-repro/offline-replay.cjs "$HOME/gpu-repro-private/repro.l2r" \
  > "$HOME/gpu-repro-private/replay.jsonl" \
  2> "$HOME/gpu-repro-private/browser-native.log"
```

`GPU_REPRO_SPEED` accepts 1, 2, 4, or 8. Start with the fastest repeatable setting; compare slower playback when packet timing may matter. The runner uses a visible browser and checks that its renderer is ANGLE Metal. Its hard run limit is three minutes. It records replay/teleport timing, render counters, context events, and browser/native errors. Exit status alone does not identify a GPU hang: correlate native GPU-process evidence with the replay and WebGL context-loss events. Keep the JSONL and native stderr together.

With a fresh asset cache, accelerated playback of one recorded route raised a projectile-target JavaScript error at both 4× and 8×; the same recording completed at 8× with a warmed cache. The runner stops on page errors, so treat such a run as inconclusive and try a warmed profile or normal speed.

Useful configuration:

- `GPU_REPRO_URL`: local client URL (default `http://127.0.0.1:8080/?login&diskAssets`). It must be loopback HTTP(S).
- `GPU_REPRO_CHROME`: browser executable path; omit to use Playwright's browser.
- `GPU_REPRO_PROFILE`: dedicated browser profile path.
- `GPU_REPRO_USER_PROFILE`: optional user/debug browser profile path; the runner refuses to start when it sees this profile active.
- `GPU_REPRO_OUTPUT_DIR`: directory for bone-atlas audit output; defaults to an OS temporary directory.
- `GPU_REPRO_BONE_AUDIT=1`: enable the optional parent audit.
- `GPU_REPRO_KEEP_OPEN=1`: keep the replay page available briefly for CDP inspection on `GPU_REPRO_CDP_PORT` (default 9225).

The offline runner replaces page WebSocket construction so only the configured loopback dev-server `/ws` endpoint is permitted. Any game-server or nonlocal WebSocket connection fails closed. The browser profile and owned-process cleanup use a unique instance marker; the runner never terminates a browser based only on profile-wide matching.

## Bone-atlas parent audit

The optional audit inspects CPU-side pose/bind texture bytes for parent cycles or out-of-range indices immediately before matching skinned draws. It skips a draw only when its CPU graph is invalid, to avoid submitting that diagnostic workload. This changes the workload and cannot establish what data the GPU sampled or prove that the audited input caused a hang. Audit JSON and binary snapshots may contain private model data; keep them out of source control.

## Interpretation

Keep synthetic controls, live UI repros, and recorded-packet playback distinct. A recorded replay tests the packets and client handlers represented in the recording; it does not run a live server session or guarantee every server callback. A clean replay is evidence only for that recording, renderer, viewport, settings, and observation window. A valid CPU parent graph does not prove GPU texture contents. Do not infer a root cause from a single correlation or claim a fix without a controlled repeat and evidence tied to the failing workload.
