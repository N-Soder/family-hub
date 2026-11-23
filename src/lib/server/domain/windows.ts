import { addDays, hhmm, localParts, weekdayOf, DEFAULT_TZ } from './time';

export interface WindowedTemplate {
	id: number;
	windowStart: string;
	windowEnd: string;
	daysOfWeek: number; // bit 0 = Sunday
	active: boolean;
}

/**
 * If `t` is running at `now`, return the local date the run belongs to
 * (the date its window *started*), else null. A window whose end is at or
 * before its start crosses midnight: 19:00–01:00 at 00:30 Tuesday belongs
 * to Monday.
 */
export function activeRunDate(t: WindowedTemplate, now: Date, tz = DEFAULT_TZ): string | null {
	if (!t.active) return null;
	const { date, minutes } = localParts(now, tz);
	const start = hhmm(t.windowStart);
	const end = hhmm(t.windowEnd);
	const runsOn = (d: string) => (t.daysOfWeek & (1 << weekdayOf(d))) !== 0;
	if (end > start) {
		return minutes >= start && minutes < end && runsOn(date) ? date : null;
	}
	// crosses midnight
	if (minutes >= start && runsOn(date)) return date;
	const prev = addDays(date, -1);
	if (minutes < end && runsOn(prev)) return prev;
	return null;
}

/** First active template (by window start) running now, with its run date. */
export function selectActive<T extends WindowedTemplate>(
	templates: T[],
	now: Date,
	tz = DEFAULT_TZ
): { template: T; date: string } | null {
	const sorted = [...templates].sort((a, b) => hhmm(a.windowStart) - hhmm(b.windowStart));
	for (const template of sorted) {
		const date = activeRunDate(template, now, tz);
		if (date) return { template, date };
	}
	return null;
}

/** Next template to start today after `now` (for the "Next:" line), or null. */
export function selectNext<T extends WindowedTemplate>(
	templates: T[],
	now: Date,
	tz = DEFAULT_TZ
): T | null {
	const { date, minutes } = localParts(now, tz);
	const wd = weekdayOf(date);
	return (
		[...templates]
			.filter((t) => t.active && (t.daysOfWeek & (1 << wd)) !== 0 && hhmm(t.windowStart) > minutes)
			.sort((a, b) => hhmm(a.windowStart) - hhmm(b.windowStart))[0] ?? null
	);
}
