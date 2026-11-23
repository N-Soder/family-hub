import { beforeEach, describe, expect, it } from 'vitest';
import { seededDb, perth, withDevice } from '../helpers';
import { member, routineStep, routineTemplate } from '../../src/lib/server/db/schema';
import { addItem, allLists, createList, getItem, setItemDone, setNow, setSchedule, WALL_TICK_GRACE_MS } from '../../src/lib/server/domain/lists';
import { buildPayload, latestSnapshot, MEMBER_SLOTS, renderForDevice, ROUTINES_SLOT, routinesHoldUntil, TODO_SLOTS, wallViewKey } from '../../src/lib/server/domain/render';
import { applyWallTap, resetItemTaps } from '../../src/lib/server/domain/toggle';
import { LISTS_IDLE_MS, WallScreens } from '../../src/lib/server/domain/screens';

// The wall's home screen (ADR-25): TODAY beside TO DO, the week below; the checklists are
// behind the Routines button, one tab per child.

const NOON = perth('2026-11-02', '12:00'); // Monday; no routine running
const MORNING = perth('2026-11-02', '07:00'); // Ari's morning routine is on
const at = (ms: number) => new Date(NOON.getTime() + ms);
const yearly = { every: 12, unit: 'month', mode: 'after' } as const;

async function setup() {
	const db = await seededDb();
	withDevice(db, 'wall-1');
	const todo = createList(db, { name: 'House', kind: 'todo', icon: 'home' }, NOON);
	const shop = allLists(db)[0].id;
	const screens = new WallScreens();
	const render = (now: Date) => renderForDevice(db, 'wall-1', 'home', { now, screen: screens.get('wall-1', now), member: screens.member('wall-1', now) });
	return { db, todo, shop, screens, render };
}

beforeEach(() => resetItemTaps());

describe('home: TO DO', () => {
	it('shows overdue, due within a week and flagged Now items from to-do lists, not shopping or later ones', async () => {
		const { db, todo, shop, render } = await setup();
		const add = (title: string, list = todo) => addItem(db, list, title, NOON).itemId;
		setSchedule(db, add('Gutters'), { due: '2026-10-28', repeat: yearly, leadDays: null }, NOON);
		setSchedule(db, add('Dentist'), { due: '2026-11-06', repeat: null, leadDays: null }, NOON);
		setSchedule(db, add('Rego'), { due: '2026-11-20', repeat: null, leadDays: null }, NOON); // more than a week away
		setNow(db, add('Gate latch'), true, NOON);
		add('Paint the fence'); // no date, not flagged
		setNow(db, add('Milk', shop), true, NOON); // shopping stays on the lists screen
		const home = render(NOON);
		expect(home.screen).toBe('home');
		expect(home.todo?.items.map((i) => [i.title, i.due, i.late])).toEqual([
			['Gutters', '5 days late', true],
			['Dentist', 'In 4 days', false],
			['Gate latch', null, false]
		]);
		expect(home.slots).toEqual([]); // no checklist on home
	});

	it('is read-only: no tap targets, and an item ticked elsewhere shows struck through', async () => {
		const { db, todo, render, screens } = await setup();
		const gate = addItem(db, todo, 'Gate latch', NOON).itemId;
		setNow(db, gate, true, NOON);
		const home = render(NOON);
		expect(home.todo?.items).toMatchObject([{ title: 'Gate latch', done: false }]);
		expect(home.slots.filter((s) => 'itemId' in s)).toEqual([]);
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: NOON }, screens)).toMatchObject({ applied: false, reason: 'empty_slot' });
		expect(getItem(db, gate)!.doneAt).toBeNull();
		const key = wallViewKey(db, 'home', { now: NOON });
		setItemDone(db, gate, true, 'planner', NOON); // ticked on the Lists screen or the phone
		expect(render(at(1000)).todo?.items).toMatchObject([{ title: 'Gate latch', done: true }]);
		expect(wallViewKey(db, 'home', { now: at(1000) })).not.toBe(key);
		expect(render(at(WALL_TICK_GRACE_MS + 11_000)).todo?.items).toEqual([]);
	});

	it(`keeps ${TODO_SLOTS} rows; a longer list ends in "+N more"`, async () => {
		const { db, todo, render } = await setup();
		for (let i = 1; i <= TODO_SLOTS + 2; i++) setNow(db, addItem(db, todo, `Job ${i}`, NOON).itemId, true, at(i));
		const home = render(NOON);
		expect(home.todo?.items).toHaveLength(TODO_SLOTS - 1);
		expect(home.todo?.more).toBe(3);
	});
});

