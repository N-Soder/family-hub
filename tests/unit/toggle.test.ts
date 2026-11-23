import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { seededDb, perth, withDevice } from '../helpers';
import { completionEvent, member, occurrenceStep } from '../../src/lib/server/db/schema';
import { renderForDevice, buildPayload, isStepSlot, latestSnapshot, parseTouchId, touchId, wallViewKey, DONE_GRACE_MS } from '../../src/lib/server/domain/render';
import { applyTap, setStepState } from '../../src/lib/server/domain/toggle';

const MON_7AM = perth('2026-10-26', '07:00');
const at = (ms: number) => new Date(MON_7AM.getTime() + ms);

async function setup() {
	const db = await seededDb();
	withDevice(db, 'wall-1');
	return db;
}

describe('toggle via the served snapshot', () => {
	it('complete → uncomplete → complete writes three events', async () => {
		const db = await setup();
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		const r1 = applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(0) });
		const r2 = applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(5000) });
		const r3 = applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(10000) });
		expect([r1, r2, r3].map((r) => (r.applied ? r.state : r.reason))).toEqual(['done', 'todo', 'done']);
		expect(db.select().from(completionEvent).all().map((e) => e.action)).toEqual(['complete', 'uncomplete', 'complete']);
	});

	it('the same slot tapped twice inside 4 s applies once', async () => {
		const db = await setup();
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 2, now: at(0) }).applied).toBe(true);
		const second = applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 2, now: at(3900) });
		expect(second).toMatchObject({ applied: false, reason: 'deduped', state: 'done' });
		expect(db.select().from(completionEvent).all()).toHaveLength(1);
	});

	it('a re-render with the same mapping keeps the window (no double-tap revert); a new mapping resets it', async () => {
		const db = await setup();
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(0) });
		// Tesserae re-renders after the push: new snapshot id, same slot → step mapping.
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: at(900) });
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: at(1500) })).toMatchObject({ reason: 'deduped' });
		// A snapshot that maps slot 1 to a different step (bedtime) is a different window.
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: perth('2026-10-26', '18:30') });
		const bed = applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: perth('2026-10-26', '18:30') });
		expect(bed.applied).toBe(true);
	});

	it('the window is per device: another device can toggle back immediately', async () => {
		const db = await setup();
		withDevice(db, 'wall-2');
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		renderForDevice(db, 'wall-2', 'home', { screen: 'routines', now: MON_7AM });
		applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 3, now: at(0) });
		expect(applyTap(db, { deviceId: 'wall-2', page: 'home', slot: 3, now: at(500) })).toMatchObject({ applied: true, state: 'todo' });
	});

	it('empty slot → 200 not applied; no snapshot → 409; region from another routine → 409', async () => {
		const db = await setup();
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, now: MON_7AM })).toMatchObject({ status: 409, reason: 'no_snapshot' });
		const p = renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 7, now: MON_7AM })).toMatchObject({ status: 200, applied: false, reason: 'empty_slot' });
		const occ = p.children[0].routine!.occurrence_id;
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, regionId: `el:${touchId(occ + 99, 1)}:tap`, now: MON_7AM })).toMatchObject({
			status: 409,
			reason: 'stale_region'
		});
		expect(applyTap(db, { deviceId: 'wall-1', page: 'home', slot: 1, regionId: `el:${touchId(occ, 1)}:tap`, now: MON_7AM }).applied).toBe(true);
	});

	it('planner sets are explicit and idempotent', async () => {
		const db = await setup();
		renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM });
		const step = latestSnapshot(db, 'wall-1', 'home')!.slots.filter(isStepSlot)[0].occurrenceStepId;
		expect(setStepState(db, step, true).changed).toBe(true);
		expect(setStepState(db, step, true).changed).toBe(false);
		expect(db.select().from(occurrenceStep).where(eq(occurrenceStep.id, step)).get()!.completedBy).toBe('planner');
	});
});

