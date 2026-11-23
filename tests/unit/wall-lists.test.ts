import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seededDb, perth, withDevice } from '../helpers';
import { device, listItem } from '../../src/lib/server/db/schema';
import { addItem, allLists, createList, setItemDone, shareRows, WALL_TICK_GRACE_MS } from '../../src/lib/server/domain/lists';
import { buildPayload, latestSnapshot, NAV_SLOT, renderForDevice, wallViewKey } from '../../src/lib/server/domain/render';
import { applyWallTap, resetItemTaps } from '../../src/lib/server/domain/toggle';
import { LISTS_IDLE_MS, WallScreens } from '../../src/lib/server/domain/screens';
import { Repainter, type Pusher } from '../../src/lib/server/tesserae/repaint';

const T0 = perth('2026-10-26', '12:00'); // no routine running
const at = (ms: number) => new Date(T0.getTime() + ms);

async function setup() {
	const db = await seededDb();
	withDevice(db, 'wall-1');
	const shop = allLists(db)[0].id;
	const todo = createList(db, { name: 'To-do', kind: 'todo', icon: 'home' });
	for (const t of ['Milk', 'Eggs', 'Bread']) addItem(db, shop, t);
	for (const t of ['Call the plumber', 'Book swimming']) addItem(db, todo, t);
	const screens = new WallScreens();
	resetItemTaps();
	return { db, shop, todo, screens };
}

/** Render the wall as Tesserae would, on whatever screen the device is showing. */
function render(db: Awaited<ReturnType<typeof setup>>['db'], screens: WallScreens, now: Date) {
	return renderForDevice(db, 'wall-1', 'home', { now, screen: screens.get('wall-1', now) });
}

describe('sharing rows between the two lists', () => {
	it('a short list keeps every item; a long one gets the rest; empty lists keep one line', () => {
		expect(shareRows([3, 20], 12)).toEqual([3, 9]);
		expect(shareRows([20, 20], 12)).toEqual([6, 6]);
		expect(shareRows([0, 0], 12)).toEqual([1, 1]);
		expect(shareRows([30], 12)).toEqual([12]);
		expect(shareRows([2, 3], 12)).toEqual([2, 3]);
	});
});

