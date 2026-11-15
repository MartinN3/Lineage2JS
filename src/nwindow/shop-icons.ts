import type { ShopItem_T } from "../network/game-packets";

export function getShopIconPaths(items: ShopItem_T[][], itemIcons: string[]) {
    return [...new Set(items.flat().map(item => itemIcons[item.itemId]).filter((path): path is string => typeof path === "string" && path.length > 0))];
}
