const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-drag-'));
    let browser;
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', entry: path.join(__dirname, 'camera-drag.browser.ts'),
                output: { path: directory, filename: 'test.js' }, resolve: { extensions: ['.ts', '.js'] },
                module: { rules: [{ test: /\.ts$/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript')] } } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });

        const engine = process.argv.includes('--webkit') ? webkit : chromium;
        browser = await engine.launch(engine === chromium ? { executablePath: process.env.CHROME_EXECUTABLE } : {});
        const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
        await page.setContent(`
            <canvas style="position:fixed;inset:0;width:100%;height:100%"></canvas>
            <div id="overlay" style="position:fixed;top:0;bottom:0;left:200px;width:200px;background:#ccc"></div>
        `);
        await page.addScriptTag({ path: path.join(directory, 'test.js') });

        const mouse = page.mouse, right = { button: 'right' };
        const readInputs = () => page.evaluate(() => window.cameraDrag.inputs.splice(0));
        const readYaw = () => page.evaluate(() => window.cameraDrag.yaw());
        const moveAndCheck = async (from, to) => {
            const yaw = await readYaw();
            await mouse.move(to, 180);
            const [input, ...rest] = await readInputs();
            assert.equal(rest.length, 0);
            assert.equal(input?.[0], 'axis', `Expected rotation on move from ${from} to ${to}`);
            assert.ok(Math.abs(input[1] - (to - from) * 65536 / 480) < 1e-8);
            const radians = await readYaw() - yaw;
            assert.ok(Math.abs(Math.atan2(Math.sin(radians), Math.cos(radians)) - (to - from) * 2 * Math.PI / 480) < 1e-8);
        };

        for (const keepCapture of [false, true]) {
            await mouse.move(190, 180);
            await mouse.down(right);
            assert.deepEqual(await readInputs(), [['press', 0, 0]]);
            await moveAndCheck(190, 195);
            if (!keepCapture) await page.evaluate(() => window.cameraDrag.releaseCapture());

            await moveAndCheck(195, 205);
            await moveAndCheck(205, 300);
            await moveAndCheck(300, 395);
            await moveAndCheck(395, 405);
            await moveAndCheck(405, 395);
            await mouse.up(right);
            assert.deepEqual(await readInputs(), [['release', 0, 0]]);
            await mouse.move(420, 180);
            assert.deepEqual(await readInputs(), []);
        }

        await mouse.move(300, 180);
        await mouse.down(right);
        await mouse.move(195, 180);
        await mouse.up(right);
        assert.deepEqual(await readInputs(), [], 'A drag starting over the UI should stay with the UI');

        await mouse.down(right);
        assert.deepEqual(await readInputs(), [['press', 0, 0]]);
        await moveAndCheck(195, 205);
        await page.evaluate(() => window.cameraDrag.cancel());
        assert.deepEqual(await readInputs(), [['release', 0, 0]]);
        await mouse.move(450, 180);
        await mouse.up(right);
        assert.deepEqual(await readInputs(), []);

        await mouse.down(right);
        assert.deepEqual(await readInputs(), [['press', 0, 0]]);
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        assert.deepEqual(await readInputs(), [['release', 0, 0]]);
        await mouse.move(460, 180);
        await mouse.up(right);
        assert.deepEqual(await readInputs(), []);

        console.log(`${engine.name()} camera drag passed with and without pointer capture`);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
