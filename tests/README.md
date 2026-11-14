# Primitive array compatibility regression

Run the CPU-only Node checks after installing the project dependencies:

```sh
node tests/run-core-array-compat.cjs
```

With optional Playwright and its WebKit browser installed, test the Safari engine:

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node tests/run-core-array-compat.cjs --webkit
```

Add `--baseline` to run the original dependency implementation; WebKit rejects
its misaligned typed-array views. No game assets, server or WebGL context are used.
