import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seededDb } from '../helpers';
import { dayOverride, dayType, member, routineTemplate } from '../../src/lib/server/db/schema';
import { getOrCreateOccurrence, occurrenceSteps, resolveDayType } from '../../src/lib/server/domain/routines';
import { setStepState } from '../../src/lib/server/domain/toggle';
import { setOverride } from '../../src/lib/server/planner';
import { calendarDays, matchDayTypeEvent, syncCalendarDays, type Person } from '../../src/lib/server/domain/calendar-days';
import { calendarInstances } from '../../src/lib/server/domain/calendar';

const TZ = 'Australia/Perth';
// Seeded week (Sun..Sat): Home, Daycare, Swimming, Daycare, Home, Daycare, Home.
const MON = '2026-11-09';
const TUE = '2026-11-10';
const THU = '2026-11-12';

function ics(events: string[]) {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}
const ev = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'].join('\r\n');
const allDay = (uid: string, from: string, toExclusive: string, title: string) =>
	ev(uid, [`DTSTART;VALUE=DATE:${from.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${toExclusive.replaceAll('-', '')}`, `SUMMARY:${title}`]);

function feedDir(feeds: Record<string, string>, names: Record<string, string>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-caldays-'));
	writeFeeds(dir, feeds, names);
	return dir;
}
function writeFeeds(dir: string, feeds: Record<string, string>, names: Record<string, string>) {
	fs.writeFileSync(
		path.join(dir, 'feeds.json'),
		JSON.stringify({
			feeds: Object.keys(feeds).map((id) => ({
				id,
				name: names[id],
				url: 'https://x.invalid/a.ics',
				enabled: true
			}))
		})
	);
	for (const [id, body] of Object.entries(feeds)) {
		const f = path.join(dir, `feed_${id}.ics`);
		fs.writeFileSync(f, body);
		fs.utimesSync(f, new Date(), new Date(Date.now() + Math.random() * 1000)); // a new mtime so the parse cache misses
	}
}

async function setup() {
	const db = await seededDb();
	const child = db.select().from(member).get()!;
	const morning = db.select().from(routineTemplate).where(eq(routineTemplate.name, 'Morning')).get()!;
	const types = Object.fromEntries(
		db
			.select()
			.from(dayType)
			.all()
			.map((d) => [d.name, d.id])
	);
	return { db, child, morning, types };
}

const people: Person[] = [
	{ id: 1, name: 'Ari', shortLabel: 'ARI', kind: 'child', active: true },
	{ id: 2, name: 'Nora', shortLabel: 'NORA', kind: 'child', active: true },
	{ id: 3, name: 'Juno', shortLabel: 'JUN', kind: 'baby', active: true }
];
const types = [
	{ id: 10, name: 'Home', sort: 0 },
	{ id: 11, name: 'Daycare', sort: 1 },
	{ id: 12, name: 'Swimming', sort: 2 }
];

describe('matching event titles to day types', () => {
	it('names a day type, with or without a child in front', () => {
		expect(matchDayTypeEvent('Daycare', 'Family', people, types)).toEqual({
			memberId: null,
			dayTypeId: 11
		});
		expect(matchDayTypeEvent('daycare day', 'Family', people, types)).toEqual({
			memberId: null,
			dayTypeId: 11
		});
		expect(matchDayTypeEvent('Ari: Home', 'Family', people, types)).toEqual({
			memberId: 1,
			dayTypeId: 10
		});
		expect(matchDayTypeEvent('Ari Home', 'Family', people, types)).toEqual({
			memberId: 1,
			dayTypeId: 10
		});
		expect(matchDayTypeEvent('Ari’s swimming', 'Family', people, types)).toEqual({ memberId: 1, dayTypeId: 12 });
		expect(matchDayTypeEvent('NORA – Daycare', 'Family', people, types)).toEqual({ memberId: 2, dayTypeId: 11 });
	});
	it('a feed named after a child is that child’s', () => {
		expect(matchDayTypeEvent('Swimming', 'Nora', people, types)).toEqual({
			memberId: 2,
			dayTypeId: 12
		});
	});
	it('ignores everything else, never guesses', () => {
		expect(matchDayTypeEvent('Dentist', 'Family', people, types)).toBeNull();
		expect(matchDayTypeEvent('Daycare photos', 'Family', people, types)).toBeNull();
		expect(matchDayTypeEvent('Ari', 'Family', people, types)).toBeNull();
		expect(matchDayTypeEvent('Arianna: Home', 'Family', people, types)).toBeNull();
		expect(matchDayTypeEvent('Home', 'Fastmail', [], types)).toEqual({
			memberId: null,
			dayTypeId: 10
		});
	});
});

