// Requires Playwright (or PLAYWRIGHT_MODULE pointing to an installed module).
// CHROME_EXECUTABLE optionally selects an existing Chromium browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nameplate-depth-'));
    let browser;
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development',
                entry: path.join(__dirname, 'nameplate-depth.browser.ts'),
                output: { path: directory, filename: 'test.js' },
                resolve: { extensions: ['.ts', '.js'] },
                module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: {
                    loader: require.resolve('babel-loader'),
                    options: { presets: [require.resolve('@babel/preset-typescript')] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROME_EXECUTABLE || undefined,
            args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
        });
        const page = await browser.newPage();
        await page.setContent('<body></body>');
        await page.addScriptTag({ path: path.join(directory, 'test.js') });
        await page.waitForFunction(() => window.nameplateDepthResult, null, { timeout: 30000 });
        const result = await page.evaluate(() => window.nameplateDepthResult);
        if (!result.passed) throw new Error(result.error);
        console.log('Nameplate depth WebGL context loss/restoration passed (0 and 4 samples)');
    } finally {
        if (browser) await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
