const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'party-roster-'));
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development',
                target: 'node',
                entry: path.join(__dirname, 'party-roster.ts'),
                output: { path: directory, filename: 'test.cjs' },
                plugins: [new webpack.DefinePlugin({ BITMAP_NAMEPLATES: 'false' })],
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
        require(path.join(directory, 'test.cjs'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
