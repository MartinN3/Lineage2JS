import { NCTargetStatusWnd } from "../src/nwindow/nc-target-status-wnd";

const textureOf = (element: HTMLElement) => element.dataset.texture;

class FakeLayer {
    public manager = {
        canvas: {
            cssScale: 1,
            width: 500,
            height: 400,
            measureText: (text: string) => text.length * 7,
            getLineHeight: () => 16,
            wrapText: (text: string) => text.split("\n"),
            toUI: (value: number) => value
        },
        strings: {
            npcPassiveSkills: { 100: [200, 201, 202], 101: [200, 201, 202] },
            skillInfos: {
                "200:1": { icon: "skill-icon", name: "Raid Boss", description: "Raid Boss tooltip" },
                "201:1": { icon: "missing-icon", name: "Hidden Skill", description: "Not loaded yet" },
                "202:1": { icon: "skill-icon-2", name: "Other Skill", description: "Other tooltip" }
            }
        }
    };

    public getManager() { return this.manager; }
    public hasTexture(texture: string) { return texture !== "missing-icon"; }
    public async loadTextures() { return; }
    public measureText(text: string) { return this.manager.canvas.measureText(text); }
    public renderText(element: HTMLElement, text: string) { element.textContent = text; }
    public createWindow(x: number, y: number, width: number, height: number, parent: HTMLElement = document.body) {
        const element = document.createElement("div");
        this.place(element, x, y, width, height);
        parent.append(element);
        return element;
    }
    public place(element: HTMLElement, x: number, y: number, width?: number, height?: number) {
        element.style.position = "absolute";
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        if (width !== undefined) element.style.width = `${width}px`;
        if (height !== undefined) element.style.height = `${height}px`;
    }
    public tile(parent: HTMLElement, x: number, y: number, width: number, height: number, _sx: number, _sy: number, _sw: number, _sh: number, texture: string) {
        const element = this.createWindow(x, y, width, height, parent);
        element.dataset.texture = texture;
        return element;
    }
    public placeTile(element: HTMLElement, _x: number, _y: number, width: number, height: number, _sx: number, _sy: number, _sw: number, _sh: number, texture: string) {
        this.place(element, _x, _y, width, height);
        element.dataset.texture = texture;
    }
    public text(parent: HTMLElement, text: string, _color: number, _font: unknown, x: number, y: number) {
        const element = this.createWindow(x, y, 0, 0, parent);
        element.textContent = text;
        return element;
    }
    public button(parent: HTMLElement, x: number, y: number, width: number, height: number, normal: string, _down: string, _over: string, _label: string, onPress: () => void) {
        const element = this.createWindow(x, y, width, height, parent) as HTMLDivElement & { setTextures: (...textures: string[]) => void };
        element.classList.add("ndom-button");
        element.dataset.texture = normal;
        element.setTextures = (...textures: string[]) => { element.dataset.texture = textures[0]; };
        element.addEventListener("click", onPress);
        return element;
    }
}

const layer = new FakeLayer();
const wnd = new NCTargetStatusWnd(layer as never);
const target = (npcId: number, curHp = 90) => ({ npcId, name: "Greyclaw Kutus", curHp, maxHp: 100, curMp: 0, maxMp: 0, showHp: true, showMp: false, levelDifference: 0 });
const infoButton = () => [...wnd.element.querySelectorAll<HTMLElement>(".ndom-button")].find(element => element.dataset.texture.includes("Target_InfoButton"));
const skillIcon = () => wnd.element.querySelector<HTMLElement>("[data-texture='skill-icon']");
const tooltipCount = () => wnd.element.querySelectorAll("[role='tooltip']").length;

(window as unknown as { targetTooltipHarness?: unknown }).targetTooltipHarness = {
    async setup() {
        wnd.setTarget(target(100));
        await new Promise(resolve => setTimeout(resolve, 0));
        infoButton().click();
    },
    updateHp() { wnd.setTarget(target(100, 80)); },
    changeTarget() { wnd.setTarget(target(101)); },
    addUnavailableSkillBeforeVisibleIcons() {
        layer.manager.strings.npcPassiveSkills[100] = [201, 200, 202];
        wnd.setTarget(target(100, 85));
        return wnd.element.querySelector<HTMLElement>("[data-texture='skill-icon']").style.left;
    },
    clearTarget() { wnd.setTarget(null); },
    collapse() { infoButton().click(); },
    expand() { infoButton().click(); },
    hide() { wnd.setVisible(false); },
    show() { wnd.setVisible(true); },
    measureHpUpdates(iterations: number) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) wnd.setTarget(target(100, 50 + i % 50));
        return performance.now() - start;
    },
    tooltipCount,
    firstIconLeft: () => skillIcon().style.left,
    hasSkillIcon: () => !!skillIcon()
};
