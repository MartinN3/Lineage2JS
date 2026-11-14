import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import NameplateDepth from "../src/rendering/nameplate-depth";

function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

async function checkContextRecovery(samples: number) {
    const renderer = new WebGLRenderer({ antialias: false });
    renderer.setSize(32, 32);
    document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const target = new WebGLRenderTarget(32, 32, { samples });
    const scene = new Scene(), camera = new PerspectiveCamera(60, 1, 0.1, 10);
    camera.position.z = 3;
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
    scene.add(new Mesh(geometry, material));
    const names = new Scene();
    const nameplate = Object.assign(new Mesh(), { isNameplate: true, setOpaqueDepth() {} });
    names.add(nameplate);
    const depth = new NameplateDepth(renderer);
    const transparent = new MeshBasicMaterial({ transparent: true, depthWrite: true });
    const extension = gl.getExtension("WEBGL_lose_context");
    assert(extension, "Context-loss extension must be available for this regression");

    const draw = () => {
        renderer.setRenderTarget(target);
        depth.begin(names);
        renderer.render(scene, camera);
        depth.finishWorld();
    };
    draw();
    const originalTexture = depth.getTexture();
    assert(originalTexture, "A normal frame must capture nameplate depth");
    depth.end();

    const lost = new Promise<void>(resolve => renderer.domElement.addEventListener("webglcontextlost", () => resolve(), { once: true }));
    extension.loseContext();
    await lost;
    assert(gl.isContextLost(), "The context must actually be lost");

    // This is the same ordering as the game's animation frame: the renderer
    // skips its draw, then finishWorld still runs. Neither capture path may throw.
    for (let frame = 0; frame < 3; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        draw();
        depth.beforeRender(transparent, new Mesh());
        assert(depth.getTexture() === null, "Lost-context frames must not expose stale depth");
        depth.end();
    }

    const restored = new Promise<void>(resolve => renderer.domElement.addEventListener("webglcontextrestored", () => resolve(), { once: true }));
    extension.restoreContext();
    await restored;
    draw();
    assert(depth.getTexture(), "Depth capture must resume after context restoration");
    assert(depth.getTexture() !== originalTexture, "Restoration must recreate the depth texture");
    assert(gl.getError() === gl.NO_ERROR, "Recovery must not leave a WebGL error");
    depth.end();

    renderer.setRenderTarget(null);
    depth.begin(names);
    let defaultFramebufferRejected = false;
    try { depth.finishWorld(); }
    catch (error) { defaultFramebufferRejected = (error as Error).message === "Nameplate depth requires an offscreen framebuffer"; }
    assert(defaultFramebufferRejected, "Unexpected default framebuffer use must still fail in a valid context");
    depth.end();
    depth.dispose();
    target.dispose();
    geometry.dispose();
    material.dispose();
    transparent.dispose();
    renderer.dispose();
    renderer.domElement.remove();
}

(async () => {
    await checkContextRecovery(0);
    await checkContextRecovery(4);
    (window as any).nameplateDepthResult = { passed: true };
})().catch(error => {
    (window as any).nameplateDepthResult = { passed: false, error: error.stack || String(error) };
});
