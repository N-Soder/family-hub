import { describe, expect, it } from 'vitest';
import { seededDb } from '../helpers';
import { addItem, addShop, allLists, createList, deleteList, getItem, listDetail, listShops, MAX_SHOPS, removeShop, setItemShop } from '../../src/lib/server/domain/lists';
import { byShop, readShopPick, saveShopPick, SHOP_PICK_TTL_MS } from '../../src/lib/shop-filter';

// Shops on lists (ADR-41).
async function shopping() {
	const db = await seededDb();
	const id = allLists(db).find((l) => l.name === 'Shopping')!.id;
	return { db, id };
}
const added = (r: ReturnType<typeof addShop>) => {
	if (r.status !== 'added' && r.status !== 'exists') throw new Error(r.status);
	return r.shopId;
};

describe('list shops', () => {
	it('adds shops with their own tones and never duplicates a name (case and spacing ignored)', async () => {
		const { db, id } = await shopping();
		const grocer = added(addShop(db, id, 'Grocer'));
		added(addShop(db, id, ' Warehouse '));
		expect(addShop(db, id, 'grocer')).toEqual({ status: 'exists', shopId: grocer });
		const shops = listShops(db, id);
		expect(shops.map((s) => s.name)).toEqual(['Grocer', 'Warehouse']);
		expect(new Set(shops.map((s) => s.tone)).size).toBe(2);
	});

	it('caps the shops on a list and refuses shops on to-do lists', async () => {
		const { db, id } = await shopping();
		for (let i = 0; i < MAX_SHOPS; i++) added(addShop(db, id, `Shop ${i}`));
		expect(addShop(db, id, 'One more')).toEqual({ status: 'full' });
		const todo = createList(db, { name: 'House jobs', kind: 'todo', icon: 'home' });
		expect(addShop(db, todo, 'Grocer')).toEqual({ status: 'not-allowed' });
		const other = createList(db, { name: 'Hardware', kind: 'other', icon: 'star' });
		expect(addShop(db, other, 'Grocer').status).toBe('added');
	});

	it('ties an item to a shop of its own list only, and back to any shop', async () => {
		const { db, id } = await shopping();
		const grocer = added(addShop(db, id, 'Grocer'));
		const other = createList(db, { name: 'Hardware', kind: 'other', icon: 'star' });
		const elsewhere = added(addShop(db, other, 'Depot'));
		const milk = addItem(db, id, 'Milk').itemId;
		expect(setItemShop(db, milk, grocer)).toBe(true);
		expect(setItemShop(db, milk, elsewhere)).toBe(false);
		expect(getItem(db, milk)!.shopId).toBe(grocer);
		expect(listDetail(db, id)!.shops.map((s) => s.name)).toEqual(['Grocer']);
		expect(setItemShop(db, milk, null)).toBe(true);
		expect(getItem(db, milk)!.shopId).toBeNull();
	});

	it('removing a shop puts its items back to any shop; deleting the list removes its shops', async () => {
		const { db, id } = await shopping();
		const grocer = added(addShop(db, id, 'Grocer'));
		const milk = addItem(db, id, 'Milk').itemId;
		setItemShop(db, milk, grocer);
		expect(removeShop(db, grocer)).toBe(true);
		expect(removeShop(db, grocer)).toBe(false);
		expect(getItem(db, milk)!.shopId).toBeNull();
		added(addShop(db, id, 'Warehouse'));
		deleteList(db, id);
		expect(listShops(db, id)).toEqual([]);
	});
});

describe('shop filter', () => {
	const items = [
		{ title: 'Milk', shopId: null },
		{ title: 'Sourdough', shopId: 1 },
		{ title: 'Hummus', shopId: 2 }
	];
	it('hides only items tied to another shop; untagged items always show', () => {
		expect(byShop(items, null)).toEqual({ shown: items, hidden: [] });
		const at1 = byShop(items, 1);
		expect(at1.shown.map((i) => i.title)).toEqual(['Milk', 'Sourdough']);
		expect(at1.hidden.map((i) => i.title)).toEqual(['Hummus']);
	});

	it('remembers a pick per list for a few hours, and forgets a removed shop', () => {
		const mem = new Map<string, string>();
		const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
		saveShopPick(store, 7, 2, 1_000);
		expect(readShopPick(store, 7, [1, 2], 1_000 + SHOP_PICK_TTL_MS)).toBe(2);
		expect(readShopPick(store, 7, [1, 2], 1_001 + SHOP_PICK_TTL_MS)).toBeNull();
		expect(readShopPick(store, 8, [1, 2], 1_000)).toBeNull();
		expect(readShopPick(store, 7, [1], 1_000)).toBeNull();
		saveShopPick(store, 7, null);
		expect(mem.size).toBe(0);
		mem.set('fh-shop-7', 'not json');
		expect(readShopPick(store, 7, [1, 2])).toBeNull();
		expect(readShopPick(undefined, 7, [1, 2])).toBeNull();
	});
});