describe('calendar days per child', () => {
	it('family events reach every child, a child’s own event only them; spans cover every day', () => {
		const dir = feedDir(
			{
				fam: ics([allDay('a', '2026-11-09', '2026-11-10', 'Daycare'), allDay('b', '2026-11-16', '2026-11-21', 'Ari: Home'), allDay('c', '2026-11-11', '2026-11-12', 'Dentist')]),
				nora: ics([allDay('d', '2026-11-10', '2026-11-11', 'Swimming')])
			},
			{ fam: 'Family', nora: 'Nora' }
		);
		const got = calendarInstances(dir, TZ, '2026-11-09', '2026-11-23');
		const days = calendarDays(got.list, '2026-11-09', '2026-11-23', people, types);
		const key = (d: { memberId: number; date: string; dayTypeId: number }) => `${d.memberId} ${d.date} ${d.dayTypeId}`;
		expect(days.map(key)).toEqual(['1 2026-11-09 11', '2 2026-11-09 11', '2 2026-11-10 12', ...['16', '17', '18', '19', '20'].map((d) => `1 2026-11-${d} 10`)]);
	});
	it('a child’s own event beats a family one on the same day; ties go to the first day type', () => {
		const dir = feedDir(
			{
				fam: ics([
					allDay('a', '2026-11-09', '2026-11-10', 'Daycare'),
					allDay('b', '2026-11-09', '2026-11-10', 'Ari: Home'),
					allDay('c', '2026-11-10', '2026-11-11', 'Swimming'),
					allDay('d', '2026-11-10', '2026-11-11', 'Home')
				])
			},
			{ fam: 'Family' }
		);
		const days = calendarDays(calendarInstances(dir, TZ, '2026-11-09', '2026-11-10').list, '2026-11-09', '2026-11-10', people, types);
		expect(days.find((d) => d.memberId === 1 && d.date === '2026-11-09')?.dayTypeId).toBe(10);
		expect(days.find((d) => d.memberId === 2 && d.date === '2026-11-09')?.dayTypeId).toBe(11);
		expect(days.find((d) => d.memberId === 1 && d.date === '2026-11-10')?.dayTypeId).toBe(10);
	});
	it('a timed event counts on its start day only', () => {
		const dir = feedDir(
			{
				fam: ics([ev('t', ['DTSTART;TZID=Australia/Perth:20261109T080000', 'DTEND;TZID=Australia/Perth:20261109T170000', 'SUMMARY:Ari Daycare'])])
			},
			{ fam: 'Family' }
		);
		const days = calendarDays(calendarInstances(dir, TZ, '2026-11-09', '2026-11-10').list, '2026-11-09', '2026-11-10', people, types);
		expect(days.map((d) => d.date)).toEqual(['2026-11-09']);
	});
});

