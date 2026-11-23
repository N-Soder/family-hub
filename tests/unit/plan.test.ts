import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seededDb, perth, withDevice } from '../helpers';
import type { DB } from '../../src/lib/server/db';
import { member, occurrenceStep, routineStep, routineTemplate, completionEvent } from '../../src/lib/server/db/schema';
import { activePlan, clockLabel, localToIso, minutesOn, nextIndex, planDay, planTimes, retimeEnd, retimeStep, startTimer, stopTimer, unstopTimer, type PlanStepIn } from '../../src/lib/server/domain/plan';
import { templatesForMember } from '../../src/lib/server/domain/routines';
import { buildPayload, latestSnapshot, memberForPage, MEMBER_SLOTS, renderForDevice, ROUTINES_SLOT, wallViewKey } from '../../src/lib/server/domain/render';
import { applyWallTap, setStepState } from '../../src/lib/server/domain/toggle';
import { WallScreens } from '../../src/lib/server/domain/screens';

const DATE = '2026-10-26';
const at = (time: string) => perth(DATE, time).toISOString();
const TZ = 'Australia/Perth';

/** The book's day, as steps: [id, dueAt, after, min]. */
function step(stepId: number, rule: { at?: string; after?: number; min?: number } = {}, completedAt: string | null = null): PlanStepIn {
	return { stepId, completedAt, dueAt: rule.at ?? null, dueAfterStepId: rule.after ?? null, dueAfterMin: rule.after ? (rule.min ?? 0) : null };
}

describe('plan times', () => {
	it('a fixed time stands; a step after an un-ticked step is an estimate; ticking firms it up', () => {
		const steps = [
			step(1, { at: '06:50' }), // Woke up
			step(2, { at: '07:00' }), // Milk
			step(3, { after: 2, min: 60 }), // Solids
			step(4, { after: 1, min: 180 }) // Nap
		];
		let t = planTimes(steps, DATE, TZ);
		expect(t.map((x) => x.minutes)).toEqual([410, 420, 480, 590]);
		expect(t.map((x) => x.estimate)).toEqual([false, false, true, true]);

		// She woke at 6:40 and had milk at 7:10.
		steps[0].completedAt = at('06:40');
		steps[1].completedAt = at('07:10');
		t = planTimes(steps, DATE, TZ);
		expect(t.map((x) => (x.minutes === null ? null : clockLabel(x.minutes)))).toEqual(['6:40 am', '7:10 am', '8:10 am', '9:40 am']);
		expect(t.map((x) => x.estimate)).toEqual([false, false, false, false]);
		expect(t.map((x) => x.done)).toEqual([true, true, false, false]);
	});

	it('chains: an estimate built on an estimate stays an estimate', () => {
		const steps = [step(1, {}, at('09:40')), step(2, { after: 1, min: 90 }), step(3, { after: 2, min: 0 }), step(4, { after: 3, min: 60 })];
		const t = planTimes(steps, DATE, TZ);
		expect(t.map((x) => x.minutes)).toEqual([580, 670, 670, 730]);
		expect(t.map((x) => x.estimate)).toEqual([false, false, true, true]);
	});

	it('a rule that points at a later or missing step falls back to its clock time, else no time', () => {
		const steps = [step(1, { after: 2, min: 30 }), step(2, { at: '08:00' }), { ...step(3, { after: 99, min: 10 }), dueAt: '12:00' }, step(4, {})];
		expect(planTimes(steps, DATE, TZ).map((x) => x.minutes)).toEqual([null, 480, 720, null]);
	});

	it('times past midnight carry on counting', () => {
		expect(minutesOn(DATE, perth('2026-10-27', '00:30').toISOString(), TZ)).toBe(1470);
		expect(minutesOn(DATE, at('23:15'), TZ)).toBe(1395);
		expect(clockLabel(1470)).toBe('12:30 am');
	});

	it('next is the first open step after the last ticked one, so a skipped step is left behind', () => {
		const t = (done: boolean[]) => done.map((d) => ({ minutes: 0, estimate: false, done: d }));
		expect(nextIndex(t([false, false, false]))).toBe(0);
		expect(nextIndex(t([true, false, true, false]))).toBe(3);
		expect(nextIndex(t([true, true]))).toBe(null);
	});

	it('local HH:MM on a date round-trips through an ISO instant', () => {
		expect(localToIso(DATE, '10:42', TZ)).toBe('2026-10-26T02:42:00.000Z');
		expect(localToIso(DATE, '00:05', TZ)).toBe('2026-10-25T16:05:00.000Z');
		// A zone with daylight saving, either side of the change.
		expect(localToIso('2026-01-15', '10:00', 'Australia/Sydney')).toBe('2026-01-14T23:00:00.000Z');
		expect(localToIso('2026-07-15', '10:00', 'Australia/Sydney')).toBe('2026-07-15T00:00:00.000Z');
	});
});

