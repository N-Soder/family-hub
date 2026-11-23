import { beforeEach, describe, expect, it } from 'vitest';
import { seededDb, perth, withDevice } from '../helpers';
import {
	addItem,
	addSuggestion,
	allLists,
	comingUp,
	completeRepeating,
	createList,
	getItem,
	itemLog,
	listDetail,
	removeLog,
	setItemDone,
	setNotes,
	setNow,
	setSchedule,
	skipRepeating,
	snoozeItem,
	suggestionsFor,
	WALL_TICK_GRACE_MS
} from '../../src/lib/server/domain/lists';
import { latestSnapshot, renderForDevice } from '../../src/lib/server/domain/render';
import { applyWallTap, resetItemTaps } from '../../src/lib/server/domain/toggle';
import { WallScreens } from '../../src/lib/server/domain/screens';

// 2 Nov 2026, midday in Perth.
const NOW = perth('2026-11-02', '12:00');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const yearly = { every: 12, unit: 'month', mode: 'after' } as const;

async function house() {
	const db = await seededDb();
	const id = createList(db, { name: 'House & car', kind: 'todo', icon: 'home' }, NOW);
	return { db, id };
}

describe('repeating list items', () => {
	it('done today: logged, due a year on, and waiting under Later', async () => {
		const { db, id } = await house();
		const car = addItem(db, id, 'Service the car', NOW).itemId;
		setSchedule(db, car, { due: '2026-11-10', repeat: yearly, leadDays: null }, NOW);
		expect(listDetail(db, id, NOW)!.open[0].meta).toMatchObject({ state: 'soon', label: 'Due in 8 days', repeat: 'Every 12 months' });

		const res = completeRepeating(db, car, { source: 'planner', now: NOW })!;
		expect(res.next).toBe('2027-11-02');
		const d = listDetail(db, id, NOW)!;
		expect(d.open).toEqual([]);
		expect(d.done).toEqual([]); // never in "ticked"
		expect(d.later.map((i) => [i.title, i.meta?.label])).toEqual([['Service the car', 'Due 2 Nov 2027']]);
		expect(itemLog(db, car)).toMatchObject([{ kind: 'done', doneOn: '2026-11-02', doneBy: 'planner', dueBefore: '2026-11-10' }]);
		expect(allLists(db, NOW).find((l) => l.id === id)).toMatchObject({ open: 0, later: 1 });
	});

	it('backdated with a note: the next date counts from when it was really done', async () => {
		const { db, id } = await house();
		const car = addItem(db, id, 'Service the car', NOW).itemId;
		setSchedule(db, car, { due: '2026-11-02', repeat: yearly, leadDays: null }, NOW);
		const res = completeRepeating(db, car, { source: 'planner', doneOn: '2026-10-27', note: '84,200 km', now: NOW })!;
		expect(res.next).toBe('2027-10-27');
		expect(itemLog(db, car)[0]).toMatchObject({ doneOn: '2026-10-27', note: '84,200 km' });
	});

	it('undo puts the due date back; removing an older entry leaves it', async () => {
		const { db, id } = await house();
		const car = addItem(db, id, 'Service the car', NOW).itemId;
		setSchedule(db, car, { due: '2026-11-02', repeat: yearly, leadDays: null }, NOW);
		const first = completeRepeating(db, car, { source: 'planner', doneOn: '2025-11-01', now: NOW })!;
		const second = completeRepeating(db, car, { source: 'planner', now: NOW })!;
		expect(getItem(db, car)!.dueDate).toBe('2027-11-02');
		expect(removeLog(db, first.logId)).toBe(true);
		expect(getItem(db, car)!.dueDate).toBe('2027-11-02');
		expect(removeLog(db, second.logId)).toBe(true);
		// Back to what it was before the second "done": a year after the first.
		expect(getItem(db, car)!.dueDate).toBe('2026-11-01');
		expect(itemLog(db, car)).toEqual([]);
		expect(removeLog(db, second.logId)).toBe(false);
	});

	it('fixed schedules: skip and snooze', async () => {
		const { db, id } = await house();
		const bins = addItem(db, id, 'Bins out', NOW).itemId;
		setSchedule(db, bins, { due: '2026-11-05', repeat: { every: 1, unit: 'week', mode: 'fixed' }, leadDays: null }, NOW);
		expect(getItem(db, bins)!.repeatAnchor).toBe('2026-11-05');
		expect(skipRepeating(db, bins, 'planner', NOW)!.next).toBe('2026-11-12');
		expect(itemLog(db, bins)[0].kind).toBe('skipped');
		expect(snoozeItem(db, bins, 7, NOW)).toBe('2026-11-19');
		// Done late after the snooze: back on Thursdays.
		expect(completeRepeating(db, bins, { source: 'planner', doneOn: '2026-11-20', now: NOW })!.next).toBe('2026-11-26');
	});

	it('snoozing an overdue item counts from today', async () => {
		const { db, id } = await house();
		const x = addItem(db, id, 'Clean gutters', NOW).itemId;
		setSchedule(db, x, { due: '2026-10-01', repeat: { every: 6, unit: 'month', mode: 'after' }, leadDays: null }, NOW);
		expect(listDetail(db, id, NOW)!.open[0].meta?.label).toBe('5 weeks overdue');
		expect(snoozeItem(db, x, 7, NOW)).toBe('2026-11-09');
	});

	it('a repeat with no due date is due one interval from today', async () => {
		const { db, id } = await house();
		const x = addItem(db, id, 'Aircon filters', NOW).itemId;
		setSchedule(db, x, { due: null, repeat: { every: 3, unit: 'month', mode: 'after' }, leadDays: null }, NOW);
		expect(getItem(db, x)!.dueDate).toBe('2027-02-02');
	});

	it('cannot be ticked off like a one-off', async () => {
		const { db, id } = await house();
		const x = addItem(db, id, 'Pool chlorine', NOW).itemId;
		setSchedule(db, x, { due: '2026-11-02', repeat: { every: 1, unit: 'week', mode: 'after' }, leadDays: null }, NOW);
		expect(setItemDone(db, x, true, 'planner', NOW)).toBe(false);
		expect(getItem(db, x)!.doneAt).toBeNull();
	});

	it('own lead time: shows 60 days ahead instead of 30', async () => {
		const { db, id } = await house();
		const x = addItem(db, id, 'Renew passport', NOW).itemId;
		setSchedule(db, x, { due: '2026-12-20', repeat: { every: 10, unit: 'year', mode: 'fixed' }, leadDays: null }, NOW);
		expect(listDetail(db, id, NOW)!.later).toHaveLength(1);
		setSchedule(db, x, { due: '2026-12-20', repeat: { every: 10, unit: 'year', mode: 'fixed' }, leadDays: 60 }, NOW);
		expect(listDetail(db, id, NOW)!.open).toHaveLength(1);
	});

	it('due items float to the top of the list, by due date; the rest keep their order', async () => {
		const { db, id } = await house();
		for (const t of ['Fix the gate', 'Gutters', 'Call plumber', 'Car']) addItem(db, id, t, NOW);
		const [, gutters, , car] = listDetail(db, id, NOW)!.all.map((i) => i.id);
		setSchedule(db, car, { due: '2026-11-04', repeat: yearly, leadDays: null }, NOW);
		setSchedule(db, gutters, { due: '2026-10-30', repeat: { every: 6, unit: 'month', mode: 'after' }, leadDays: null }, NOW);
		expect(listDetail(db, id, NOW)!.open.map((i) => i.title)).toEqual(['Gutters', 'Car', 'Fix the gate', 'Call plumber']);
	});

	it('one-off items can have a due date and tick off as before', async () => {
		const { db, id } = await house();
		const x = addItem(db, id, 'Book dentist', NOW).itemId;
		setSchedule(db, x, { due: '2026-11-06', repeat: null, leadDays: null }, NOW);
		expect(listDetail(db, id, NOW)!.open[0].meta).toMatchObject({ label: 'Due in 4 days', repeat: null, progress: null });
		expect(setItemDone(db, x, true, 'planner', NOW)).toBe(true);
		expect(listDetail(db, id, NOW)!.done).toHaveLength(1);
	});

	it('Coming up gathers due items from every list, soonest first', async () => {
		const { db, id } = await house();
		const other = createList(db, { name: 'Admin', kind: 'other', icon: 'star' }, NOW);
		const a = addItem(db, id, 'Car', NOW).itemId;
		const b = addItem(db, other, 'Rego', NOW).itemId;
		const c = addItem(db, other, 'Passport', NOW).itemId;
		addItem(db, id, 'No date', NOW);
		setSchedule(db, a, { due: '2026-11-20', repeat: yearly, leadDays: null }, NOW);
		setSchedule(db, b, { due: '2026-10-31', repeat: { every: 1, unit: 'year', mode: 'fixed' }, leadDays: null }, NOW);
		setSchedule(db, c, { due: '2030-01-01', repeat: { every: 10, unit: 'year', mode: 'fixed' }, leadDays: null }, NOW);
		expect(comingUp(db, NOW).map((i) => [i.title, i.listName, i.meta?.state])).toEqual([
			['Rego', 'Admin', 'overdue'],
			['Car', 'House & car', 'soon']
		]);
	});

	it('suggestions add a repeating job once; smoke alarm batteries are due next 1 April', async () => {
		const { db, id } = await house();
		const batteries = addSuggestion(db, id, 'smoke-batteries', NOW)!;
		expect(getItem(db, batteries)).toMatchObject({ title: 'Smoke alarm batteries', dueDate: '2027-04-01', repeatMode: 'fixed', repeatUnit: 'year' });
		const car = addSuggestion(db, id, 'car-service', NOW)!;
		expect(getItem(db, car)).toMatchObject({ dueDate: '2027-11-02', repeatEvery: 12, repeatMode: 'after' });
		expect(addSuggestion(db, id, 'car-service', NOW)).toBe(car);
		expect(suggestionsFor(db, id).map((s) => s.key)).not.toContain('car-service');
		expect(addSuggestion(db, id, 'nope', NOW)).toBeNull();
	});
});

