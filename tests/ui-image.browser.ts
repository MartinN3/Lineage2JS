import { initializeBrowserCapabilities } from '../src/browser';
import { NDomLayer } from '../src/nwindow/ndom';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
(window as any).runUiImageChecks = async (mode = 'normal') => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0, 17, 34, 51, 255]), 2, 2), 0, 0);
    const expected = context.getImageData(0, 0, 2, 2).data;
    const layer = () => ({
        atlas: new Map(),
        cacheTintUrls: new Map(),
        manager: { canvas: {
            loadTextures: async () => undefined,
            hasTexture: () => true,
            getTextureAnimation: () => ({ frames: [canvas], frameTime: 0 }),
            getTintedImage: () => canvas,
            getTextureKey: (path: string) => path
        } }
    });
    const tint = (owner: ReturnType<typeof layer>) => NDomLayer.prototype.getTintUrl.call(owner, 'test.texture', 0xff0000);
    assert(tint(layer()).startsWith('data:image/png'), 'Tint URL requests before initialization must use PNG');

    const OriginalImage = window.Image;
    const originalPixels = CanvasRenderingContext2D.prototype.getImageData;
    if (mode === 'load-error') (window as any).Image = function() {
        const image = new OriginalImage();
        Object.defineProperty(image, 'src', { set() { queueMicrotask(() => image.dispatchEvent(new Event('error'))); } });
        return image;
    };
    if (mode === 'wrong-pixels') CanvasRenderingContext2D.prototype.getImageData = function(_x, _y, w, h) { return new ImageData(w, h); };
    try {
        await initializeBrowserCapabilities();
        window.Image = OriginalImage;
        CanvasRenderingContext2D.prototype.getImageData = originalPixels;

        const atlasOwner = layer();
        await NDomLayer.prototype.loadTextures.call(atlasOwner, ['test.texture']);
        const atlas = atlasOwner.atlas.get('test.texture');
        const url = atlas.url, tintedOwner = layer(), tinted = tint(tintedOwner);
        assert(tint(tintedOwner) === tinted, 'Tint URLs must remain cached');
        assert(url.startsWith('blob:') === tinted.startsWith('blob:'), 'Atlas and tint paths must use the same capability result');
        if (mode !== 'normal') assert(url.startsWith('data:image/png'), 'Failed probes must keep the PNG fallback');
        for (const [label, source] of [['atlas', url], ['tint', tinted]]) {
            const image = new OriginalImage();
            image.src = source;
            await image.decode();
            const decoded = document.createElement('canvas');
            decoded.width = decoded.height = 2;
            const output = decoded.getContext('2d');
            if (label === 'atlas') output.drawImage(image, atlas.x, atlas.y, 2, 2, 0, 0, 2, 2);
            else output.drawImage(image, 0, 0);
            assert(output.getImageData(0, 0, 2, 2).data.every((value, index) => Math.abs(value - expected[index]) <= 1), `${label}: RGBA and alpha must survive decoding`);
            const block = document.createElement('div');
            block.style.cssText = 'width:100px;height:100px;display:inline-block;margin:10px;background-size:100px 100px;image-rendering:pixelated';
            block.style.backgroundImage = `url("${source}")`;
            if (label === 'atlas') {
                block.style.backgroundSize = `${atlas.atlasWidth * 50}px ${atlas.atlasHeight * 50}px`;
                block.style.backgroundPosition = `${-atlas.x * 50}px ${-atlas.y * 50}px`;
            }
            document.body.appendChild(block);
        }
        // The page owns its two preview URLs until it closes; keep them alive for CSS screenshot checks.
        return { format: url.startsWith('blob:') ? 'BMP' : 'PNG', mode };
    } finally {
        window.Image = OriginalImage;
        CanvasRenderingContext2D.prototype.getImageData = originalPixels;
    }
};
