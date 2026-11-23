import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { seededDb, perth } from '../helpers';
import { member, routineStep, routineTemplate } from '../../src/lib/server/db/schema';
import type { DB } from '../../src/lib/server/db';
import { greeting, homePhase, homeView, HOME_DUE_ROWS, HOME_LISTS } from '../../src/lib/server/domain/home';
import { activePlan, planDay, startTimer } from '../../src/lib/server/domain/plan';
import { setStepState } from '../../src/lib/server/domain/toggle';
import { addItem, createList, setSchedule } from '../../src/lib/server/domain/lists';
import { createNote, saveNote } from '../../src/lib/server/domain/notes';

// Home (ADR-38): the Board's sources plus today/tomorrow, the baby and lists/notes, ordered by
// where the day is.
const TZ = 'Australia/Perth';
const DAY = '2026-11-05'; // Thursday; seed: Ari's Morning 06:30–09:00, Bedtime in the evening

function feedDir(events: string[]) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-home-'));
	fs.writeFileSync(path.join(dir, 'feeds.json'), JSON.stringify({ feeds: [{ id: 'fam', name: 'Family', url: 'https://x.invalid/a.ics', enabled: true }] }));
	const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
	fs.writeFileSync(path.join(dir, 'feed_fam.ics'), body);
	return dir;
}
const ev = (uid: string, start: string, end: string, title: string) =>
	['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', `DTSTART;TZID=Australia/Perth:${start}`, `DTEND;TZID=Australia/Perth:${end}`, `SUMMARY:${title}`, 'END:VEVENT'].join('\r\n');

function addBaby(db: DB) {
	const baby = db.insert(member).values({ name: 'Juno', shortLabel: 'JUN', kind: 'baby', sort: 1, icon: 'baby' }).returning().get();
	const plan = db.insert(routineTemplate).values({ memberId: baby.id, name: 'Newborn', kind: 'plan', windowStart: '00:00', windowEnd: '23:59' }).returning().get();
	const add = (sort: number, title: string, icon: string, rule: { dueAt?: string; timer?: boolean }) =>
		db.insert(routineStep).values({ templateId: plan.id, title, icon, sort, ...rule }).returning().get().id;
	add(0, 'Milk', 'bottle', { dueAt: '07:00' });
	add(1, 'Sleep', 'moon', { dueAt: '08:30', timer: true });
	return baby.id;
}

describe('home phase and greeting', () => {
	it('a running routine leads; one still to come is "day"; none left is "evening"; no children is "day"', () => {
		const kid = (routine: 'now' | 'soon' | null, next = false) =>
			({ id: 1, name: 'Ari', icon: 'star', dayType: null, routine: routine ? { occurrenceId: 1, name: 'R', window: '', state: routine, steps: [], done: 0, total: 0 } : null, next: next ? { name: 'B', start: '6 pm' } : null }) as const;
		expect(homePhase([kid('now')])).toBe('routine');
		expect(homePhase([kid(null), kid('now')])).toBe('routine');
		expect(homePhase([kid('soon')])).toBe('day');
		expect(homePhase([kid(null, true)])).toBe('day');
		expect(homePhase([kid(null)])).toBe('evening');
		expect(homePhase([])).toBe('day');
	});
	it('greets by the hour', () => {
		expect([3, 7, 13, 19].map(greeting)).toEqual(['Good night', 'Good morning', 'Good afternoon', 'Good evening']);
	});
});

