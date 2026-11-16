const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webpack = require("webpack");

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abnormal-status-"));
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: "development",
                target: "node",
                entry: path.join(__dirname, "abnormal-status.ts"),
                output: { path: directory, filename: "test.js" },
                resolve: { extensions: [".ts", ".js"] },
                module: { rules: [{ test: /\.ts$/, use: {
                    loader: require.resolve("babel-loader"),
                    options: { presets: [[require.resolve("@babel/preset-typescript"), { allowDeclareFields: true }]] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        require(path.join(directory, "test.js"));
        const result = globalThis.abnormalStatusResult;
        if (!result.passed) throw new Error(result.error);
        console.log(result.message);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
