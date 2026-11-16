import NCAbnormalStatusWnd from "../src/nwindow/nc-abnormal-status-wnd";
import type { AbnormalStatus_T } from "../src/network/game-packets";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function runAbnormalStatusRenderingChecks() {
    const skillInfos: Record<string, any> = {};
    const iconFor = (effect: AbnormalStatus_T) => `test.icon.${effect.id}.${effect.level}`;
    const effects = Array.from({ length: 20 }, (_, index) => ({ id: 4000 + index, level: 1, duration: 300 }));
    effects.push({ id: 256, level: 1, duration: 2147483647 }, { id: 312, level: 1, duration: 2147483647 });
    effects.forEach((effect, index) => {
        skillInfos[`${effect.id}:${effect.level}`] = { name: index === 20 ? "Accuracy" : index === 21 ? "Vicious Stance" : `Buff ${index}`, isToggle: index >= 20, isDebuff: false, icon: iconFor(effect) };
    });
    const root = document.createElement("div");
    root.style.cssText = "position:relative;width:400px;height:120px";
    document.body.append(root);
    const manager = { strings: { skillInfos, sysStrings: {} }, canvas: { width: 400, height: 120, cssScale: 1, measureText: (text: string) => text.length * 7, getLineHeight: () => 14, wrapText: () => [] } };
    const layer: any = {
        getManager: () => manager,
        toUI: (value: number) => value,
        loadTextures: async () => {},
        hasTexture: () => true,
        createWindow(x: number, y: number, width: number, height: number, parent: HTMLElement = root) {
            const element = document.createElement("div");
            element.style.position = "absolute";
            parent.append(element);
            this.place(element, x, y, width, height);
            return element;
        },
        tile(parent: HTMLElement, x: number, y: number, width: number, height: number, _u: number, _v: number, _uw: number, _vh: number, texture: string) {
            const element = this.createWindow(x, y, width, height, parent);
            element.dataset.texture = texture;
            return element;
        },
        digits(parent: HTMLElement) { return this.createWindow(0, 0, 0, 0, parent); },
        place(element: HTMLElement, x: number, y: number, width?: number, height?: number) {
            element.style.left = `${x}px`;
            element.style.top = `${y}px`;
            if (width !== null && width !== undefined) element.style.width = `${width}px`;
            if (height !== null && height !== undefined) element.style.height = `${height}px`;
        },
        placeTile(element: HTMLElement, x: number, y: number, width: number, height: number, _u: number, _v: number, _uw: number, _vh: number, texture: string) {
            this.place(element, x, y, width, height);
            element.dataset.texture = texture;
        },
        setTile(element: HTMLElement, _width: number, _height: number, _u: number, _v: number, _uw: number, _vh: number, texture: string) { element.dataset.texture = texture; },
        setAlpha() {},
        renderDigits() {},
        text(parent: HTMLElement, value: string, _color: number, _font: unknown, x: number, y: number) {
            const element = this.createWindow(x, y, 0, 14, parent);
            element.textContent = value;
            return element;
        },
        dragWindow() {}
    };
    const window = new NCAbnormalStatusWnd(layer);
    root.append(window.element);
    window.setEffects(effects);
    await Promise.resolve();

    const icons = Array.from(window.element.querySelectorAll<HTMLElement>("[data-texture^='test.icon.']"));
    assert(icons.length === 22, `expected 22 rendered status icons, found ${icons.length}`);
    const firstToggle = icons[20], secondToggle = icons[21];
    assert(firstToggle.style.left === "13px" && secondToggle.style.left === "39px", "the two toggles must render in separate third-row columns");
    assert(firstToggle.style.top === "51px" && secondToggle.style.top === "51px", "both toggles must render in the third row");
    assert(window.element.style.width === "272px" && window.element.style.height === "76px", "the status widget must grow to contain all three rows");
    const rect = window.element.getBoundingClientRect();
    assert(firstToggle.offsetTop + firstToggle.offsetHeight <= rect.height && secondToggle.offsetLeft + secondToggle.offsetWidth <= rect.width, "third-row toggle elements must remain within the rendered widget");
    const toggleStates = window.getEffects().slice(20);
    assert(toggleStates.every(effect => effect.duration === 2147483647 && effect.tooltipTime === -1), "toggle sentinel durations must remain indefinite and omit tooltip countdowns");
    (window as any).setHoveredSlot(20);
    const tooltip = window.element.querySelector<HTMLElement>("[role=tooltip]");
    assert(tooltip?.getAttribute("aria-label")?.includes("Accuracy") && !tooltip.getAttribute("aria-label").includes("Remaining"), "Accuracy tooltip must omit the misleading sentinel duration");
    window.tick(0.11);
    assert(window.getEffects().slice(20).every(effect => effect.duration === 2147483647), "timer updates must not decrement active toggle sentinels");

    const finiteToggle: AbnormalStatus_T = { id: 256, level: 2, duration: 15 };
    skillInfos["256:2"] = { name: "Finite Accuracy", isToggle: true, isDebuff: false, icon: iconFor(finiteToggle) };
    window.setEffects([...effects, finiteToggle]);
    await Promise.resolve();
    assert(window.getEffects()[22].duration === 15 && window.getEffects()[22].tooltipTime === 15, "finite toggle durations must retain their countdown");
    window.tick(1.1);
    assert(window.getEffects()[22].duration === 14 && window.getEffects()[22].tooltipTime === 14, "finite toggle durations must continue counting down");

    const cappedEffects: AbnormalStatus_T[] = Array.from({ length: 31 }, (_, index) => ({ id: 6000 + index, level: 1, duration: 300 }));
    cappedEffects.forEach(effect => { skillInfos[`${effect.id}:${effect.level}`] = { isToggle: false, isDebuff: false, icon: iconFor(effect) }; });
    window.setEffects(cappedEffects);
    await Promise.resolve();
    assert(window.getEffects().length === 31 && window.element.querySelectorAll("[data-texture^='test.icon.']").length === 30, "the component must preserve all statuses while rendering only its established 30-icon cap");

    root.remove();
    return { icons: icons.length };
}

try { (globalThis as any).abnormalStatusRenderResult = { passed: true, result: await runAbnormalStatusRenderingChecks() }; }
catch (error) { (globalThis as any).abnormalStatusRenderResult = { passed: false, error: `${(error as Error).name}: ${(error as Error).message}\n${(error as Error).stack || ""}` }; }
