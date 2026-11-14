import { getCanvasImageUrl, prepareCanvasImageUrls } from '../src/nwindow/ui-image';
(window as any).getCanvasImageUrl = getCanvasImageUrl;

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
(window as any).runUiImageChecks = async (mode = 'normal') => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0, 17, 34, 51, 255]), 2, 2), 0, 0);
    const expected = context.getImageData(0, 0, 2, 2).data;
    const layer = () => ({ cacheTintUrls: new Map(), manager: { canvas: { getTintedImage: () => canvas, getTextureKey: (path: string) => path } } });
    const tint = (owner: any) => (window as any).actualTintUrl.call(owner, 'test.texture', 0xff0000);
    assert(getCanvasImageUrl(canvas).startsWith('data:image/png'), 'Before initialization synchronous URLs must use PNG');
    assert(tint(layer()).startsWith('data:image/png'), 'Tint URL requests before initialization must use PNG');

    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    const created: string[] = [], revoked: string[] = [];
    URL.createObjectURL = blob => { const url = originalCreate.call(URL, blob); created.push(url); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); originalRevoke.call(URL, url); };
    const OriginalImage = window.Image;
    const originalPixels = CanvasRenderingContext2D.prototype.getImageData;
    if (mode === 'timeout') (window as any).Image = function() {
        const image = new OriginalImage();
        Object.defineProperty(image, 'src', { get: () => '', set() {} });
        return image;
    };
    if (mode === 'wrong-pixels') CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) { return new ImageData(w, h); };
    try {
        const first = prepareCanvasImageUrls(), second = prepareCanvasImageUrls();
        assert(first === second, 'Concurrent initialization must share a single probe');
        await first;
        window.Image = OriginalImage;
        CanvasRenderingContext2D.prototype.getImageData = originalPixels;
        assert(prepareCanvasImageUrls() === first, 'Completed initialization must stay cached');
        assert(created.length === 1 && revoked.length === 1 && created[0] === revoked[0], 'The sole probe URL must be revoked on completion or timeout');
        const url = getCanvasImageUrl(canvas), tintedOwner = layer(), tinted = tint(tintedOwner);
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
            output.drawImage(image, 0, 0);
            assert(output.getImageData(0, 0, 2, 2).data.every((value, index) => Math.abs(value - expected[index]) <= 1), `${label}: RGBA and alpha must survive decoding`);
            const block = document.createElement('div');
            block.style.cssText = 'width:100px;height:100px;display:inline-block;margin:10px;background-size:100px 100px;image-rendering:pixelated';
            block.style.backgroundImage = `url("${source}")`;
            document.body.appendChild(block);
        }
        // The page owns its two preview URLs until it closes; keep them alive for CSS screenshot checks.
        return { format: url.startsWith('blob:') ? 'BMP' : 'PNG', mode };
    } finally {
        window.Image = OriginalImage;
        CanvasRenderingContext2D.prototype.getImageData = originalPixels;
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }
};
