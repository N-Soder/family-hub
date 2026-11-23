import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seededDb, perth } from '../helpers';
import { dayOverride, dayType, member, occurrence, routineStep, routineTemplate } from '../../src/lib/server/db/schema';
import { deleteStep, getOrCreateOccurrence, occurrenceSteps, regenerateOccurrence, resolveDayType, stepApplies } from '../../src/lib/server/domain/routines';
import { setStepState } from '../../src/lib/server/domain/toggle';
import { setPatternDay } from '../../src/lib/server/planner';

async function setup() {
	const db = await seededDb();
	const child = db.select().from(member).get()!;
	const morning = db.select().from(routineTemplate).where(eq(routineTemplate.name, 'Morning')).get()!;
	const types = Object.fromEntries(db.select().from(dayType).all().map((d) => [d.name, d.id]));
	return { db, child, morning, types };
}

describe('day types', () => {
	it('resolves admin override → calendar → weekly pattern', async () => {
		const { db, child, types } = await setup();
		// 2026-10-26 is a Monday: daycare in the seeded pattern.
		expect(resolveDayType(db, child.id, '2026-10-26')).toBe(types.Daycare);
		db.insert(dayOverride).values({ memberId: child.id, localDate: '2026-10-26', dayTypeId: types.Swimming, source: 'calendar' }).run();
		expect(resolveDayType(db, child.id, '2026-10-26')).toBe(types.Swimming);
		db.update(dayOverride)
			.set({ dayTypeId: types.Home, source: 'admin' })
			.where(and(eq(dayOverride.memberId, child.id), eq(dayOverride.localDate, '2026-10-26')))
			.run();
		expect(resolveDayType(db, child.id, '2026-10-26')).toBe(types.Home);
	});
	it('sets or clears one weekday of the weekly pattern', async () => {
		const { db, child, morning, types } = await setup();
		setPatternDay(db, child.id, 1, types.Home); // Mondays become home days
		expect(resolveDayType(db, child.id, '2026-10-26')).toBe(types.Home);
		expect(resolveDayType(db, child.id, '2026-10-27')).toBe(types.Swimming); // Tuesday untouched
		const occ = getOrCreateOccurrence(db, morning, '2026-10-26');
		expect(occurrenceSteps(db, occ.id).map((s) => s.titleSnapshot)).not.toContain('Pack bag');
		setPatternDay(db, child.id, 1, null);
		expect(resolveDayType(db, child.id, '2026-11-02')).toBeNull();
	});
	it('filters steps by day type; unfiltered steps appear every day', () => {
		expect(stepApplies(null, null)).toBe(true);
		expect(stepApplies('[2]', 2)).toBe(true);
		expect(stepApplies('[2]', 1)).toBe(false);
		expect(stepApplies('[2]', null)).toBe(false);
	});
});

describe('occurrence generation', () => {
	it('is lazy, idempotent, and snapshots the filtered steps', async () => {
		const { db, morning, types } = await setup();
		const a = getOrCreateOccurrence(db, morning, '2026-10-26', perth('2026-10-26', '07:00')); // Monday daycare
		const b = getOrCreateOccurrence(db, morning, '2026-10-26', perth('2026-10-26', '07:05'));
		expect(b.id).toBe(a.id);
		expect(db.select().from(occurrence).all()).toHaveLength(1);
		expect(a.dayTypeId).toBe(types.Daycare);
		expect(occurrenceSteps(db, a.id).map((s) => s.titleSnapshot)).toEqual([
			'Get dressed',
			'Breakfast',
			'Brush teeth',
			'Shoes on',
			'Pack bag',
			'Hat and sunscreen'
		]);
		// Sunday is a home day: no shoes, bag or hat.
		const sun = getOrCreateOccurrence(db, morning, '2026-10-25');
		expect(occurrenceSteps(db, sun.id).map((s) => s.titleSnapshot)).toEqual(['Get dressed', 'Breakfast', 'Brush teeth']);
	});

	it('template edits and later overrides do not rewrite a started day until regenerate', async () => {
		const { db, child, morning, types } = await setup();
		const occ = getOrCreateOccurrence(db, morning, '2026-10-26');
		db.update(routineStep).set({ title: 'Clothes on' }).where(eq(routineStep.title, 'Get dressed')).run();
		db.insert(dayOverride).values({ memberId: child.id, localDate: '2026-10-26', dayTypeId: types.Home, source: 'admin' }).run();
		expect(occurrenceSteps(db, occ.id)[0].titleSnapshot).toBe('Get dressed');
		expect(occurrenceSteps(db, occ.id)).toHaveLength(6);

		// Tick "Pack bag" so regenerate must keep it even though home days hide it.
		const bag = occurrenceSteps(db, occ.id).find((s) => s.titleSnapshot === 'Pack bag')!;
		setStepState(db, bag.id, true);
		const regen = regenerateOccurrence(db, occ, morning);
		expect(regen.id).toBe(occ.id);
		expect(regen.dayTypeId).toBe(types.Home);
		expect(occurrenceSteps(db, occ.id).map((s) => s.titleSnapshot)).toEqual(['Clothes on', 'Breakfast', 'Brush teeth', 'Pack bag']);
	});
});