describe('syncing calendar day types into day_override', () => {
	it('writes, updates and removes calendar rows; admin picks are left alone', async () => {
		const { db, child, types } = await setup();
		const dir = feedDir(
			{
				fam: ics([allDay('a', MON, TUE, 'Home'), allDay('b', THU, '2026-11-13', 'Ari: Swimming')])
			},
			{ fam: 'Family' }
		);
		let r = syncCalendarDays(db, dir, TZ, MON);
		expect(r.connected).toBe(true);
		expect(r.changed).toEqual([
			{ memberId: child.id, date: MON },
			{ memberId: child.id, date: THU }
		]);
		expect(resolveDayType(db, child.id, MON)).toBe(types.Home); // was Daycare
		expect(resolveDayType(db, child.id, THU)).toBe(types.Swimming); // was Home
		expect(resolveDayType(db, child.id, TUE)).toBe(types.Swimming); // pattern, untouched
		// Running again changes nothing.
		expect(syncCalendarDays(db, dir, TZ, MON).changed).toEqual([]);

		// The adult says Monday is a daycare day after all; the calendar does not override that.
		setOverride(db, child.id, MON, types.Daycare);
		r = syncCalendarDays(db, dir, TZ, MON);
		expect(r.changed).toEqual([]);
		expect(r.overridden).toEqual([{ memberId: child.id, date: MON }]);
		expect(resolveDayType(db, child.id, MON)).toBe(types.Daycare);
		// Clearing the pick and syncing brings the calendar's day back.
		setOverride(db, child.id, MON, null);
		expect(syncCalendarDays(db, dir, TZ, MON).changed).toEqual([{ memberId: child.id, date: MON }]);
		expect(resolveDayType(db, child.id, MON)).toBe(types.Home);

		// The events change: Monday is Daycare after all, Tuesday becomes Home, Thursday goes back to the pattern.
		writeFeeds(
			dir,
			{
				fam: ics([allDay('a', MON, TUE, 'Daycare'), allDay('c', TUE, '2026-11-11', 'Home')])
			},
			{ fam: 'Family' }
		);
		r = syncCalendarDays(db, dir, TZ, MON);
		expect(r.changed.map((c) => c.date).sort()).toEqual([MON, TUE, THU]);
		expect(resolveDayType(db, child.id, MON)).toBe(types.Daycare);
		expect(resolveDayType(db, child.id, TUE)).toBe(types.Home);
		expect(resolveDayType(db, child.id, THU)).toBe(types.Home);
		expect(
			db
				.select()
				.from(dayOverride)
				.where(and(eq(dayOverride.memberId, child.id), eq(dayOverride.source, 'calendar')))
				.all()
		).toHaveLength(2);
	});

	it('a day already generated follows the calendar; ticked steps stay', async () => {
		const { db, child, morning, types } = await setup();
		const occ = getOrCreateOccurrence(db, morning, MON); // Monday: daycare → Pack bag is on the list
		expect(occ.dayTypeId).toBe(types.Daycare);
		const dressed = occurrenceSteps(db, occ.id).find((s) => s.titleSnapshot === 'Get dressed')!;
		setStepState(db, dressed.id, true, 'planner');
		const dir = feedDir({ fam: ics([allDay('a', MON, TUE, 'Ari: Home')]) }, { fam: 'Family' });
		syncCalendarDays(db, dir, TZ, MON);
		const after = occurrenceSteps(db, occ.id);
		expect(after.map((s) => s.titleSnapshot)).not.toContain('Pack bag');
		expect(after.find((s) => s.titleSnapshot === 'Get dressed')?.completedAt).toBeTruthy();
	});

	it('no calendar folder: nothing happens; an unreadable feed list is reported and nothing is removed', async () => {
		const { db, child, types } = await setup();
		expect(syncCalendarDays(db, undefined, TZ, MON)).toMatchObject({
			connected: false,
			changed: [],
			days: []
		});
		const dir = feedDir({ fam: ics([allDay('a', MON, TUE, 'Home')]) }, { fam: 'Family' });
		syncCalendarDays(db, dir, TZ, MON);
		fs.writeFileSync(path.join(dir, 'feeds.json'), '{ not json');
		const r = syncCalendarDays(db, dir, TZ, MON);
		expect(r.error).toBeTruthy();
		expect(r.changed).toEqual([]);
		expect(resolveDayType(db, child.id, MON)).toBe(types.Home);
	});
});
