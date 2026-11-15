---
name: lineage2js-gpu-repro
description: Record an allowlisted gameplay workload once, then replay it offline to reproduce and reduce Lineage2JS Metal/WebGL2 hangs; includes an optional CPU bone-atlas parent audit.
metadata:
  short-description: Offline Lineage2JS GPU repro
---

# Lineage2JS offline GPU reproduction

Use this repository skill when diagnosing a repeatable Lineage2JS browser GPU hang and a local client/dev server is available. Start with the user's current confirmed trigger and a clean worktree review. Prefer a real packet recording replayed offline after the capture exists: it makes iteration quick and avoids repeated login, character selection, and manual teleports. Keep every result scoped to the workload and settings actually exercised.

Read [the harness README](README.md) and inspect the scripts before running them. They document required local dependencies, privacy, guards, and limits. Do not copy packet recordings, game assets, browser logs, native traces, or bone-atlas snapshots into this skill or a commit.

## Flow

1. **Capture once through the normal UI.** User signs in and reaches the connected lobby in a visible local browser. Start `packet-record.cjs` before character start, wait for `hook-installed`, then use the UI to enter the world and perform the user-confirmed repro. Credentials are entered only by the user and never stored in commands, code, or logs. Treat the bounded recorder as not end-to-end validated for a new build until its output confirms UserInfo, scene metadata, and a successful conversion.
2. **Convert and validate.** Run `packets-to-replay.cjs` with explicit input and output paths. Preserve a private copy. Check its summary for initial UserInfo and a teleport packet; conversion validity is not GPU evidence.
3. **Replay offline.** Run `offline-replay.cjs` with `GPU_REPRO_EXCLUSIVE=1`, an explicit asset directory, and a bounded supported speed. It opens its own visible browser and requires a healthy ANGLE Metal renderer. It forbids nonlocal/game-server WebSockets and reports context events, teleport handler calls, render counters, and errors.
4. **Reduce one factor at a time.** Preserve the positive replay as a control. Change one bounded variable per arm (for example replay speed or an isolated scene/actor effect), use the same browser, renderer, resolution, assets, and observation window, and stop after a context loss or GPU reset. Avoid blind retries and never treat a static scene or synthetic teleport as equivalent to recorded server packets.
5. **Use the bone audit only for a targeted question.** `GPU_REPRO_BONE_AUDIT=1` validates CPU parent graphs at matching skinned draws. An invalid graph causes that diagnostic draw to be skipped. This alters what the GPU receives; it is an investigation aid, not an unmodified reproduction or proof of GPU sampler contents.

## Evidence and limits

Pair replay JSONL with browser/native stderr, and preserve exact trigger time, replay speed, viewport, renderer, asset source, scene and whether a trace finalized. A native hang should be supported by native GPU-process evidence plus replay timing and context-loss evidence; a nonzero exit alone is insufficient. Report both what ran and what was not represented. A packet replay is offline: it does not perform authentication, server-side teleport callbacks, or account/world writes. A CPU atlas audit does not prove the GPU received the same bytes. No root cause or fix is established until a controlled reduction ties the failing workload to the changed factor.

The `GPU_REPRO_EXCLUSIVE` flag is a safety guard, not authorization. Coordinate GPU use with the session owner, do not launch competing GPU browsers, and stop on context loss, a GPU reset, invalid audit, or capture failure. Never kill a user's browser or modify account/database state as part of this flow.