describe('repeating items on the wall', () => {
	beforeEach(() => resetItemTaps());

	async function wall() {
		const db = await seededDb();
		withDevice(db, 'wall-1');
		const shop = allLists(db)[0].id;
		const todo = createList(db, { name: 'House', kind: 'todo', icon: 'home' }, NOW);
		addItem(db, shop, 'Milk', NOW);
		const car = addItem(db, todo, 'Service the car', NOW).itemId;
		const gutters = addItem(db, todo, 'Clean gutters', NOW).itemId;
		setSchedule(db, car, { due: '2027-06-01', repeat: yearly, leadDays: null }, NOW); // not due yet
		setSchedule(db, gutters, { due: '2026-10-30', repeat: { every: 6, unit: 'month', mode: 'after' }, leadDays: null }, NOW);
		const screens = new WallScreens();
		screens.set('wall-1', 'lists', NOW);
		const render = (now: Date) => renderForDevice(db, 'wall-1', 'home', { now, screen: screens.get('wall-1', now) });
		return { db, screens, render, car, gutters };
	}

	it('shows only items that are due soon, with a short due label', async () => {
		const { render } = await wall();
		const house = render(NOW).lists[1];
		expect(house.items.map((i) => [i.title, i.due, i.late])).toEqual([['Clean gutters', '3 days late', true]]);
		expect(house.open).toBe(1);
	});

	it('a tap does it today; it stays struck through for the grace period; a second tap undoes', async () => {
		const { db, screens, render, gutters } = await wall();
		render(NOW);
		const slot = latestSnapshot(db, 'wall-1', 'home')!.slots.find((s) => s.kind === 'item' && s.itemId === gutters)!.slot;
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot, now: NOW }, screens)).toMatchObject({ applied: true, state: 'done' });
		expect(getItem(db, gutters)!.dueDate).toBe('2027-05-02');
		expect(itemLog(db, gutters)[0]).toMatchObject({ doneBy: 'wall', doneOn: '2026-11-02' });
		const p = render(at(5000));
		expect(p.lists[1].items).toMatchObject([{ title: 'Clean gutters', done: true, slot, due: null }]);
		expect(p.lists[1].open).toBe(0);
		// Undo within the grace period.
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot, now: at(6000) }, screens)).toMatchObject({ applied: true, state: 'todo' });
		expect(getItem(db, gutters)!.dueDate).toBe('2026-10-30');
		expect(itemLog(db, gutters)).toEqual([]);
	});

	it('once the grace period is over it leaves the wall until it is due again', async () => {
		const { db, screens, render, gutters } = await wall();
		render(NOW);
		const slot = latestSnapshot(db, 'wall-1', 'home')!.slots.find((s) => s.kind === 'item' && s.itemId === gutters)!.slot;
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot, now: NOW }, screens);
		expect(render(at(WALL_TICK_GRACE_MS + 1000)).lists[1].items).toEqual([]);
	});
});

