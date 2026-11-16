const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'target-tooltip-'));
    let browser;
    try {
        const canvasStub = path.join(directory, 'nwindow-canvas.js');
        fs.writeFileSync(canvasStub, 'export const FontType_T = { SMALL: 0 };');
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', entry: path.join(__dirname, 'target-tooltip.browser.ts'),
                output: { path: directory, filename: 'test.js', publicPath: '' }, resolve: {
                    extensions: ['.ts', '.js'],
                    alias: { [path.resolve(__dirname, '../src/nwindow/nwindow-canvas.ts')]: canvasStub }
                },
                module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-typescript')] } } }] }
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
        await page.waitForFunction(() => window.targetTooltipHarness, null, { timeout: 10000 });
        const evaluate = expression => page.evaluate(expression);
        const assertCount = async (expected, message) => {
            const count = await page.evaluate(() => window.targetTooltipHarness.tooltipCount());
            if (count !== expected) throw new Error(`${message}: expected ${expected} tooltip(s), got ${count}.`);
        };
        await page.evaluate(() => window.targetTooltipHarness.setup());
        const icon = page.locator("[data-texture='skill-icon']");
        const initialIconLeft = await page.evaluate(() => window.targetTooltipHarness.firstIconLeft());
        if (initialIconLeft !== '18px') throw new Error(`Expected first skill icon at 18px before unavailable skill insertion, got ${initialIconLeft}.`);
        const updatedIconLeft = await page.evaluate(() => window.targetTooltipHarness.addUnavailableSkillBeforeVisibleIcons());
        if (updatedIconLeft !== '36px') throw new Error(`Skill layout should rebuild when an unavailable passive skill shifts icon indexes, got ${updatedIconLeft}.`);

        await icon.hover();
        await assertCount(1, 'Hover should create one tooltip');

        await evaluate(() => window.targetTooltipHarness.updateHp());
        await assertCount(1, 'Stationary pointer tooltip should survive HP refresh');
        if (!(await icon.count())) throw new Error('HP refresh should preserve the existing skill icon node.');

        await page.mouse.move(300, 200);
        await assertCount(0, 'Pointer leave should remove tooltip');
        await icon.hover();
        await assertCount(1, 'Rehover should show exactly one tooltip');
        await evaluate(() => window.targetTooltipHarness.collapse());
        await assertCount(0, 'Collapse should remove tooltip');
        await evaluate(() => window.targetTooltipHarness.expand());
        await icon.hover();
        await assertCount(1, 'Expanded target should show tooltip');
        await evaluate(() => window.targetTooltipHarness.hide());
        await assertCount(0, 'Direct window hide should remove tooltip');

        await evaluate(() => window.targetTooltipHarness.show());
        await page.mouse.move(300, 200);
        await icon.hover();
        await assertCount(1, 'Showing and hovering target should create tooltip');
        await evaluate(() => window.targetTooltipHarness.changeTarget());
        await assertCount(0, 'Target change should remove old tooltip');
        await evaluate(() => window.targetTooltipHarness.clearTarget());
        await assertCount(0, 'Target clear should remove tooltip');
        console.log('Target tooltip lifecycle passed 7 browser scenarios, including stationary pointer across HP refresh and native pointer leave.');
    } finally {
        if (browser) await browser.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