/** Juno with the book's plan. Returns ids. */
function addBaby(db: DB) {
	const baby = db.insert(member).values({ name: 'Juno', shortLabel: 'JUN', kind: 'baby', sort: 1, icon: 'baby' }).returning().get();
	const plan = db
		.insert(routineTemplate)
		.values({ memberId: baby.id, name: '6–9 months', kind: 'plan', windowStart: '00:00', windowEnd: '23:59' })
		.returning()
		.get();
	const add = (sort: number, title: string, icon: string, rule: { dueAt?: string; dueAfterStepId?: number; dueAfterMin?: number }) =>
		db.insert(routineStep).values({ templateId: plan.id, title, icon, sort, ...rule }).returning().get().id;
	const woke = add(0, 'Woke up', 'sun', { dueAt: '06:50' });
	const milk = add(1, 'Milk', 'bottle', { dueAt: '07:00' });
	const solids = add(2, 'Solids', 'bowl', { dueAfterStepId: milk, dueAfterMin: 60 });
	const nap = add(3, 'Nap', 'moon', { dueAfterStepId: woke, dueAfterMin: 180 });
	add(4, 'Bedtime', 'bed', { dueAt: '19:00' });
	return { baby: baby.id, plan: plan.id, steps: { woke, milk, solids, nap } };
}

const NOON = perth(DATE, '12:00');

describe('a baby and their plan', () => {
	it('a baby is never the home page and their plan is not a routine', async () => {
		const db = await seededDb();
		const { baby } = addBaby(db);
		expect(memberForPage(db, 'home')?.name).toBe('Ari');
		expect(templatesForMember(db, baby)).toEqual([]);
		expect(activePlan(db, baby)?.name).toBe('6–9 months');
	});

	it('the plan day has every step with times and the next one marked', async () => {
		const db = await seededDb();
		const { plan } = addBaby(db);
		const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, plan)).get()!;
		const day = planDay(db, t, DATE, NOON, TZ);
		expect(day.rows.map((r) => [r.title, r.time, r.estimate])).toEqual([
			['Woke up', '6:50 am', false],
			['Milk', '7:00 am', false],
			['Solids', '8:00 am', true],
			['Nap', '9:50 am', true],
			['Bedtime', '7:00 pm', false]
		]);
		expect(day.next?.title).toBe('Woke up');
		expect(day.rows.map((r) => r.rule)).toEqual(['at 6:50 am', 'at 7:00 am', '1 h after Milk', '3 h after Woke up', 'at 7:00 pm']);
	});

	it('ticking and correcting a time moves the later times', async () => {
		const db = await seededDb();
		const { plan } = addBaby(db);
		const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, plan)).get()!;
		const rows = () => planDay(db, t, DATE, NOON, TZ).rows;
		const woke = rows()[0].id;
		setStepState(db, woke, true, 'planner', perth(DATE, '07:20'));
		expect(rows()[3]).toMatchObject({ title: 'Nap', time: '10:20 am', estimate: false });
		expect(retimeStep(db, woke, DATE, '06:35', TZ, perth(DATE, '07:21'))).toBe(true);
		expect(rows()[0].time).toBe('6:35 am');
		expect(rows()[3].time).toBe('9:35 am');
		expect(db.select().from(completionEvent).where(eq(completionEvent.occurrenceStepId, woke)).all().map((e) => e.action)).toEqual(['complete', 'retime']);
		// Only a ticked step can be retimed.
		expect(retimeStep(db, rows()[1].id, DATE, '07:00', TZ)).toBe(false);
	});
});