describe('step edits apply to today', () => {
	it('keeps the day type, keeps ticked steps, picks up new ones', async () => {
		const { db, child, morning, types } = await setup();
		const occ = getOrCreateOccurrence(db, morning, '2026-10-26', perth('2026-10-26', '07:00')); // daycare
		const first = occurrenceSteps(db, occ.id)[0];
		setStepState(db, first.id, true);
		// An override after the day started must not change it on a step sync.
		db.insert(dayOverride).values({ memberId: child.id, localDate: '2026-10-26', dayTypeId: types.Home, source: 'admin' }).run();
		db.insert(routineStep).values({ templateId: morning.id, title: 'Hat on', sort: 99 }).run();
		db.update(routineStep).set({ title: 'Get dressed' }).where(eq(routineStep.id, first.stepId)).run();
		const synced = regenerateOccurrence(db, occ, morning, { keepDayType: true });
		expect(synced.dayTypeId).toBe(types.Daycare);
		const steps = occurrenceSteps(db, occ.id);
		expect(steps[0]).toMatchObject({ id: first.id, titleSnapshot: 'Get dressed' });
		expect(steps[0].completedAt).not.toBeNull();
		expect(steps.at(-1)!.titleSnapshot).toBe('Hat on');
	});
});

describe('deleting a step', () => {
	it('removes an unused step outright', async () => {
		const { db, morning } = await setup();
		const id = db.insert(routineStep).values({ templateId: morning.id, title: 'Unused', sort: 99 }).returning().get().id;
		expect(deleteStep(db, id)).toBe(morning.id);
		expect(db.select().from(routineStep).where(eq(routineStep.id, id)).get()).toBeUndefined();
	});
	it('hides a used step, keeps past days, drops it from today unless ticked', async () => {
		const { db, morning } = await setup();
		const past = getOrCreateOccurrence(db, morning, '2026-10-25', perth('2026-10-25', '07:00'));
		const todayOcc = getOrCreateOccurrence(db, morning, '2026-10-26', perth('2026-10-26', '07:00'));
		const target = occurrenceSteps(db, todayOcc.id)[0];
		const pastCount = occurrenceSteps(db, past.id).length;
		deleteStep(db, target.stepId, perth('2026-10-26', '07:30'));
		const row = db.select().from(routineStep).where(eq(routineStep.id, target.stepId)).get()!;
		expect(row.deletedAt).not.toBeNull();
		regenerateOccurrence(db, todayOcc, morning, { keepDayType: true });
		expect(occurrenceSteps(db, todayOcc.id).map((s) => s.stepId)).not.toContain(target.stepId);
		expect(occurrenceSteps(db, past.id)).toHaveLength(pastCount);
		// A later day never gets it.
		const next = getOrCreateOccurrence(db, morning, '2026-10-27', perth('2026-10-27', '07:00'));
		expect(occurrenceSteps(db, next.id).map((s) => s.stepId)).not.toContain(target.stepId);
	});
});
