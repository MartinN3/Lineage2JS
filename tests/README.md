# Browser rendering regression

The nameplate-depth regression runs a minimal scene in real Chromium WebGL2. It
forces context loss and restoration for single-sample and multisample render
targets. No Lineage II assets or game server are required.

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