describe('waking from a nap (no guess)', () => {
	it('steps after a no-time Woke up wait for it, then snap to times when it is ticked', async () => {
		const db = await seededDb();
		const { plan, steps } = addBaby(db);
		// After the nap: Woke up has no time; Milk as soon as she wakes; Solids 1 h after; Nap 3 h after waking.
		const add = (sort: number, title: string, rule: { dueAfterStepId?: number; dueAfterMin?: number }) =>
			db.insert(routineStep).values({ templateId: plan, title, icon: 'star', sort, ...rule }).returning().get().id;
		const woke2 = add(10, 'Woke up', {});
		const milk2 = add(11, 'Milk', { dueAfterStepId: woke2, dueAfterMin: 0 });
		add(12, 'Solids', { dueAfterStepId: milk2, dueAfterMin: 60 });
		add(13, 'Nap', { dueAfterStepId: woke2, dueAfterMin: 180 });
		void steps;
		const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, plan)).get()!;
		const after = () => planDay(db, t, DATE, NOON, TZ).rows.slice(5);
		expect(after().map((r) => [r.title, r.time, r.waiting])).toEqual([
			['Woke up', null, null],
			['Milk', null, 'after Woke up'],
			['Solids', null, '1 h after Milk'],
			['Nap', null, '3 h after Woke up']
		]);
		// She slept 40 minutes: woke at 10:30.
		setStepState(db, after()[0].id, true, 'planner', perth(DATE, '10:30'));
		expect(after().map((r) => [r.time, r.estimate, r.waiting])).toEqual([
			['10:30 am', false, null],
			['10:30 am', false, null],
			['11:30 am', true, null],
			['1:30 pm', false, null]
		]);
	});
});

describe('the wall: the baby\'s plan is a tab on the routines screen', () => {
	const babyId = (db: DB) => db.select().from(member).all().find((m) => m.kind === 'baby')!.id;

	it('Routines opens a tab per child and baby; the baby\'s tab is the plan; plan rows cannot be tapped', async () => {
		const db = await seededDb();
		withDevice(db, 'wall-1');
		addBaby(db);
		const screens = new WallScreens();
		const render = (now: Date) => renderForDevice(db, 'wall-1', 'home', { now, screen: screens.get('wall-1', now), member: screens.member('wall-1', now) });

		const home = render(NOON);
		expect(home.routines_nav).toEqual({ touch_id: `nroutines-s${ROUTINES_SLOT}`, sub: null });
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: ROUTINES_SLOT, regionId: `el:nroutines-s${ROUTINES_SLOT}:tap`, now: NOON }, screens)).toMatchObject({
			applied: true,
			screen: 'routines'
		});
		const first = render(NOON);
		expect(first.tabs.map((t) => [t.name, t.on, t.sub])).toEqual([
			['Ari', true, null],
			['Juno', false, 'Day plan']
		]);
		expect(first.plan).toBeNull();

		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: MEMBER_SLOTS[1], now: NOON }, screens)).toMatchObject({ applied: true, screen: 'routines' });
		const plan = render(NOON);
		expect(plan.screen).toBe('routines');
		expect(plan.tabs.map((t) => t.on)).toEqual([false, true]);
		expect(plan.plan?.name).toBe('Juno');
		expect(plan.plan?.rows).toHaveLength(5);
		expect(plan.nav?.to).toBe('home');
		// The tap targets are the two tabs and Back.
		expect(latestSnapshot(db, 'wall-1', 'home')!.slots.map((s) => s.kind)).toEqual(['nav', 'nav', 'nav']);
		expect(applyWallTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: NOON }, screens)).toMatchObject({ applied: false, reason: 'empty_slot' });
	});

	it('a tick on the phone changes the plan tab\'s view key (full repaint), not the home screen\'s', async () => {
		const db = await seededDb();
		addBaby(db);
		const id = babyId(db);
		const home = () => wallViewKey(db, 'home', { now: NOON, screen: 'home' });
		const tab = () => wallViewKey(db, 'home', { now: NOON, screen: 'routines', member: id });
		const before = { home: home(), tab: tab() };
		const firstStep = db.select().from(occurrenceStep).all().find((s) => s.titleSnapshot === 'Woke up')!;
		setStepState(db, firstStep.id, true, 'planner', perth(DATE, '06:45'));
		expect(tab()).not.toBe(before.tab);
		expect(home()).toBe(before.home);
	});

	it('a baby with no plan in use: their tab shows no timetable', async () => {
		const db = await seededDb();
		const { plan } = addBaby(db);
		db.update(routineTemplate).set({ active: false }).where(eq(routineTemplate.id, plan)).run();
		const p = buildPayload(db, 'home', { now: NOON, screen: 'routines', member: babyId(db) }).payload;
		expect(p.plan).toBeNull();
		expect(p.tabs.find((t) => t.name === 'Juno')?.sub).toBeNull();
	});
});

