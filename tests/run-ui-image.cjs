const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const ndomSource = fs.readFileSync(path.join(__dirname, '../src/nwindow/ndom.ts'), 'utf8');
const ndomAst = parser.parse(ndomSource, { sourceType: 'module', plugins: ['typescript'] });
const declaration = ndomAst.program.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === 'NDomLayer').declaration;
const tintMethod = declaration.body.body.find(node => node.key?.name === 'getTintUrl');
const tintFixture = babel.transformSync(`class TintFixture { ${ndomSource.slice(tintMethod.start, tintMethod.end)} }`, { filename: 'tint-fixture.ts', configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-typescript')] }).code + '\nwindow.actualTintUrl = TintFixture.prototype.getTintUrl;';
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-image-'));
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', entry: path.join(__dirname, 'ui-image.browser.ts'),
                output: { path: directory, filename: 'test.js', publicPath: '' },
                plugins: [new webpack.DefinePlugin({ BITMAP_NAMEPLATES: 'false' })],
                resolve: { extensions: ['.ts', '.js'] },
                module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: {
                    loader: require.resolve('babel-loader'), options: { presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true }]] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        for (const [name, engine, options] of [
            ['WebKit', webkit, {}],
            ['Chromium', chromium, { executablePath: process.env.CHROME_EXECUTABLE || undefined, args: ['--disable-gpu'] }]
        ]) {
            const browser = await engine.launch({ headless: true, ...options });
            try {
                for (const mode of ['normal', 'timeout', 'wrong-pixels']) {
                    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
                    page.on('pageerror', error => console.error(error));
                    await page.setContent('<body style="background:#ddd"></body>');
                    await page.addScriptTag({ path: path.join(directory, 'test.js') });
                    await page.addScriptTag({ content: tintFixture });
                    const result = await page.evaluate(mode => window.runUiImageChecks(mode), mode);
                    const wanted = mode === 'normal' && name === 'Chromium' ? 'BMP' : 'PNG';
                    if (result.format !== wanted) throw new Error(`${name} ${mode}: expected ${wanted}, got ${result.format}`);
                    if (mode === 'normal') {
                        for (const block of await page.locator('div').all()) {
                            const png = await block.screenshot();
                            await page.evaluate(async data => {
                                const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
                                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
                                const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
                                for (const [x, y, expected] of [[25,25,[255,0,0]], [75,25,[110,238,110]], [25,75,[221,221,221]], [75,75,[17,34,51]]]) {
                                    const actual = context.getImageData(x, y, 1, 1).data;
                                    if (!expected.every((value, index) => Math.abs(value - actual[index]) <= 1)) throw new Error(`CSS background pixels differ: ${actual}`);
                                }
                            }, png.toString('base64'));
                        }
                    }
                    console.log(`${name} ${mode}: ${result.format} pixels/alpha/tint/caching passed`);
                    await page.close();
                }
            } finally { await browser.close(); }
        }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