describe('items flagged Now', () => {
	it('go to the top after due items, and into Coming up after them', async () => {
		const { db, id } = await house();
		const plain = addItem(db, id, 'Paint the fence', NOW).itemId;
		const tap = addItem(db, id, 'Fix the tap', NOW).itemId;
		const car = addItem(db, id, 'Service the car', NOW).itemId;
		setSchedule(db, car, { due: '2026-11-05', repeat: yearly, leadDays: null }, NOW);
		expect(setNow(db, tap, true, NOW)).toBe(true);
		expect(setNow(db, tap, true, NOW)).toBe(false); // already flagged
		expect(listDetail(db, id, NOW)!.open.map((i) => i.title)).toEqual(['Service the car', 'Fix the tap', 'Paint the fence']);
		expect(comingUp(db, NOW).map((i) => [i.title, i.meta?.state ?? 'now'])).toEqual([
			['Service the car', 'soon'],
			['Fix the tap', 'now']
		]);
		expect(getItem(db, plain)!.nowSince).toBeNull();
	});

	it('Now, a date and no date are one choice; repeating items cannot be flagged', async () => {
		const { db, id } = await house();
		const tap = addItem(db, id, 'Fix the tap', NOW).itemId;
		setSchedule(db, tap, { due: '2026-11-20', repeat: null, leadDays: null }, NOW);
		setNow(db, tap, true, NOW);
		expect(getItem(db, tap)).toMatchObject({ dueDate: null, nowSince: NOW.toISOString() });
		// Saving again as Now keeps when it was flagged; giving it a date clears the flag.
		setSchedule(db, tap, { due: null, repeat: null, leadDays: null, now: true }, at(60_000));
		expect(getItem(db, tap)!.nowSince).toBe(NOW.toISOString());
		setSchedule(db, tap, { due: '2026-11-20', repeat: null, leadDays: null, now: false }, NOW);
		expect(getItem(db, tap)).toMatchObject({ dueDate: '2026-11-20', nowSince: null });
		const car = addItem(db, id, 'Service the car', NOW).itemId;
		setSchedule(db, car, { due: '2026-12-01', repeat: yearly, leadDays: null }, NOW);
		expect(setNow(db, car, true, NOW)).toBe(false);
	});

	it('ticking keeps the flag for an undo; adding it again later starts unflagged', async () => {
		const { db, id } = await house();
		const tap = addItem(db, id, 'Fix the tap', NOW).itemId;
		setNow(db, tap, true, NOW);
		setItemDone(db, tap, true, 'planner', NOW);
		setItemDone(db, tap, false, 'planner', NOW);
		expect(getItem(db, tap)!.nowSince).toBe(NOW.toISOString());
		setItemDone(db, tap, true, 'planner', NOW);
		expect(addItem(db, id, 'fix the tap', NOW).status).toBe('unticked');
		expect(getItem(db, tap)!.nowSince).toBeNull();
	});
});

describe('notes', () => {
	it('keep line breaks, trim, clear when blank, and survive saving the schedule', async () => {
		const { db, id } = await house();
		const tap = addItem(db, id, 'Fix the tap', NOW).itemId;
		setNotes(db, tap, '  Plumber: 0400 000 000\r\nhttps://example.com/washer  ');
		expect(getItem(db, tap)!.notes).toBe('Plumber: 0400 000 000\nhttps://example.com/washer');
		setSchedule(db, tap, { due: null, repeat: null, leadDays: null, now: true }, NOW);
		expect(getItem(db, tap)!.notes).toContain('example.com');
		setNotes(db, tap, '   ');
		expect(getItem(db, tap)!.notes).toBeNull();
	});
});
