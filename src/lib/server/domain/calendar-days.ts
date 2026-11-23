import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { DB } from '../db';
import { dayOverride, dayType, member, occurrence, routineTemplate } from '../db/schema';
import { addDays, calendarInstances, type Instance } from './calendar';
import { regenerateOccurrence } from './routines';

// Day types from the calendar (SPEC §12.2, ADR-29). The family's calendar already says which days
// are daycare days, holidays or swimming days; an event whose title is a day type's name turns
// that day into that day type for a child, below an adult's own pick on the phone and above the
// weekly pattern (resolveDayType). Read from the feeds Tesserae downloads (ADR-19), never fetched
// here. Only exact names match: "Ari: Daycare", "Ari Home", "Daycare" (every child); anything
// else is ignored, never guessed.

export type Person = { id: number; name: string; shortLabel: string; kind: 'child' | 'adult' | 'baby'; active: boolean };
export type DayTypeRow = { id: number; name: string; sort: number };
export type CalendarDay = { memberId: number; date: string; dayTypeId: number; title: string; feed: string; specific: boolean };

/** How many days ahead the calendar is read; routines only ever need today, the rest is for the phone. */
export const CALENDAR_DAYS_AHEAD = 14;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function dayTypeNamed(name: string, types: DayTypeRow[]): DayTypeRow | null {
	const n = norm(name).replace(/ day$/, '');
	return types.find((t) => norm(t.name) === n) ?? null;
}

/**
 * Which member and day type an event title names, if any. `people` are the children. A feed named
 * after a child counts as that child's prefix. `null` member = every child.
 */