/** A timer plan: Milk 7:00; Sleep at 9:50 (timer, usually 60); Milk after Sleep; Sleep 3 h after Sleep (timer, no usual). */
function addTimerPlan(db: DB) {
	const baby = db.insert(member).values({ name: 'Juno', shortLabel: 'JUN', kind: 'baby', sort: 1, icon: 'baby' }).returning().get();
	const plan = db.insert(routineTemplate).values({ memberId: baby.id, name: '6–9 months', kind: 'plan', windowStart: '00:00', windowEnd: '23:59' }).returning().get();
	const add = (sort: number, title: string, icon: string, rule: Partial<typeof routineStep.$inferInsert>) =>
		db.insert(routineStep).values({ templateId: plan.id, title, icon, sort, ...rule }).returning().get().id;
	add(0, 'Milk', 'bottle', { dueAt: '07:00' });
	const sleep = add(1, 'Sleep', 'moon', { dueAt: '09:50', timer: true, usualMin: 60 });
	add(2, 'Milk', 'bottle', { dueAfterStepId: sleep, dueAfterMin: 0 });
	add(3, 'Sleep', 'moon', { dueAfterStepId: sleep, dueAfterMin: 180, timer: true });
	const t = db.select().from(routineTemplate).where(eq(routineTemplate.id, plan.id)).get()!;
	return { t, rows: () => planDay(db, t, DATE, NOON, TZ) };
}

