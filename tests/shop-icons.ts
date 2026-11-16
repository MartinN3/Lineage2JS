import { getShopIconPaths } from "../src/nwindow/shop-icons";

const items: any = [[{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }, { itemId: 1 }], [{ itemId: 4 }]];
const icons = ["", "icon.sword", "", "icon.axe", undefined as any];
const paths = getShopIconPaths(items, icons);

if (JSON.stringify(paths) !== JSON.stringify(["icon.sword", "icon.axe"]))
    throw new Error(`Expected valid unique icon paths, got ${JSON.stringify(paths)}.`);

console.log("Shop icon collection skips empty/missing mappings and deduplicates valid paths.");
