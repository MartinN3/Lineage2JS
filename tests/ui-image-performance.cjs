const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ts = require(process.env.TYPESCRIPT_MODULE || 'typescript');
const baselineRevision = process.env.BASELINE_REVISION || '395753475f5d7badea32bd6bc0dd78609f9ff293';
const currentRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineFile = execFileSync('git', ['show', `${baselineRevision}:src/nwindow/ndom.ts`], { encoding: 'utf8' });
const baselineFunction = baselineFile.match(/function encodeBitmap\(canvas: HTMLCanvasElement\): Blob \{[\s\S]*?\n\}/);
if (!baselineFunction) throw new Error(`Could not extract baseline encoder from ${baselineRevision}`);

function transpile(source) {
    return ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None });
}

const baselineScript = transpile(baselineFunction[0].replace('function encodeBitmap(', 'window.__encodeBitmap = function encodeBitmap('));
const candidateSource = fs.readFileSync(path.join(__dirname, '../src/nwindow/ui-image.ts'), 'utf8')
    .replace('export function getCanvasImageUrl(', 'window.__getCanvasImageUrl = function getCanvasImageUrl(')
    .replace('export function prepareCanvasImageUrls(', 'window.__prepareCanvasImageUrls = function prepareCanvasImageUrls(')
    .replace('function encodeBitmap(', 'window.__encodeBitmap = function encodeBitmap(');
const candidateScript = transpile(candidateSource);

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function summarize(samples) {
    const values = samples.map(sample => sample.ms);
    return { n: values.length, medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), meanMs: values.reduce((sum, value) => sum + value, 0) / values.length };
}

