# UI image compatibility regression

Install optional Playwright and its WebKit/Chromium browsers, then run:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/run-ui-image.cjs
```

`CHROME_EXECUTABLE` can select an existing Chromium executable. The CPU-only test
uses blank pages and 2D canvases. It checks PNG fallback in WebKit, the BMP fast
path in Chromium, exact decoded RGBA, CSS background pixels and alpha, synchronous
tint requests, one cached probe and cleanup after decode failure or timeout.
The tint method is extracted from the actual NDomLayer source to avoid loading
the game. No game assets, server or WebGL context are used.

# Primitive array compatibility regression

Run the core's CPU-only Node checks against the pinned core fork after installing
the project dependencies:

```sh
node tests/run-core-array-compat.cjs
```

With optional Playwright and its WebKit browser installed, test the WebKit engine:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/run-core-array-compat.cjs --webkit
```

The checks exercise the core implementation directly, including exact-range
copies for unaligned arrays and zero-copy behavior for aligned arrays. No game
assets, server or WebGL context are used.

# Browser rendering regression

The nameplate-depth regression runs a minimal scene in real Chromium WebGL2. It
forces context loss and restoration for single-sample and multisample render
targets. No Lineage II assets or game server are required.
It also renders quest alarms without visible nameplates, clears and repopulates
their markers as during a teleport/loading transition, and checks that alarms
skip invalid depth during context loss and resume after restoration.

After installing the project's build dependencies, install the optional browser
test tool and its Chromium browser without changing the project manifest:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/run-nameplate-depth.cjs
```

If Playwright or Chrome is already installed elsewhere, use the existing copies:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
CHROME_EXECUTABLE=/absolute/path/to/chrome \
node tests/run-nameplate-depth.cjs
```

The runner uses software WebGL so the test can run headlessly. It verifies the
nameplate-depth path, not the complete game, driver stability, or why a browser
lost its graphics context.

# Party roster regression

After installing the repository dependencies, run the focused party snapshot
and duplicate-add regression with:

```sh
node tests/run-party-roster.cjs
```

The runner bundles the real party packet handlers and party window class, then
exercises them with a small mocked UI. It does not start a game server or
create a browser or GPU context.

# Physics volume lifecycle regression

After installing the project dependencies, run:

```sh
node tests/run-retired-volume-zone-events.cjs
```

The test uses the actual actor release and pawn movement/zone-transition code
with an isolated collision fixture. It needs no game assets, server, browser or
GPU. It covers released and releasing volume hosts, live-volume callbacks,
retired zones and preservation of errors on live hosts missing their script.