describe('the wall lists screen', () => {
	beforeEach(() => resetItemTaps());

	it('the home screen has a Lists button; tapping it opens the lists, Back returns', async () => {
		const { db, screens } = await setup();
		const home = render(db, screens, T0);
		expect(home.screen).toBe('home');
		expect(home.nav).toEqual({ to: 'lists', touch_id: `nlists-s${NAV_SLOT}` });
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: NAV_SLOT, regionId: `el:nlists-s${NAV_SLOT}:tap`, now: T0 }, screens)).toMatchObject({
			applied: true,
			screen: 'lists'
		});
		const lists = render(db, screens, at(1000));
		expect(lists.screen).toBe('lists');
		expect(lists.nav?.to).toBe('home');
		expect(lists.lists.map((l) => [l.name, l.items.map((i) => i.title)])).toEqual([
			['Shopping', ['Milk', 'Eggs', 'Bread']],
			['To-do', ['Call the plumber', 'Book swimming']]
		]);
		expect(lists.lists.flatMap((l) => l.items.map((i) => i.slot))).toEqual([1, 2, 3, 4, 5]);
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: NAV_SLOT, now: at(2000) }, screens);
		expect(render(db, screens, at(3000)).screen).toBe('home');
	});

	it('only the first two lists are shown', async () => {
		const { db, screens } = await setup();
		createList(db, { name: 'Holiday', kind: 'other', icon: 'star' });
		screens.set('wall-1', 'lists', T0);
		expect(render(db, screens, T0).lists.map((l) => l.name)).toEqual(['Shopping', 'To-do']);
	});

	it('ticks from the wall: double taps inside 4 s apply once, and an untick keeps the row in place', async () => {
		const { db, screens } = await setup();
		screens.set('wall-1', 'lists', T0);
		render(db, screens, T0);
		const eggs = latestSnapshot(db, 'wall-1', 'home')!.slots.find((s) => s.slot === 2)!;
		expect(eggs).toMatchObject({ kind: 'item' });
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 2, now: at(0) }, screens)).toMatchObject({ applied: true, state: 'done' });
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 2, now: at(3000) }, screens)).toMatchObject({ applied: false, reason: 'deduped' });
		const row = db.select().from(listItem).where(eq(listItem.title, 'Eggs')).get()!;
		expect(row.doneBy).toBe('wall');
		// Still on the wall, struck through, in the same slot.
		const p = render(db, screens, at(4000));
		expect(p.lists[0].items[1]).toMatchObject({ title: 'Eggs', done: true, slot: 2 });
		expect(p.lists[0].open).toBe(2);
		// A mis-tap undone: back to open, same place.
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 2, now: at(5000) }, screens)).toMatchObject({ applied: true, state: 'todo' });
		expect(render(db, screens, at(6000)).lists[0].items.map((i) => i.title)).toEqual(['Milk', 'Eggs', 'Bread']);
	});

	it('a ticked item drops off after the grace period, which changes the layout key', async () => {
		const { db, screens } = await setup();
		screens.set('wall-1', 'lists', T0);
		render(db, screens, T0);
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: T0 }, screens);
		const before = wallViewKey(db, 'home', { now: at(1000), screen: 'lists' });
		const after = at(WALL_TICK_GRACE_MS + 1000);
		expect(buildPayload(db, 'home', { now: after, screen: 'lists' }).payload.lists[0].items.map((i) => i.title)).toEqual(['Eggs', 'Bread']);
		expect(wallViewKey(db, 'home', { now: after, screen: 'lists' })).not.toBe(before);
	});

	it('a tap made on the old screen is refused once the wall has switched', async () => {
		const { db, screens } = await setup();
		screens.set('wall-1', 'lists', T0);
		render(db, screens, T0);
		// A routine row or the Lists button from the home frame, arriving after the lists frame was served.
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, regionId: 'el:o12-s1:tap', now: T0 }, screens)).toMatchObject({
			status: 409,
			reason: 'stale_region'
		});
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: NAV_SLOT, regionId: `el:nlists-s${NAV_SLOT}:tap`, now: T0 }, screens)).toMatchObject({
			status: 409,
			reason: 'stale_region'
		});
		const milk = db.select().from(listItem).where(eq(listItem.title, 'Milk')).get()!;
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, regionId: `el:i${milk.id}-s1:tap`, now: T0 }, screens).applied).toBe(true);
	});

	it('long lists show "+N more"; the rows never exceed the slots', async () => {
		const { db, shop, screens } = await setup();
		for (let i = 0; i < 15; i++) addItem(db, shop, `Thing ${i}`);
		screens.set('wall-1', 'lists', T0);
		const p = render(db, screens, T0);
		const [s, t] = p.lists;
		expect(t.items).toHaveLength(2); // the to-do list keeps all of its items
		expect(s.items.length + t.items.length + 1).toBe(12); // + the "+N more" line
		expect(s.more).toBe(18 - s.items.length);
	});

	it('the lists close after a few idle minutes; a tap on them restarts the timer', async () => {
		const { db, screens } = await setup();
		screens.set('wall-1', 'lists', T0);
		render(db, screens, T0);
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(LISTS_IDLE_MS - 1000) }, screens);
		expect(screens.get('wall-1', at(LISTS_IDLE_MS + 1000))).toBe('lists');
		expect(screens.get('wall-1', at(2 * LISTS_IDLE_MS))).toBe('home');
	});

	it('with no lists at all there is no Lists button', async () => {
		const { db, screens } = await setup();
		const { list } = await import('../../src/lib/server/db/schema');
		db.delete(list).run();
		expect(render(db, screens, T0).nav).toBeNull();
	});
});

describe('repainting the lists screen', () => {
	function recorder() {
		const calls: string[] = [];
		const pusher: Pusher = {
			patch: async (_p, d) => (calls.push(`patch ${d}`), { ok: true, status: 'sent', ms: 1 }),
			full: async (_p, d) => (calls.push(`full ${d}`), { ok: true, status: 'sent', ms: 1 })
		};
		return { calls, pusher };
	}

	it('an item’s first tick is a patch, ticking it back is a full frame; home walls are left alone', async () => {
		const { db, screens } = await setup();
		withDevice(db, 'wall-2');
		for (const [id, page] of [['wall-1', 'tp1'], ['wall-2', 'tp2']]) {
			db.update(device).set({ settingsJson: JSON.stringify({ tesseraePageId: page, page: 'home' }) }).where(eq(device.id, id)).run();
		}
		const clock = { now: T0 };
		const { calls, pusher } = recorder();
		const r = new Repainter(() => db, pusher, () => clock.now, screens);
		await r.notify([], { full: true });
		screens.set('wall-1', 'lists', T0);
		await r.notify([], { full: true, deviceId: 'wall-1' }); // the Lists button
		calls.length = 0;
		await r.notify(['i1'], { screen: 'lists' });
		await r.notify(['i1'], { screen: 'lists' });
		expect(calls).toEqual(['patch wall-1', 'full wall-1']);
		// A tick dropping off and the lists closing both reach the wall from the ticker.
		calls.length = 0;
		const milk = db.select().from(listItem).where(eq(listItem.title, 'Milk')).get()!;
		setItemDone(db, milk.id, true, 'planner', T0);
		clock.now = at(WALL_TICK_GRACE_MS + 1000);
		screens.touch('wall-1', clock.now);
		await r.tick();
		expect(calls).toEqual(['full wall-1']);
		clock.now = at(WALL_TICK_GRACE_MS + LISTS_IDLE_MS + 2000);
		await r.tick();
		expect(calls).toEqual(['full wall-1', 'full wall-1']);
	});
});
