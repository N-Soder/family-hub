// The shop switch on a list (ADR-41). Picking a shop hides only items tied to another shop;
// items with no shop always stay. The pick is kept per phone and list for a few hours, so a
// list opened the next day starts on All.

/** How long a phone remembers the shop picked on a list. */
export const SHOP_PICK_TTL_MS = 3 * 60 * 60_000;

/** Split items into those shown at `shopId` (null = All) and those hidden. */
export function byShop<T extends { shopId: number | null }>(items: T[], shopId: number | null): { shown: T[]; hidden: T[] } {
	if (shopId === null) return { shown: items, hidden: [] };
	const hidden = items.filter((i) => i.shopId !== null && i.shopId !== shopId);
	return { shown: items.filter((i) => !hidden.includes(i)), hidden };
}

const key = (listId: number) => `fh-shop-${listId}`;

/** The shop picked on this list, if it is recent and the shop still exists. */
export function readShopPick(store: Pick<Storage, 'getItem'> | undefined, listId: number, shopIds: number[], now = Date.now()): number | null {
	try {
		const raw = store?.getItem(key(listId));
		if (!raw) return null;
		const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
		if (typeof v.id !== 'number' || typeof v.at !== 'number' || now - v.at > SHOP_PICK_TTL_MS) return null;
		return shopIds.includes(v.id) ? v.id : null;
	} catch {
		return null;
	}
}

export function saveShopPick(store: Pick<Storage, 'setItem' | 'removeItem'> | undefined, listId: number, shopId: number | null, now = Date.now()): void {
	try {
		if (shopId === null) store?.removeItem(key(listId));
		else store?.setItem(key(listId), JSON.stringify({ id: shopId, at: now }));
	} catch {
		// Private mode or blocked storage: the pick just isn't remembered.
	}
}