describe('home view', () => {
	it('morning: the routine runs, today keeps only events still to come, tomorrow is held back', async () => {
		const db = await seededDb();
		const dir = feedDir([ev('a', `${DAY.replaceAll('-', '')}T063000`, `${DAY.replaceAll('-', '')}T070000`, 'Early swim'), ev('b', `${DAY.replaceAll('-', '')}T153000`, `${DAY.replaceAll('-', '')}T160000`, 'Dentist'), ev('c', '20261106T090000', '20261106T100000', 'Markets')]);
		const v = homeView(db, { dir, tz: TZ, now: perth(DAY, '07:15') });
		expect(v.phase).toBe('routine');
		expect(v.greeting).toBe('Good morning');
		expect(v.kids[0].routine).toMatchObject({ name: 'Morning', state: 'now' });
		expect(v.calendar.connected).toBe(true);
		expect(v.calendar.today.map((e) => e.title)).toEqual(['Dentist']);
		expect(v.calendar.tomorrow).toBeNull();
		expect(v.week).toHaveLength(7);
		expect(v.week.find((d) => d.today)?.date).toBe(DAY);
	});

	it('evening, after the last routine: tomorrow shows; during Bedtime too', async () => {
		const db = await seededDb();
		const dir = feedDir([ev('c', '20261106T090000', '20261106T100000', 'Markets')]);
		const v = homeView(db, { dir, tz: TZ, now: perth(DAY, '21:30') }); // the seed's Bedtime ends at 9
		expect(v.phase).toBe('evening');
		expect(v.calendar.tomorrow?.map((e) => e.title)).toEqual(['Markets']);
		// During Bedtime the routine leads and tomorrow already shows (from 5 pm).
		const bed = homeView(db, { dir, tz: TZ, now: perth(DAY, '18:45') });
		expect(bed.phase).toBe('routine');
		expect(bed.kids[0].routine?.name).toBe('Bedtime');
		expect(bed.calendar.tomorrow?.map((e) => e.title)).toEqual(['Markets']);
	});

	it('nothing left today shows tomorrow even mid-day; no calendar folder says so', async () => {
		const db = await seededDb();
		const dir = feedDir([ev('c', '20261106T090000', '20261106T100000', 'Markets')]);
		expect(homeView(db, { dir, tz: TZ, now: perth(DAY, '12:00') }).calendar.tomorrow?.map((e) => e.title)).toEqual(['Markets']);
		const none = homeView(db, { tz: TZ, now: perth(DAY, '12:00') });
		expect(none.calendar).toMatchObject({ connected: false, today: [] });
	});

	it('the next routine step is the one Home ticks; a tick shows on the next read', async () => {
		const db = await seededDb();
		const now = perth(DAY, '07:15');
		const r = homeView(db, { tz: TZ, now }).kids[0].routine!;
		const first = r.steps.find((s) => !s.done)!;
		setStepState(db, first.id, true, 'planner', now);
		const after = homeView(db, { tz: TZ, now }).kids[0].routine!;
		expect(after.done).toBe(r.done + 1);
		expect(after.steps.find((s) => !s.done)?.id).not.toBe(first.id);
	});

	it('baby: the last tick and a running timer, with step ids to act on', async () => {
		const db = await seededDb();
		const babyId = addBaby(db);
		const at = perth(DAY, '07:05');
		const plan = activePlan(db, babyId)!;
		let day = planDay(db, plan, DAY, at, TZ);
		setStepState(db, day.rows[0].id, true, 'planner', at); // Milk
		let b = homeView(db, { tz: TZ, now: perth(DAY, '08:00') }).baby!;
		expect(b.last?.title).toBe('Milk');
		expect(b.next).toMatchObject({ title: 'Sleep', timer: true });
		expect(b.running).toBeNull();
		day = planDay(db, plan, DAY, at, TZ);
		expect(startTimer(db, day.rows[1].id, perth(DAY, '08:30'), perth(DAY, '08:30'))).toEqual({ ok: true });
		b = homeView(db, { tz: TZ, now: perth(DAY, '09:00') }).baby!;
		expect(b.running).toMatchObject({ title: 'Sleep', stepId: day.rows[1].id });
		expect(Date.parse(b.running!.since)).toBe(perth(DAY, '08:30').getTime());
	});

	it('to do, lists and notes are capped with a count of the rest', async () => {
		const db = await seededDb();
		const now = perth(DAY, '12:00');
		const todo = createList(db, { name: 'Jobs', kind: 'todo', icon: 'hammer' }, now);
		for (let i = 0; i < HOME_DUE_ROWS + 2; i++) {
			const id = addItem(db, todo, `Job ${i}`, now).itemId;
			setSchedule(db, id, { due: DAY, repeat: null, leadDays: null }, now);
		}
		for (let i = 0; i < HOME_LISTS + 1; i++) createList(db, { name: `Extra ${i}`, kind: 'other', icon: 'list' }, now);
		const n = createNote(db, now);
		saveNote(db, n, { title: 'Wifi', body: 'password on the fridge', version: 1 }, now);
		const v = homeView(db, { tz: TZ, now });
		expect(v.due).toHaveLength(HOME_DUE_ROWS);
		expect(v.dueMore).toBeGreaterThanOrEqual(2);
		expect(v.lists).toHaveLength(HOME_LISTS);
		expect(v.listsMore).toBeGreaterThan(0);
		expect(v.notes[0]).toMatchObject({ title: 'Wifi' });
	});
});
