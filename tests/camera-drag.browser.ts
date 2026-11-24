import { PerspectiveCamera } from "three";
import { ZUpOrbitControls } from "../src/rendering/camera/controllers/zup-orbit-controls";

const canvas = document.querySelector("canvas");
const overlay = document.querySelector("#overlay");
const camera = new PerspectiveCamera();

camera.up.set(0, 0, 1);
camera.position.set(250, 0, 100);

const controls = new ZUpOrbitControls(camera, canvas);
const inputs = [];
let pointerId = -1;

controls.setNativeLikeControls(true);
controls.onCameraInput = (action, yaw, pitch) => inputs.push([action, yaw, pitch]);
canvas.addEventListener("pointerdown", event => { pointerId = event.pointerId; });

for (const type of ["pointermove", "pointerup", "pointercancel", "contextmenu"])
    overlay.addEventListener(type, event => {
        if (type === "contextmenu") event.preventDefault();
        event.stopPropagation();
    });

Object.assign(window, {
    cameraDrag: {
        inputs,
        yaw: () => controls.getAzimuthalAngle(),
        releaseCapture: () => canvas.releasePointerCapture(pointerId),
        cancel: () => overlay.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }))
    }
});