function sourceBytes(url) {
    if (url.startsWith('blob:')) return null;
    const comma = url.indexOf(',');
    const base64 = url.slice(comma + 1);
    return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

async function main() {
    const browser = await playwright.chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL || 'chrome' });
    const results = {
        metadata: {
            runnerOS: process.env.GITHUB_RUNNER_OS || os.platform(),
            platform: process.platform,
            arch: process.arch,
            browser: `Chrome ${browser.version()}`,
            baselineRevision,
            candidateRevision: currentRevision,
            workload: 'synthetic transparent UI sprites and 256px-wide atlas pages; 2D canvas encoding, image decode, CSS background paint; no game assets and no WebGL',
            iterations: 16,
            warmups: 3,
        },
        coldStarts: [],
        cases: [],
    };

    try {
        for (let i = 0; i < 10; i++) {
            const page = await browser.newPage();
            await page.setContent('<!doctype html><body></body>');
            await page.addScriptTag({ content: candidateScript });
            results.coldStarts.push(await page.evaluate(async () => {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 2;
                const context = canvas.getContext('2d');
                context.fillStyle = 'rgba(20,40,60,.5)';
                context.fillRect(0, 0, 2, 2);
                const firstAt = performance.now();
                const firstUrl = window.__getCanvasImageUrl(canvas);
                const firstMs = performance.now() - firstAt;
                const firstFormat = firstUrl.startsWith('blob:') ? 'BMP' : 'PNG';
                if (firstUrl.startsWith('blob:')) URL.revokeObjectURL(firstUrl);
                const probeAt = performance.now();
                await window.__prepareCanvasImageUrls();
                const probeMs = performance.now() - probeAt;
                const afterUrl = window.__getCanvasImageUrl(canvas);
                const afterFormat = afterUrl.startsWith('blob:') ? 'BMP' : 'PNG';
                if (afterUrl.startsWith('blob:')) URL.revokeObjectURL(afterUrl);
                return { firstFormat, firstCallMs: firstMs, probeMs, afterFormat };
            }));
            await page.close();
        }

        for (const workload of [
            { name: 'tinted-icon-32x32', width: 32, height: 32, cssElements: 24 },
            { name: 'atlas-page-256x256', width: 256, height: 256, cssElements: 48 },
            { name: 'atlas-page-256x512', width: 256, height: 512, cssElements: 48 },
        ]) {
            const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
            await page.setContent('<!doctype html><style>body{margin:0}.sprites{display:grid;grid-template-columns:repeat(8,32px);gap:1px}.sprite{width:32px;height:32px;background-repeat:no-repeat;image-rendering:pixelated}</style><body></body>');
            await page.addScriptTag({ content: baselineScript });
            await page.addScriptTag({ content: candidateScript });
            await page.evaluate(() => {
                const original = URL.createObjectURL.bind(URL);
                const sizes = new Map();
                URL.createObjectURL = blob => {
                    const url = original(blob);
                    sizes.set(url, blob.size);
                    return url;
                };
                window.__objectUrlSizes = sizes;
            });
            await page.evaluate(async () => window.__prepareCanvasImageUrls());
            const data = await page.evaluate(async ({ workload, iterations }) => {
                function canvasFor(index) {
                    const canvas = document.createElement('canvas');
                    canvas.width = workload.width;
                    canvas.height = workload.height;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    const tile = 32;
                    for (let y = 0; y < canvas.height; y += tile) {
                        for (let x = 0; x < canvas.width; x += tile) {
                            const id = (x / tile + y / tile * 3 + index) % 7;
                            ctx.fillStyle = `rgba(${40 + id * 27},${70 + id * 19},${210 - id * 17},${id % 3 === 0 ? .55 : 1})`;
                            ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
                        }
                    }
                    return canvas;
                }
                async function decodeAndDraw(url, width, height) {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    const output = document.createElement('canvas');
                    output.width = width;
                    output.height = height;
                    const ctx = output.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(image, 0, 0);
                    return Array.from(ctx.getImageData(2, 2, 1, 1).data);
                }
                async function cssPaint(url) {
                    const container = document.createElement('div');
                    container.className = 'sprites';
                    for (let i = 0; i < workload.cssElements; i++) {
                        const item = document.createElement('div');
                        item.className = 'sprite';
                        item.style.backgroundImage = `url("${url}")`;
                        item.style.backgroundSize = `${workload.width}px ${workload.height}px`;
                        item.style.backgroundPosition = `${-(i % Math.max(1, workload.width / 32)) * 32}px ${-Math.floor(i / Math.max(1, workload.width / 32)) * 32}px`;
                        container.appendChild(item);
                    }
                    const started = performance.now();
                    document.body.appendChild(container);
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    const elapsed = performance.now() - started;
                    container.remove();
                    return elapsed;
                }
                async function runOne(mode, index) {
                    const canvas = canvasFor(index);
                    const started = performance.now();
                    const url = mode === 'baseline'
                        ? URL.createObjectURL(window.__encodeBitmap(canvas))
                        : window.__getCanvasImageUrl(canvas);
                    const encodeMs = performance.now() - started;
                    const bytes = url.startsWith('blob:')
                        ? window.__objectUrlSizes.get(url)
                        : Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4);
                    const expectedPixel = Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data);
                    const drawStarted = performance.now();
                    const pixel = await decodeAndDraw(url, workload.width, workload.height);
                    const decodeDrawMs = performance.now() - drawStarted;
                    const cssMs = await cssPaint(url);
                    URL.revokeObjectURL(url);
                    return { encodeMs, decodeDrawMs, cssMs, bytes, pixel, expectedPixel };
                }
                const observations = { baseline: [], candidate: [] };
                for (let i = 0; i < iterations + 3; i++) {
                    const order = i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
                    for (const mode of order) {
                        const sample = await runOne(mode, i);
                        if (sample.pixel.join(',') !== sample.expectedPixel.join(',')) throw new Error(`${mode} decoded RGBA differs: ${sample.pixel} != ${sample.expectedPixel}`);
                        if (!Number.isFinite(sample.encodeMs + sample.decodeDrawMs + sample.cssMs)) throw new Error(`Invalid ${mode} timing`);
                        if (i >= 3) observations[mode].push(sample);
                    }
                }
                return observations;
            }, { workload, iterations: results.metadata.iterations });
            const summaries = {};
            for (const mode of ['baseline', 'candidate']) {
                summaries[mode] = {};
                for (const metric of ['encodeMs', 'decodeDrawMs', 'cssMs', 'bytes']) {
                    const values = data[mode].map(sample => ({ ms: metric === 'bytes' ? sample[metric] : sample[metric] }));
                    summaries[mode][metric] = metric === 'bytes'
                        ? { medianBytes: percentile(values.map(value => value.ms), .5), p95Bytes: percentile(values.map(value => value.ms), .95) }
                        : summarize(values);
                }
            }
            results.cases.push({ workload, summaries });
            await page.close();
        }
    } finally {
        await browser.close();
    }
    const outputPath = process.env.OUTPUT_JSON || path.join(process.cwd(), 'ui-image-benchmark.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify(results, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