export function matchDayTypeEvent(title: string, feed: string, people: Person[], types: DayTypeRow[]): { memberId: number | null; dayTypeId: number } | null {
	const t = norm(title);
	for (const p of people) {
		for (const label of [p.name, p.shortLabel]) {
			const l = norm(label);
			if (!l || !t.startsWith(l)) continue;
			const rest = t.slice(l.length).replace(/^(\s*[:\-–—]\s*|['’]s\s+|\s+)/, '');
			if (rest === t) continue; // "Arianna" is not "Ari" + something
			const dt = dayTypeNamed(rest, types);
			if (dt) return { memberId: p.id, dayTypeId: dt.id };
		}
	}
	const dt = dayTypeNamed(t, types);
	if (!dt) return null;
	const owner = people.find((p) => norm(p.name) === norm(feed));
	return { memberId: owner?.id ?? null, dayTypeId: dt.id };
}

/**
 * The calendar's day types per child per date in `from`..`to`. A child's own event (prefixed or in
 * their own feed) beats a whole-family one; two of the same kind on one day → the day type listed
 * first in Settings. A multi-day all-day event covers every day it spans.
 */
export function calendarDays(list: Instance[], from: string, to: string, people: Person[], types: DayTypeRow[]): CalendarDay[] {
	const kids = people.filter((p) => p.active && p.kind === 'child');
	const sorted = [...types].sort((a, b) => a.sort - b.sort || a.id - b.id);
	const rank = new Map(sorted.map((t, i) => [t.id, i]));
	const best = new Map<string, CalendarDay>();
	for (const ev of list) {
		const m = matchDayTypeEvent(ev.title, ev.feed, kids, sorted);
		if (!m) continue;
		const targets = m.memberId === null ? kids.map((k) => k.id) : [m.memberId];
		// A timed event counts on its start day; an all-day one on every day it spans.
		const first = ev.startDate;
		const last = ev.allDay ? ev.endDate : ev.startDate;
		for (let date = first < from ? from : first; date <= last && date <= to; date = addDays(date, 1)) {
			for (const memberId of targets) {
				const key = `${memberId}|${date}`;
				const cand: CalendarDay = { memberId, date, dayTypeId: m.dayTypeId, title: ev.title, feed: ev.feed, specific: m.memberId !== null };
				const cur = best.get(key);
				if (!cur || Number(cand.specific) > Number(cur.specific) || (cand.specific === cur.specific && rank.get(cand.dayTypeId)! < rank.get(cur.dayTypeId)!)) {
					best.set(key, cand);
				}
			}
		}
	}
	return [...best.values()].sort((a, b) => a.date.localeCompare(b.date) || a.memberId - b.memberId);
}

export type CalendarSync = {
	connected: boolean;
	error: string | null;
	from: string;
	to: string;
	days: CalendarDay[];
	/** (member, date) pairs whose stored calendar day type changed this run. */
	changed: Array<{ memberId: number; date: string }>;
	/** Calendar days that an adult's own pick for that date hides. */
	overridden: Array<{ memberId: number; date: string }>;
};

/**
 * Bring `day_override(source = 'calendar')` in line with the calendar for `today`..`today + days`.
 * An adult's pick (`source = 'admin'`) for a date is left alone. Any date whose type changed and
 * whose routines are already generated is regenerated (ticked steps kept, as for a phone pick).
 * Idempotent; safe to run every few minutes.
 */
export function syncCalendarDays(db: DB, dir: string | undefined, tz: string, today: string, days = CALENDAR_DAYS_AHEAD): CalendarSync {
	const to = addDays(today, days);
	const read = calendarInstances(dir, tz, today, to);
	const base = { connected: read.connected, error: read.error, from: today, to, changed: [], overridden: [] };
	if (!read.connected) return { ...base, days: [] };
	const people = db.select().from(member).all();
	const types = db.select().from(dayType).all();
	const wanted = calendarDays(read.list, today, to, people, types);
	// A feed that failed to parse must not wipe its days: skip the write, report the error.
	if (read.error) return { ...base, days: wanted };

	const changed: Array<{ memberId: number; date: string }> = [];
	const overridden: Array<{ memberId: number; date: string }> = [];
	db.transaction((tx) => {
		const rows = tx
			.select()
			.from(dayOverride)
			.where(and(gte(dayOverride.localDate, today), lte(dayOverride.localDate, to)))
			.all();
		const byKey = new Map(rows.map((r) => [`${r.memberId}|${r.localDate}`, r]));
		const wantedKeys = new Set<string>();
		for (const w of wanted) {
			const key = `${w.memberId}|${w.date}`;
			wantedKeys.add(key);
			const cur = byKey.get(key);
			if (cur?.source === 'admin') {
				overridden.push({ memberId: w.memberId, date: w.date });
				continue;
			}
			if (cur && cur.dayTypeId === w.dayTypeId) continue;
			tx.insert(dayOverride)
				.values({ memberId: w.memberId, localDate: w.date, dayTypeId: w.dayTypeId, source: 'calendar', note: w.title })
				.onConflictDoUpdate({ target: [dayOverride.memberId, dayOverride.localDate], set: { dayTypeId: w.dayTypeId, note: w.title } })
				.run();
			changed.push({ memberId: w.memberId, date: w.date });
		}
		for (const r of rows) {
			if (r.source !== 'calendar' || wantedKeys.has(`${r.memberId}|${r.localDate}`)) continue;
			tx.delete(dayOverride)
				.where(and(eq(dayOverride.memberId, r.memberId), eq(dayOverride.localDate, r.localDate)))
				.run();
			changed.push({ memberId: r.memberId, date: r.localDate });
		}
		// Days already generated (today, usually) follow the new type; ticked steps stay.
		if (changed.length) {
			const dates = [...new Set(changed.map((c) => c.date))];
			const occs = tx
				.select({ occ: occurrence, template: routineTemplate })
				.from(occurrence)
				.innerJoin(routineTemplate, eq(routineTemplate.id, occurrence.templateId))
				.where(inArray(occurrence.localDate, dates))
				.all();
			for (const { occ, template } of occs) {
				if (changed.some((c) => c.memberId === template.memberId && c.date === occ.localDate)) regenerateOccurrence(tx as unknown as DB, occ, template);
			}
		}
	});
	return { ...base, days: wanted, changed, overridden };
}
