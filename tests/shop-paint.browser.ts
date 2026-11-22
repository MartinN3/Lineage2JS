import { NCShopWnd } from "../src/nwindow/nc-shop-wnd";

declare global { interface Window { shopPaintResult?: any } }

async function run() {
    const texturePaths: string[] = [], tiledPaths: string[] = [];
    let hoverHandlers = 0;
    const strings: any = { itemIcons: ["", "icon.sword", "", "icon.axe", undefined, "missing.texture"], itemNames: ["", "Sword", "Fists", "Axe", "Unknown", "Missing"] };
    const layer: any = {
        getManager: () => ({ strings }),
        loadTextures: async (paths: string[]) => { texturePaths.push(...paths); if (paths.some(path => !path)) throw new Error("empty texture path"); },
        hasTexture: (path: string) => ["icon.sword", "icon.axe", "NWindow.BlackTexture"].includes(path),
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
        layer, items: [[{ itemId: 1, objectId: 11, count: 0 }, { itemId: 2, objectId: 12, count: 0 }, { itemId: 3, objectId: 13, count: 0 }, { itemId: 4, objectId: 14, count: 0 }, { itemId: 5, objectId: 15, count: 0 }], []],
        generation: 0, lists, selected: [null, null], hoveredSide: -1, hoveredIndex: -1, isSell: false, isPreview: false, isStore: false,
        onTooltip: null, onHideTooltip: null, search: { refresh() {} }
    });
    const originalAdd = HTMLElement.prototype.addEventListener;
    HTMLElement.prototype.addEventListener = function(type: string, ...args: any[]) { if (type === "mouseenter") hoverHandlers++; return originalAdd.call(this, type, args[0], args[1]); };
    try { await shop.paintItems(); } finally { HTMLElement.prototype.addEventListener = originalAdd; }
    const buttons = Array.from(lists[0].content.children) as HTMLElement[];
    if (buttons.length !== 5) throw new Error(`Expected five visible shop rows, got ${buttons.length}.`);
    if (buttons.map(button => button.dataset.itemId).join(",") !== "1,2,3,4,5") throw new Error("Shop row identities changed.");
    if (texturePaths.join(",") !== "?icon.sword,?icon.axe,?missing.texture") throw new Error(`Unexpected texture paths: ${texturePaths.join(",")}`);
    if (tiledPaths.filter(path => path === "").length) throw new Error("An empty icon path was tiled.");
    if (tiledPaths.filter(path => path === "NWindow.BlackTexture").length !== 3) throw new Error("Missing icons did not use black placeholders.");
    if (hoverHandlers !== 5) throw new Error(`Expected five interactive rows, found ${hoverHandlers}.`);
    window.shopPaintResult = { passed: true, rows: buttons.length, texturePaths, tiledPaths, hoverHandlers };
}

run().catch(error => { window.shopPaintResult = { passed: false, error: String(error?.stack || error) }; });
