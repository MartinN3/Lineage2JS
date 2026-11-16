const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const webpack = require("webpack");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abnormal-status-browser-"));
    let browser, server;
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: "development",
                target: "web",
                entry: path.join(__dirname, "abnormal-status.browser.ts"),
                output: { path: directory, filename: "test.js", publicPath: "" },
                plugins: [new webpack.DefinePlugin({ BITMAP_NAMEPLATES: "false" })],
                resolve: { extensions: [".ts", ".js"] },
                module: { rules: [{ test: /zip-module\.wasm$/, type: "asset/inline" }, { test: /\.ts$/, exclude: /node_modules/, use: {
                    loader: require.resolve("babel-loader"),
                    options: { presets: [[require.resolve("@babel/preset-typescript"), { allowDeclareFields: true }]] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        server = http.createServer((request, response) => {
            if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end("<body></body>"); return; }
            const filename = path.resolve(directory, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
            if (!filename.startsWith(`${directory}${path.sep}`)) { response.writeHead(403).end(); return; }
            fs.readFile(filename, (error, data) => {
                if (error) { response.writeHead(404).end(); return; }
                response.setHeader("Content-Type", filename.endsWith(".wasm") ? "application/wasm" : "application/javascript");
                response.end(data);
            });
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined, args: ["--disable-gpu"] });
        const page = await browser.newPage({ viewport: { width: 480, height: 200 } });
        page.on("pageerror", error => console.error(`Browser error: ${error.stack || error}`));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.setContent("<body></body>");
        await page.addScriptTag({ path: path.join(directory, "test.js") });
        const result = await page.evaluate(() => globalThis.abnormalStatusRenderResult);
        if (!result.passed) throw new Error(result.error);
        console.log(`Abnormal status browser checks passed; rendered ${result.result.icons} icons in the 20-buff + 2-toggle case.`);
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
