// Local-time helpers. All routine maths happens in the household zone
// (Australia/Perth by default). Uses Intl so any IANA zone works.

export const DEFAULT_TZ = 'Australia/Perth';

export interface LocalParts {
	date: string; // YYYY-MM-DD
	minutes: number; // minutes since local midnight
	weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
	let f = fmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			weekday: 'short'
		});
		fmtCache.set(tz, f);
	}
	return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function localParts(now: Date, tz = DEFAULT_TZ): LocalParts {
	const parts = Object.fromEntries(formatter(tz).formatToParts(now).map((p) => [p.type, p.value]));
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		minutes: Number(parts.hour) * 60 + Number(parts.minute),
		weekday: WEEKDAYS.indexOf(parts.weekday)
	};
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
	return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "HH:MM" → minutes since midnight. */
export function hhmm(value: string): number {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (!m) throw new Error(`bad time ${value}`);
	return Number(m[1]) * 60 + Number(m[2]);
}

/** The household's display date: before the rollover time it is still "yesterday". */
export function displayDate(now: Date, tz = DEFAULT_TZ, rolloverMinutes = 180): string {
	const p = localParts(now, tz);
	return p.minutes < rolloverMinutes ? addDays(p.date, -1) : p.date;
}
