// Repeating list items (SPEC §5.1, ADR-24): date maths only, no database. Dates are local
// calendar dates (YYYY-MM-DD) in the household zone.

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';
/** 'after': the next one is counted from when it was done. 'fixed': it stays on the calendar. */
export type RepeatMode = 'after' | 'fixed';
export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export interface Repeat {
	every: number;
	unit: RepeatUnit;
	mode: RepeatMode;
	/** First date of a fixed schedule; every later one is counted from it, so months never drift. */
	anchor: string;
}

const UNIT_DAYS: Record<RepeatUnit, number> = { day: 1, week: 7, month: 30.44, year: 365.25 };
/** How far ahead a one-off dated item counts as "soon". */
export const ONE_OFF_LEAD_DAYS = 7;
/** Longest automatic lead time. */
export const MAX_AUTO_LEAD = 30;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function daysBetween(from: string, to: string): number {
	return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

/** Add n units. Months and years keep the day of the month, or the last day if it is shorter (31 Jan + 1 month = 28 Feb). */
export function addInterval(date: string, n: number, unit: RepeatUnit): string {
	const d = utc(date);
	if (unit === 'day' || unit === 'week') {
		d.setUTCDate(d.getUTCDate() + n * (unit === 'week' ? 7 : 1));
		return iso(d);
	}
	const months = unit === 'year' ? n * 12 : n;
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth() + months;
	const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return iso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

export function intervalDays(every: number, unit: RepeatUnit): number {
	return every * UNIT_DAYS[unit];
}

/** Default lead time: 10% of the interval, rounded, between 0 and 30 days (weekly = 1, yearly = 30). */
export function autoLeadDays(every: number, unit: RepeatUnit): number {
	return Math.min(MAX_AUTO_LEAD, Math.max(0, Math.round(intervalDays(every, unit) * 0.1)));
}

/** The first date of a fixed schedule that falls after `after`. */
export function nextOnSchedule(r: Pick<Repeat, 'every' | 'unit' | 'anchor'>, after: string): string {
	if (r.anchor > after) return r.anchor;
	// Start near the answer, then step forward.
	let k = Math.max(0, Math.floor(daysBetween(r.anchor, after) / intervalDays(r.every, r.unit)) - 1);
	for (let guard = 0; guard < 10_000; guard++, k++) {
		const d = addInterval(r.anchor, k * r.every, r.unit);
		if (d > after) return d;
	}
	throw new Error('schedule did not advance');
}

/**
 * The next due date once it is done on `doneOn` (which may be backdated).
 * After done: one interval after it was done. Fixed: the next schedule date after both the
 * day it was done and the day it was due, so doing it early does not make it due again at once.
 */
export function nextDue(r: Repeat, due: string, doneOn: string): string {
	if (r.mode === 'after') return addInterval(doneOn, r.every, r.unit);
	return nextOnSchedule(r, due > doneOn ? due : doneOn);
}

/** Skip one without doing it: the next date after the current due date. */
export function skipDue(r: Repeat, due: string): string {
	return r.mode === 'after' ? addInterval(due, r.every, r.unit) : nextOnSchedule(r, due);
}

export function dueState(due: string, today: string, leadDays: number): DueState {
	const d = daysBetween(today, due);
	if (d < 0) return 'overdue';
	if (d === 0) return 'today';
	return d <= leadDays ? 'soon' : 'later';
}

/** How far through the interval it is: 0 just done, 1 due (and beyond). */
export function progress(due: string, today: string, every: number, unit: RepeatUnit): number {
	const span = intervalDays(every, unit);
	return Math.min(1, Math.max(0, 1 - daysBetween(today, due) / span));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "14 Mar", or "14 Mar 2027" when it is not this year. */
export function shortDate(date: string, today: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return `${d} ${MONTHS[m - 1]}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`;
}

function span(days: number): string {
	if (days < 14) return plural(days, 'day');
	if (days < 60) return plural(Math.round(days / 7), 'week');
	return plural(Math.round(days / 30.44), 'month');
}

/** "3 days overdue", "Due today", "Due tomorrow", "Due in 12 days", "Due 14 Mar". */
export function dueLabel(due: string, today: string, state: DueState): string {
	const d = daysBetween(today, due);
	if (state === 'overdue') return `${span(-d)} overdue`;
	if (state === 'today') return 'Due today';
	if (d === 1) return 'Due tomorrow';
	if (state === 'soon') return `Due in ${span(d)}`;
	return `Due ${shortDate(due, today)}`;
}

/** Shorter, for the wall: "3 days late", "Today", "Tomorrow", "In 12 days". */
export function wallDueLabel(due: string, today: string, state: DueState): string {
	const d = daysBetween(today, due);
	if (state === 'overdue') return `${span(-d)} late`;
	if (state === 'today') return 'Today';
	if (d === 1) return 'Tomorrow';
	return `In ${span(d)}`;
}

const UNIT_WORD: Record<RepeatUnit, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };

/** "Every week", "Every 12 months", plus "on a fixed schedule" for fixed ones. */
export function repeatLabel(r: Pick<Repeat, 'every' | 'unit' | 'mode'>): string {
	const base = r.every === 1 ? `Every ${UNIT_WORD[r.unit]}` : `Every ${r.every} ${UNIT_WORD[r.unit]}s`;
	return r.mode === 'fixed' ? `${base}, fixed` : base;
}

/** Average gap between completions, in the item's own unit: "about 12.4 months apart". */
export function averageGap(doneOn: string[], unit: RepeatUnit): string | null {
	if (doneOn.length < 2) return null;
	const sorted = [...doneOn].sort();
	const days = daysBetween(sorted[0], sorted[sorted.length - 1]) / (sorted.length - 1);
	const n = Math.round((days / UNIT_DAYS[unit]) * 10) / 10;
	return `about ${n} ${UNIT_WORD[unit]}${n === 1 ? '' : 's'} apart`;
}
