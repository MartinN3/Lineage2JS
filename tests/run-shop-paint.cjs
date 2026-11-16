const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-paint-'));
    let browser;
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', entry: path.join(__dirname, 'shop-paint.browser.ts'),
                output: { path: directory, filename: 'test.js', publicPath: '' }, resolve: { extensions: ['.ts', '.js'] },
                plugins: [new webpack.DefinePlugin({ BITMAP_NAMEPLATES: 'false' })],
                module: { rules: [
                    { test: /zip-module\.wasm$/, type: 'asset/inline' },
                    { test: /\.ts$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript')] } } }
                ] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined, args: ['--disable-gpu'] });
        const page = await browser.newPage();
        page.on('pageerror', error => console.error('browser error:', error.stack || error));
        await page.setContent('<body></body>');
        await page.addScriptTag({ path: path.join(directory, 'test.js') });
        await page.waitForFunction(() => window.shopPaintResult, null, { timeout: 10000 });
        const result = await page.evaluate(() => window.shopPaintResult);
        if (!result.passed) throw new Error(result.error);
        console.log(`Shop paints ${result.rows} rows, loads ${result.texturePaths.length} optional icons, and preserves ${result.hoverHandlers} hover handlers.`);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
