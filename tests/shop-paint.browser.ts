import { NCShopWnd } from "../src/nwindow/nc-shop-wnd";

declare global { interface Window { shopPaintResult?: any } }

async function run() {
    const baselinePaths: string[] = [];
    const baselineShop: any = Object.create(NCShopWnd.prototype);
    Object.assign(baselineShop, {
        layer: {
            getManager: () => ({ strings: { itemIcons: ["", "icon.sword", "", "icon.axe", undefined], itemNames: [] } }),
            loadTextures: async (paths: string[]) => { baselinePaths.push(...paths); if (paths.some(path => !path)) throw new Error("empty texture path"); }
        },
        items: [[{ itemId: 1, count: 0 }, { itemId: 2, count: 0 }, { itemId: 3, count: 0 }, { itemId: 4, count: 0 }], []],
        generation: 0,
        lists: [0, 1].map(() => { const content = document.createElement("div"); return { content, getScroll: () => 0, setScroll: () => {}, setContentHeight: () => {} }; }),
        selected: [null, null], hoveredSide: -1, hoveredIndex: -1, isSell: false, isPreview: false, isStore: false, onTooltip: null, onHideTooltip: null,
        getIconPaths: (items: any[][], icons: string[]) => [...new Set(items.flat().map(item => icons[item.itemId]))]
    });
    let baselineFailedOnEmptyPath = false;
    try { await baselineShop.paintItems(); } catch (error) { baselineFailedOnEmptyPath = String(error).includes("empty texture path"); }
    if (!baselineFailedOnEmptyPath || !baselinePaths.includes("")) throw new Error("Baseline did not reproduce the empty texture path failure.");

    const texturePaths: string[] = [], tiledPaths: string[] = [];
    let hoverHandlers = 0;
    const strings: any = { itemIcons: ["", "icon.sword", "", "icon.axe", undefined], itemNames: ["", "Sword", "Fists", "Axe", "Unknown"] };
    const layer: any = {
        getManager: () => ({ strings }),
        loadTextures: async (paths: string[]) => { texturePaths.push(...paths); if (paths.some(path => !path)) throw new Error("empty texture path"); },
        place: () => {},
        tile: (_button: HTMLElement, ...args: any[]) => { tiledPaths.push(args[args.length - 1]); return document.createElement("span"); },
        text: () => document.createElement("span")
    };
    const shop: any = Object.create(NCShopWnd.prototype);
    const lists = [0, 1].map(() => {
        const content = document.createElement("div");
        return Object.assign(document.createElement("div"), { content, getScroll: () => 0, setScroll: () => {}, setContentHeight: () => {} });
    });
    Object.assign(shop, {
        layer, items: [[{ itemId: 1, objectId: 11, count: 0 }, { itemId: 2, objectId: 12, count: 0 }, { itemId: 3, objectId: 13, count: 0 }, { itemId: 4, objectId: 14, count: 0 }], []],
        generation: 0, lists, selected: [null, null], hoveredSide: -1, hoveredIndex: -1, isSell: false, isPreview: false, isStore: false,
        onTooltip: null, onHideTooltip: null
    });
    const originalAdd = HTMLElement.prototype.addEventListener;
    HTMLElement.prototype.addEventListener = function(type: string, ...args: any[]) { if (type === "mouseenter") hoverHandlers++; return originalAdd.call(this, type, args[0], args[1]); };
    try { await shop.paintItems(); } finally { HTMLElement.prototype.addEventListener = originalAdd; }
    const buttons = Array.from(lists[0].content.children) as HTMLElement[];
    if (buttons.length !== 4) throw new Error(`Expected four visible shop rows, got ${buttons.length}.`);
    if (buttons.map(button => button.dataset.itemId).join(",") !== "1,2,3,4") throw new Error("Shop row identities changed.");
    if (texturePaths.join(",") !== "icon.sword,icon.axe") throw new Error(`Unexpected texture paths: ${texturePaths.join(",")}`);
    if (tiledPaths.filter(path => path === "").length) throw new Error("An empty icon path was tiled.");
    if (hoverHandlers !== 4) throw new Error(`Expected four interactive rows, found ${hoverHandlers}.`);
    window.shopPaintResult = { passed: true, baselineFailedOnEmptyPath, rows: buttons.length, texturePaths, tiledPaths, hoverHandlers };
}

run().catch(error => { window.shopPaintResult = { passed: false, error: String(error?.stack || error) }; });
