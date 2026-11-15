const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const webpack = require('webpack');
(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-volume-'));
    try {
        await new Promise((resolve, reject) => {
            const compiler = webpack({
                mode: 'development', target: 'node',
                entry: path.join(__dirname, 'retired-volume-zone-events.ts'),
                output: { path: directory, filename: 'test.cjs' },
                experiments: { asyncWebAssembly: true },
                plugins: [new webpack.DefinePlugin({ BITMAP_NAMEPLATES: 'false' })],
                resolve: { extensions: ['.ts', '.js'], alias: { '@l2js/core': path.resolve(__dirname, '../node_modules/@l2js/core/src'), '@l2js/engine': path.resolve(__dirname, '../src/assets/unreal') } },
                module: { rules: [{ test: /\.ts$/, exclude: file => /node_modules/.test(file) && !/[\\/]@l2js[\\/]core[\\/]/.test(file), use: {
                    loader: require.resolve('babel-loader'), options: { presets: [[require.resolve('@babel/preset-typescript'), { allowDeclareFields: true, allowNamespaces: true }]] }
                } }] }
            });
            compiler.run((error, stats) => compiler.close(() => {
                if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
                else resolve();
            }));
        });
        await require(path.join(directory, 'test.cjs'));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
