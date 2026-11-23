import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calendarView, cleanTitle, shortLocation } from '../../src/lib/server/domain/calendar';

const TZ = 'Australia/Perth';
// Saturday 31 Oct 2026, 3:00 pm in Perth.
const NOW = new Date('2026-10-31T15:00:00+08:00');

function ics(events: string[]) {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}
const ev = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'].join('\r\n');

function feedDir(feeds: Record<string, string>, names: Record<string, string>, disabled: string[] = []) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-cal-'));
	fs.writeFileSync(
		path.join(dir, 'feeds.json'),
		JSON.stringify({ feeds: Object.keys(feeds).map((id) => ({ id, name: names[id], url: 'https://example.invalid/x.ics', enabled: !disabled.includes(id) })) })
	);
	for (const [id, body] of Object.entries(feeds)) fs.writeFileSync(path.join(dir, `feed_${id}.ics`), body);
	return dir;
}

const family = ics([
	ev('allday-span', ['DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261115', 'SUMMARY:Cousins visiting']),
	ev('bday', ['DTSTART;TZID=Australia/Perth:20261031T163000', 'DTEND;TZID=Australia/Perth:20261031T183000', 'SUMMARY:Mila’s Bday', 'LOCATION:Beach Park\\, Seaside WA']),
	ev('morning', ['DTSTART;TZID=Australia/Perth:20261031T090000', 'DTEND;TZID=Australia/Perth:20261031T100000', 'SUMMARY:📅 Swim lesson']),
	// Weekly daycare on Tue/Thu, but not Thu 5 Nov.
	ev('daycare', [
		'DTSTART;TZID=Australia/Perth:20261006T080000',
		'DTEND;TZID=Australia/Perth:20261006T170000',
		'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
		'EXDATE;TZID=Australia/Perth:20261105T080000',
		'SUMMARY:Nora Daycare',
		'LOCATION:Little Learners'
	]),
	ev('utc-evening', ['DTSTART:20261031T110000Z', 'DTEND:20261031T130000Z', 'SUMMARY:Halloween Party'])
]);
// The child's own calendar: the party is in both calendars; one event of her own.
const nora = ics([
	ev('party-copy', ['DTSTART:20261031T110000Z', 'DTEND:20261031T130000Z', 'SUMMARY:Halloween Party']),
	ev('swim', ['DTSTART;TZID=Australia/Perth:20261104T110000', 'DTEND;TZID=Australia/Perth:20261104T113000', 'SUMMARY:Nora Swimming'])
]);

describe('Planner calendar (same feeds as the wall)', () => {
	const dir = feedDir({ fastmail: family, nora }, { fastmail: 'Fastmail', nora: 'Nora' });

	it('today: all-day first, then timed in order, in Perth time; past events flagged', () => {
		const v = calendarView(dir, TZ, NOW);
		expect(v.connected).toBe(true);
		expect(v.today.map((e) => [e.time ?? 'all day', e.title, e.past])).toEqual([
			['all day', 'Cousins visiting', false],
			['9:00 am', 'Swim lesson', true],
			['4:30 pm', 'Mila’s Bday', false],
			['7:00 pm', 'Halloween Party', false]
		]);
	});

	it('an event in two calendars counts once; locations stop at the first comma', () => {
		const v = calendarView(dir, TZ, NOW);
		expect(v.today.filter((e) => e.title === 'Halloween Party')).toHaveLength(1);
		expect(v.today.find((e) => e.title === 'Mila’s Bday')?.location).toBe('Beach Park');
	});

	it('coming up: 7 days from tomorrow; repeats expand, skipped dates stay skipped', () => {
		const v = calendarView(dir, TZ, NOW);
		expect(v.upcoming.map((d) => d.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
		const on = (date: string) => v.upcoming.find((d) => d.date === date)!.events.map((e) => `${e.time ?? 'all day'} ${e.title}`);
		expect(on('2026-11-03')).toEqual(['8:00 am Nora Daycare']); // Tue
		expect(on('2026-11-05')).toEqual([]); // Thu: EXDATE
		expect(on('2026-11-04')).toEqual(['11:00 am Nora Swimming']);
		expect(v.upcoming.find((d) => d.date === '2026-11-04')!.events[0].feed).toBe('Nora');
	});

	it('a multi-day event shows once in coming up, on the first day listed', () => {
		const v = calendarView(dir, TZ, NOW);
		const days = v.upcoming.filter((d) => d.events.some((e) => e.title === 'Cousins visiting')).map((d) => d.date);
		expect(days).toEqual(['2026-11-01']);
	});

	it('disabled feeds are left out; no folder means not connected', () => {
		const off = feedDir({ fastmail: family, nora }, { fastmail: 'Fastmail', nora: 'Nora' }, ['nora']);
		expect(calendarView(off, TZ, NOW).upcoming.find((d) => d.date === '2026-11-04')!.events).toEqual([]);
		expect(calendarView(undefined, TZ, NOW)).toMatchObject({ connected: false, today: [] });
		expect(calendarView('/nonexistent', TZ, NOW).connected).toBe(false);
	});

	it('a broken feed is reported, the others still show', () => {
		const bad = feedDir({ fastmail: family, nora: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:garbage' }, { fastmail: 'Fastmail', nora: 'Nora' });
		const v = calendarView(bad, TZ, NOW);
		expect(v.today.map((e) => e.title)).toContain('Mila’s Bday');
	});

	it('titles lose a leading emoji; short locations', () => {
		expect(cleanTitle('📅 Swim')).toBe('Swim');
		expect(cleanTitle('Plain')).toBe('Plain');
		expect(shortLocation('Royal Albert Hall, Kensington')).toBe('Royal Albert Hall');
		expect(shortLocation('')).toBeNull();
	});

	it('a one-day all-day event stays on its own date whatever zone the server runs in', () => {
		// Floating DATE values are parsed as local midnight; on a Perth-time host they once shifted a day early.
		const one = feedDir({ f: ics([ev('bins', ['DTSTART;VALUE=DATE:20261102', 'DTEND;VALUE=DATE:20261103', 'SUMMARY:Bin night'])]) }, { f: 'Family' });
		const v = calendarView(one, TZ, NOW);
		const days = v.upcoming.filter((d) => d.events.some((e) => e.title === 'Bin night')).map((d) => d.date);
		expect(days).toEqual(['2026-11-02']);
	});
});
