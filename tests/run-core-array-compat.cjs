const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'core-array-compat-'));
    const baseline = process.argv.includes('--baseline');
    const webkit = process.argv.includes('--webkit');
    let browser;
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', target: webkit ? 'web' : 'node',
                entry: path.join(__dirname, 'core-array-compat.ts'),
                output: { path: directory, filename: 'test.js' },
                plugins: [new webpack.DefinePlugin({ APPLY_ARRAY_COMPAT: JSON.stringify(!baseline) })],
                resolve: { extensions: ['.ts', '.js'], fallback: { path: require.resolve('path-browserify') }, alias: { '@l2js/core': path.resolve(__dirname, '../node_modules/@l2js/core/src') } },
                module: { rules: [{ test: /\.ts$/, use: {
                    loader: require.resolve('babel-loader'), options: { presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true, allowNamespaces: true }]] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        let result;
        if (webkit) {
            const { webkit: engine } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
            browser = await engine.launch({ headless: true, executablePath: process.env.WEBKIT_EXECUTABLE || undefined });
            const page = await browser.newPage();
            await page.setContent('<body></body>');
            await page.addScriptTag({ path: path.join(directory, 'test.js') });
            result = await page.evaluate(() => globalThis.primitiveArrayResult);
        } else { require(path.join(directory, 'test.js')); result = globalThis.primitiveArrayResult; }
        if (!result.passed) throw new Error(result.error);
        console.log(`${webkit ? 'WebKit' : 'Node'}: ${result.message}`);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