describe('snapshot builder', () => {
	it('labels the payload with the device name so two walls never paint identical pixels', async () => {
		const db = await setup();
		const { device } = await import('../../src/lib/server/db/schema');
		db.update(device).set({ name: 'Kitchen wall' }).where(eq(device.id, 'wall-1')).run();
		expect(renderForDevice(db, 'wall-1', 'home', { screen: 'routines', now: MON_7AM }).device_label).toBe('Kitchen wall');
		expect(buildPayload(db, 'home', { screen: 'routines', now: MON_7AM }).payload.device_label).toBe('');
	});

	it('maps slots to steps stably for an occurrence and mode', async () => {
		const db = await setup();
		const a = buildPayload(db, 'home', { screen: 'routines', now: MON_7AM }).slots.filter(isStepSlot);
		const b = buildPayload(db, 'home', { screen: 'routines', now: at(60_000) }).slots.filter(isStepSlot);
		expect(b.map((s) => s.occurrenceStepId)).toEqual(a.map((s) => s.occurrenceStepId));
		expect(parseTouchId('el:o12-s3:tap')).toEqual({ occurrenceId: 12, slot: 3 });
	});

	it('picture mode yields ≤ 6 slots and reader ≤ 8, flagging overflow', async () => {
		const db = await setup();
		const child = db.select().from(member).get()!;
		const { payload } = buildPayload(db, 'home', { screen: 'routines', now: MON_7AM });
		expect(payload.mode).toBe('picture');
		expect(payload.slots).toHaveLength(6); // seeded morning has 6 steps: all shown
		expect(payload.overflow).toBe(0);
		// Add steps until the morning routine has 10 for a new day, then compare modes.
		const { routineStep, routineTemplate } = await import('../../src/lib/server/db/schema');
		const morning = db.select().from(routineTemplate).where(eq(routineTemplate.name, 'Morning')).get()!;
		for (let i = 0; i < 4; i++) db.insert(routineStep).values({ templateId: morning.id, title: `Extra ${i}`, sort: 10 + i }).run();
		const tue = perth('2026-10-27', '07:00');
		const pic = buildPayload(db, 'home', { screen: 'routines', now: tue }).payload;
		expect(pic.slots).toHaveLength(6);
		expect(pic.overflow).toBe(3); // Tuesday swimming: 9 applicable steps
		db.update(member).set({ displayMode: 'reader' }).where(eq(member.id, child.id)).run();
		const rdr = buildPayload(db, 'home', { screen: 'routines', now: tue }).payload;
		expect(rdr.slots).toHaveLength(8);
		expect(rdr.overflow).toBe(1);
	});

	it('a finished checklist stays up for the grace period, then the week view takes over', async () => {
		const db = await setup();
		const { payload } = buildPayload(db, 'home', { screen: 'routines', now: MON_7AM });
		expect(payload.view).toBe('routine');
		const before = wallViewKey(db, 'home', { screen: 'routines', now: MON_7AM });
		const steps = db.select().from(occurrenceStep).where(eq(occurrenceStep.occurrenceId, payload.children[0].routine!.occurrence_id)).all();
		for (const st of steps) setStepState(db, st.id, true, 'planner', MON_7AM);
		const done = buildPayload(db, 'home', { screen: 'routines', now: at(60_000) }).payload;
		expect(done.view).toBe('routine');
		expect(done.children[0].routine!.all_done).toBe(true);
		expect(done.slots.length).toBeGreaterThan(0); // still tappable: a mis-tap can be undone
		const later = at(DONE_GRACE_MS);
		const week = buildPayload(db, 'home', { screen: 'routines', now: later }).payload;
		expect(week.view).toBe('week');
		expect(week.slots).toHaveLength(0);
		expect(week.children[0].next).toEqual({ name: 'Bedtime', start: '6:30 pm' });
		expect(wallViewKey(db, 'home', { screen: 'routines', now: later })).not.toBe(before);
		// Un-ticking a step brings the checklist back.
		setStepState(db, steps[0].id, false, 'planner', later);
		expect(buildPayload(db, 'home', { screen: 'routines', now: later }).payload.view).toBe('routine');
	});

	it('shows no slots and the next routine outside every window', async () => {
		const db = await setup();
		const { payload } = buildPayload(db, 'home', { screen: 'routines', now: perth('2026-10-26', '12:00') });
		expect(payload.slots).toHaveLength(0);
		expect(payload.view).toBe('week');
		expect(payload.children[0].routine).toBeNull();
		expect(payload.children[0].next).toEqual({ name: 'Bedtime', start: '6:30 pm' });
		expect(payload.children[0].today.label).toBe('Today: Daycare');
	});
});
