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
