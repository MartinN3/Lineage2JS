import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from "three";
import NameplateDepth from "../src/rendering/nameplate-depth";
import OverHeadAlarm from "../src/rendering/over-head-alarm";

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

async function checkQuestAlarm(samples: number) {
    const renderer = new WebGLRenderer({ antialias: false });
    renderer.setSize(32, 32);
    document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const target = new WebGLRenderTarget(32, 32, { samples });
    const world = new Scene(), names = new Scene(), camera = new PerspectiveCamera(60, 1, 0.1, 10);
    camera.position.z = 3;
    const geometry = new BoxGeometry();
    const material = new ShaderMaterial({
        vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }'
    });
    const mesh = Object.assign(new Mesh(geometry, material), { meshOrigin: new Vector3(), updateActorLighting() {} });
    const alarm = new OverHeadAlarm(), depth = new NameplateDepth(renderer);
    alarm.setSize(32, 32);
    alarm.setMesh(mesh as any);
    const addMarker = () => alarm.add(16, 16, 100, new Vector3(0.5, 0.5, 0.5));
    const draw = () => {
        renderer.setRenderTarget(alarm.needsWorldDepth() ? target : null);
        depth.begin(names, alarm.needsWorldDepth());
        renderer.clear();
        renderer.render(world, camera);
        depth.finishWorld();
        alarm.draw(renderer, depth.getTexture(), false);
    };

    addMarker();
    assert(names.children.length === 0 && alarm.needsWorldDepth(), "An alarm must request world depth independently of nameplates");
    draw();
    assert(depth.getTexture(), "Alarm-only frames must capture world depth");
    // Read the rendered marker, proving that the capture is usable by its shader.
    const pixels = new Uint8Array(32 * 32 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
    assert(pixels.some((value, index) => index % 4 === 0 && value === 255 && pixels[index + 1] === 0), "Quest alarm must render against captured world depth");
    depth.end();

    // Teleport/loading clears GUI markers; a later frame repopulates them.
    alarm.clear();
    assert(!alarm.needsWorldDepth(), "Cleared alarms must release their depth requirement");
    draw();
    assert(depth.getTexture() === null, "An empty transition frame must not expose stale depth");
    depth.end();
    addMarker();
    draw();
    assert(depth.getTexture(), "Repopulated alarms must resume depth capture");
    depth.end();

    const extension = gl.getExtension("WEBGL_lose_context");
    assert(extension, "Context-loss extension must be available for this regression");
    const lost = new Promise<void>(resolve => renderer.domElement.addEventListener("webglcontextlost", () => resolve(), { once: true }));
    extension.loseContext();
    await lost;
    for (let frame = 0; frame < 3; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        draw();
        assert(depth.getTexture() === null, "Lost-context alarms must not use invalid depth");
        depth.end();
    }
    const restored = new Promise<void>(resolve => renderer.domElement.addEventListener("webglcontextrestored", () => resolve(), { once: true }));
    extension.restoreContext();
    await restored;
    draw();
    assert(depth.getTexture(), "Quest alarm capture and drawing must resume after restoration");
    assert(gl.getError() === gl.NO_ERROR, "Quest alarm recovery must not leave a WebGL error");
    depth.end();

    let missingDepthRejected = false;
    try { alarm.draw(renderer, null, false); }
    catch (error) { missingDepthRejected = (error as Error).message === "Quest alarm requires world depth."; }
    assert(missingDepthRejected, "A valid-context missing depth dependency must still fail");
    depth.dispose();
    target.dispose();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
}

(async () => {
    await checkContextRecovery(0);
    await checkContextRecovery(4);
    await checkQuestAlarm(0);
    await checkQuestAlarm(4);
    (window as any).nameplateDepthResult = { passed: true };
})().catch(error => {
    (window as any).nameplateDepthResult = { passed: false, error: error.stack || String(error) };
});