describe('home: weather and agenda', () => {
	it('carries the weather band; a change to what it says repaints the frame', async () => {
		const { db } = await setup();
		const w = { icon: 'wxSun' as const, label: 'Sunny', temp: 22, high: 31, low: 16, uv: 9, uvLevel: 2 as const, rain: null, rainChance: null, wind: null, blocks: null };
		expect(buildPayload(db, 'home', { now: NOON, weather: w }).payload.weather).toEqual(w);
		expect(buildPayload(db, 'home', { now: NOON, weather: null }).payload.weather).toBeNull();
		expect(wallViewKey(db, 'home', { now: NOON, weather: w })).not.toBe(wallViewKey(db, 'home', { now: NOON, weather: { ...w, uv: 10 } }));
	});

	it('lists dated to-dos due after the To do week, up to three weeks out, on their day', async () => {
		const { db, todo, shop } = await setup();
		const due = (title: string, date: string, list = todo) => setSchedule(db, addItem(db, list, title, NOON).itemId, { due: date, repeat: null, leadDays: null }, NOON);
		due('Dentist', '2026-11-06'); // in To do
		due('Rego', '2026-11-20');
		due('Pool pump', '2026-11-12');
		due('Far off', '2026-11-30');
		due('Birthday cake', '2026-11-15', shop);
		expect(buildPayload(db, 'home', { now: NOON, weather: null }).payload.agenda_due).toEqual([
			{ date: '2026-11-12', title: 'Pool pump' },
			{ date: '2026-11-20', title: 'Rego' }
		]);
	});
});

describe('routines screen', () => {
	async function withNora(db: Awaited<ReturnType<typeof setup>>['db']) {
		const nora = db.insert(member).values({ name: 'Nora', shortLabel: 'S', kind: 'child', sort: 2, icon: 'heart' }).returning().get();
		const t = db.insert(routineTemplate).values({ memberId: nora.id, name: 'After school', kind: 'custom', windowStart: '11:00', windowEnd: '17:00' }).returning().get();
		db.insert(routineStep).values([
			{ templateId: t.id, title: 'Bag away', icon: 'bag', sort: 0 },
			{ templateId: t.id, title: 'Snack', icon: 'apple', sort: 1 }
		]).run();
		return nora.id;
	}

	it('home says who has a routine to do; Routines opens on them, a tab switches child, Back goes home', async () => {
		const { db, render, screens } = await setup();
		await withNora(db);
		expect(render(NOON).routines_nav).toEqual({ touch_id: `nroutines-s${ROUTINES_SLOT}`, sub: 'Nora to do' });
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: ROUTINES_SLOT, now: NOON }, screens);
		const r = render(NOON);
		expect(r.screen).toBe('routines');
		expect(r.tabs.map((t) => [t.name, t.on, t.sub])).toEqual([
			['Ari', false, null],
			['Nora', true, '0 of 2']
		]);
		expect(r.slots.map((s) => s.title)).toEqual(['Bag away', 'Snack']);
		// Tick a step on the routines screen.
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: NOON }, screens)).toMatchObject({ applied: true, state: 'done' });
		expect(render(at(1000)).tabs[1].sub).toBe('1 of 2');
		// Ari's tab: nothing on at noon, says what is next.
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: MEMBER_SLOTS[0], now: at(2000) }, screens);
		const ari = render(at(2000));
		expect(ari.tabs.map((t) => t.on)).toEqual([true, false]);
		expect(ari.slots).toEqual([]);
		expect(ari.children[0]).toMatchObject({ name: 'Ari', routine: null, next: { name: 'Bedtime' } });
		expect(latestSnapshot(db, 'wall-1', 'home')!.slots.map((s) => s.slot).sort((a, b) => a - b)).toEqual([20, MEMBER_SLOTS[0], MEMBER_SLOTS[1]]);
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 20, now: at(3000) }, screens);
		expect(render(at(3000)).screen).toBe('home');
	});

	it('with no child chosen it opens on the first with a routine to finish (else the first child)', async () => {
		const { db } = await setup();
		const nora = await withNora(db);
		expect(buildPayload(db, 'home', { now: MORNING, screen: 'routines' }).payload.tabs.find((t) => t.on)?.name).toBe('Ari');
		expect(buildPayload(db, 'home', { now: NOON, screen: 'routines' }).payload.tabs.find((t) => t.on)?.name).toBe('Nora');
		expect(buildPayload(db, 'home', { now: perth('2026-11-02', '22:00'), screen: 'routines' }).payload.tabs.find((t) => t.on)?.name).toBe('Ari');
		expect(buildPayload(db, 'home', { now: MORNING, screen: 'routines', member: nora }).payload.children[0].name).toBe('Nora');
	});

	it('opened during a routine it stays up until the window closes, not just the idle minutes', async () => {
		const { db, render, screens } = await setup();
		const min = (n: number) => new Date(MORNING.getTime() + n * 60_000);
		render(MORNING);
		applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: ROUTINES_SLOT, now: MORNING }, screens);
		expect(render(min(30)).screen).toBe('routines'); // 7:30, no taps since 7:00
		expect(render(min(119)).screen).toBe('routines'); // 8:59
		expect(render(min(120)).screen).toBe('home'); // 9:00: Morning's window closed
	});

	it('outside a routine (or a few minutes before one) the idle timer applies', async () => {
		const { db } = await setup();
		expect(routinesHoldUntil(db, NOON)).toBe(0);
		expect(routinesHoldUntil(db, perth('2026-11-02', '06:28'))).toBe(perth('2026-11-02', '09:00').getTime());
		expect(routinesHoldUntil(db, perth('2026-11-02', '06:20'))).toBe(0);
		const screens = new WallScreens();
		screens.set('wall-1', 'routines', NOON);
		expect(screens.get('wall-1', new Date(NOON.getTime() + LISTS_IDLE_MS))).toBe('home');
	});
});
