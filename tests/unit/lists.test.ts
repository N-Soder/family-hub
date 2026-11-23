import { describe, expect, it } from 'vitest';
import { seededDb } from '../helpers';
import { listItem } from '../../src/lib/server/db/schema';
import { addItem, allLists, clearDone, createList, deleteList, listDetail, moveItem, setItemDone } from '../../src/lib/server/domain/lists';

async function shopping() {
	const db = await seededDb();
	const shop = allLists(db).find((l) => l.name === 'Shopping');
	if (!shop) throw new Error('migration should create the Shopping list');
	return { db, id: shop.id };
}
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('shared lists', () => {
	it('the migration starts every install with an empty Shopping list', async () => {
		const { db } = await shopping();
		expect(allLists(db)).toMatchObject([{ name: 'Shopping', kind: 'grocery', open: 0, done: 0 }]);
	});

	it('adds to the bottom and never duplicates an item (case and spacing ignored)', async () => {
		const { db, id } = await shopping();
		expect(addItem(db, id, 'Milk').status).toBe('added');
		expect(addItem(db, id, '  Eggs ').status).toBe('added');
		expect(addItem(db, id, 'milk').status).toBe('exists');
		expect(addItem(db, id, 'MILK  ').status).toBe('exists');
		expect(titles(listDetail(db, id)!.open)).toEqual(['Milk', 'Eggs']);
	});

	it('adding a ticked item brings it back to the bottom of the list instead', async () => {
		const { db, id } = await shopping();
		const milk = addItem(db, id, 'Milk').itemId;
		addItem(db, id, 'Eggs');
		setItemDone(db, milk, true, 'planner');
		expect(addItem(db, id, 'milk')).toEqual({ status: 'unticked', itemId: milk, title: 'Milk' });
		const d = listDetail(db, id)!;
		expect(titles(d.open)).toEqual(['Eggs', 'Milk']);
		expect(d.done).toEqual([]);
	});

	it('ticking sets a state: repeating a tick or untick changes nothing', async () => {
		const { db, id } = await shopping();
		const milk = addItem(db, id, 'Milk').itemId;
		expect(setItemDone(db, milk, true, 'planner')).toBe(true);
		expect(setItemDone(db, milk, true, 'wall')).toBe(false);
		const d = listDetail(db, id)!;
		expect(d.done).toMatchObject([{ title: 'Milk', doneBy: 'planner' }]);
		expect(setItemDone(db, milk, false, 'planner')).toBe(true);
		expect(setItemDone(db, milk, false, 'planner')).toBe(false);
		expect(setItemDone(db, 9999, true, 'planner')).toBe(false);
		expect(listDetail(db, id)!.open).toMatchObject([{ title: 'Milk', doneAt: null, doneBy: null }]);
	});

	it('ticked items list newest first; clearing removes only ticked items', async () => {
		const { db, id } = await shopping();
		const [a, b] = ['Bread', 'Butter', 'Jam'].map((t) => addItem(db, id, t).itemId);
		setItemDone(db, a, true, 'planner', new Date('2026-10-31T01:00:00Z'));
		setItemDone(db, b, true, 'planner', new Date('2026-10-31T02:00:00Z'));
		expect(titles(listDetail(db, id)!.done)).toEqual(['Butter', 'Bread']);
		expect(allLists(db)[0]).toMatchObject({ open: 1, done: 2 });
		expect(clearDone(db, id)).toBe(2);
		const d = listDetail(db, id)!;
		expect(titles(d.open)).toEqual(['Jam']);
		expect(d.done).toEqual([]);
	});

	it('moves open items up and down, stopping at the ends', async () => {
		const { db, id } = await shopping();
		const [a, , c] = ['A', 'B', 'C'].map((t) => addItem(db, id, t).itemId);
		moveItem(db, c, -1);
		expect(titles(listDetail(db, id)!.open)).toEqual(['A', 'C', 'B']);
		moveItem(db, a, -1);
		moveItem(db, c, 1);
		moveItem(db, c, 1);
		expect(titles(listDetail(db, id)!.open)).toEqual(['A', 'B', 'C']);
	});

	it('lists are separate, and deleting a list deletes its items', async () => {
		const { db, id } = await shopping();
		const todo = createList(db, { name: 'Weekend jobs', kind: 'todo', icon: 'home' });
		addItem(db, id, 'Milk');
		expect(addItem(db, todo, 'Milk').status).toBe('added');
		expect(allLists(db).map((l) => [l.name, l.open])).toEqual([
			['Shopping', 1],
			['Weekend jobs', 1]
		]);
		deleteList(db, todo);
		expect(listDetail(db, todo)).toBeNull();
		expect(db.select().from(listItem).all()).toHaveLength(1);
	});
});