describe('timer steps (a nap: start and stop)', () => {
	it('before it starts, steps after it are guesses from its planned start + usual length', async () => {
		const db = await seededDb();
		const { rows } = addTimerPlan(db);
		const r = rows().rows;
		expect(r.map((x) => [x.title, x.time, x.estimate, x.waiting])).toEqual([
			['Milk', '7:00 am', false, null],
			['Sleep', '9:50 am', false, null],
			['Milk', '10:50 am', true, null],
			['Sleep', '1:50 pm', true, null]
		]);
		expect(r[1]).toMatchObject({ timer: true, running: false, done: false, usualMin: 60 });
	});

	it('runs from a start in the past, then the stop sets the times after it', async () => {
		const db = await seededDb();
		const { rows } = addTimerPlan(db);
		const sleep = rows().rows[1].id;
		// Went down 10 minutes ago (at 9:52, noticed at 10:02).
		expect(startTimer(db, sleep, perth(DATE, '09:52'), perth(DATE, '10:02'))).toEqual({ ok: true });
		let d = rows();
		expect(d.running?.id).toBe(sleep);
		expect(d.rows[1]).toMatchObject({ time: '9:52 am', running: true, done: false });
		expect(d.rows[2]).toMatchObject({ time: '10:52 am', estimate: true }); // usual 60 min
		expect(d.next?.title).toBe('Milk');

		// Awake at 10:40.
		expect(stopTimer(db, sleep, perth(DATE, '10:40'), perth(DATE, '10:41'))).toEqual({ ok: true });
		d = rows();
		expect(d.running).toBeNull();
		expect(d.rows[1]).toMatchObject({ done: true, endTime: '10:40 am', durationMin: 48 });
		expect(d.rows[2]).toMatchObject({ time: '10:40 am', estimate: false });
		expect(d.rows[3]).toMatchObject({ time: '1:40 pm', estimate: false });
		expect(d.timedMin).toBe(48);
	});

	it('a timer with no usual length leaves the steps after it waiting while it runs', async () => {
		const db = await seededDb();
		const { rows } = addTimerPlan(db);
		const s1 = rows().rows[1].id;
		startTimer(db, s1, perth(DATE, '09:50'), perth(DATE, '09:50'));
		stopTimer(db, s1, perth(DATE, '10:30'), perth(DATE, '10:30'));
		const s2 = rows().rows[3].id;
		startTimer(db, s2, perth(DATE, '13:30'), perth(DATE, '13:30'));
		expect(rows().rows[3]).toMatchObject({ running: true, time: '1:30 pm', usualMin: null });
	});

	it('undo a stop, correct the stop, cancel; refuses times that make no sense', async () => {
		const db = await seededDb();
		const { rows } = addTimerPlan(db);
		const s = rows().rows[1].id;
		const at = (t: string) => perth(DATE, t);
		expect(stopTimer(db, s, at('10:00'), at('10:00'))).toEqual({ ok: false, reason: 'Not started' });
		expect(startTimer(db, s, at('11:00'), at('10:00'))).toEqual({ ok: false, reason: 'That time is still to come' });
		startTimer(db, s, at('09:50'), at('09:50'));
		expect(startTimer(db, s, at('09:55'), at('09:55'))).toEqual({ ok: false, reason: 'Already started' });
		expect(stopTimer(db, s, at('09:40'), at('10:00'))).toEqual({ ok: false, reason: 'That is before it started' });
		stopTimer(db, s, at('10:40'), at('10:40'));
		expect(unstopTimer(db, s, at('10:41'))).toEqual({ ok: true });
		expect(rows().rows[1].running).toBe(true);
		stopTimer(db, s, at('10:45'), at('10:45'));
		expect(retimeEnd(db, s, DATE, '10:35', TZ, at('10:50'))).toEqual({ ok: true });
		expect(rows().rows[1]).toMatchObject({ endTime: '10:35 am', durationMin: 45 });
		expect(retimeEnd(db, s, DATE, '09:00', TZ, at('10:50'))).toMatchObject({ ok: false });
		// The start can't move past the stop.
		expect(retimeStep(db, s, DATE, '10:50', TZ, at('10:55'))).toBe(false);
		// Cancel: back to not started, stop cleared too.
		setStepState(db, s, false, 'planner', at('10:56'));
		expect(rows().rows[1]).toMatchObject({ running: false, done: false, endTime: null, time: '9:50 am' });
		expect(db.select().from(completionEvent).where(eq(completionEvent.occurrenceStepId, s)).all().map((e) => e.action)).toEqual([
			'complete',
			'stop',
			'unstop',
			'stop',
			'retime_end',
			'uncomplete'
		]);
	});

	it('the wall: running reads "asleep" and the home button says so; stopped reads "until …"', async () => {
		const db = await seededDb();
		const { rows } = addTimerPlan(db);
		const s = rows().rows[1].id;
		startTimer(db, s, perth(DATE, '09:52'), perth(DATE, '09:52'));
		const home = buildPayload(db, 'home', { now: NOON }).payload;
		expect(home.routines_nav?.sub).toBe('Juno asleep since 9:52 am');
		const keyAsleep = wallViewKey(db, 'home', { now: NOON });
		expect(buildPayload(db, 'home', { now: NOON, screen: 'plan' }).payload.plan?.rows[1]).toMatchObject({ note: 'asleep', running: true });
		stopTimer(db, s, perth(DATE, '10:40'), perth(DATE, '10:40'));
		expect(buildPayload(db, 'home', { now: NOON }).payload.routines_nav?.sub).toBeNull();
		expect(wallViewKey(db, 'home', { now: NOON })).not.toBe(keyAsleep); // the Routines button repaints
		expect(buildPayload(db, 'home', { now: NOON, screen: 'plan' }).payload.plan?.rows[1]).toMatchObject({ note: 'until 10:40 am · 48 min', running: false, done: true });
	});
});
