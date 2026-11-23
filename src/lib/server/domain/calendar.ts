import fs from 'node:fs';
import path from 'node:path';
import ical, { type VEvent } from 'node-ical';

// Calendar for the Planner's Today tab (ADR-19). Reads the feeds Tesserae already downloads for
// the wall (its calendar_core plugin folder, mounted read-only), so the phone shows the same
// events as the wall with no second setup. Mirrors the wall's rules (tesserae/paint/routine.js):
// one list for every calendar, an event in two calendars counts once, location cut at the
// first comma, a multi-day event shows once in Coming up (on the first day listed).

export type CalEvent = {
	title: string;
	allDay: boolean;
	start: string; // ISO instant (timed) or YYYY-MM-DD (all day)
	end: string | null;
	time: string | null; // "4:30 pm" in the household zone; null for all day
	location: string | null;
	feed: string; // feed name, e.g. "Nora"
	past: boolean;
};
export type CalDay = { date: string; weekday: string; label: string; events: CalEvent[] };
export type CalendarView = { connected: boolean; error: string | null; today: CalEvent[]; upcoming: CalDay[] };

type Feed = { id: string; name: string; enabled?: boolean };
type Parsed = { mtimeMs: number; events: VEvent[] };
const cache = new Map<string, Parsed>();

function parseFeed(file: string): VEvent[] {
	const { mtimeMs } = fs.statSync(file);
	const hit = cache.get(file);
	if (hit && hit.mtimeMs === mtimeMs) return hit.events;
	const events = Object.values(ical.sync.parseFile(file)).filter((c): c is VEvent => c?.type === 'VEVENT');
	cache.set(file, { mtimeMs, events });
	return events;
}

/** YYYY-MM-DD of an instant in a zone. */
export function ymd(d: Date, tz: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDays(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
/** Midnight at the start of a local date, as an instant. */
function startOf(date: string, tz: string): Date {
	const guess = new Date(`${date}T00:00:00Z`);
	const local = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
	return new Date(guess.getTime() - (local.getTime() - guess.getTime()));
}

/** Feed titles can start with the feed's symbol (an emoji); drop it, as the wall does. */
export function cleanTitle(s: unknown): string {
	return String(s ?? '')
		.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+/u, '')
		.trim();
}
export function shortLocation(s: unknown): string | null {
	const w = String(s ?? '')
		.split(/[,\n]/)[0]
		.trim();
	return w || null;
}

const PROCESS_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export type Instance = { title: string; allDay: boolean; startDate: string; endDate: string; start: Date; end: Date | null; location: string | null; feed: string };

function instances(dir: string, tz: string, from: Date, to: Date): { list: Instance[]; error: string | null } {
	const feedsFile = path.join(dir, 'feeds.json');
	const raw = JSON.parse(fs.readFileSync(feedsFile, 'utf8')) as { feeds?: Feed[] } | Feed[];
	const feeds = (Array.isArray(raw) ? raw : (raw.feeds ?? [])).filter((f) => f.enabled !== false);
	const list: Instance[] = [];
	const errors: string[] = [];
	for (const f of feeds) {
		const file = path.join(dir, `feed_${f.id}.ics`);
		if (!fs.existsSync(file)) continue;
		try {
			for (const ev of parseFeed(file)) {
				for (const i of ical.expandRecurringEvent(ev, { from, to, expandOngoing: true })) {
					const allDay = Boolean(i.isFullDay);
					// All-day dates are calendar days; read them in the zone they were written in.
					// Floating dates (no zone) are parsed as local midnight of this process.
					const dayTz = allDay ? ((i.start as Date & { tz?: string }).tz ?? PROCESS_TZ) : tz;
					const startDate = ymd(i.start, dayTz);
					const endDate = i.end ? ymd(new Date(i.end.getTime() - (allDay ? 1 : 0)), dayTz) : startDate; // inclusive
					list.push({
						title: cleanTitle(i.summary),
						allDay,
						startDate,
						endDate,
						start: i.start,
						end: i.end ?? null,
						location: shortLocation(i.event?.location),
						feed: f.name
					});
				}
			}
		} catch (e) {
			errors.push(`${f.name}: ${(e as Error).message}`);
		}
	}
	return { list, error: errors.length ? errors.join('; ') : null };
}

/**
 * Every event instance touching the local dates `from`..`to` (inclusive), for other readers of the
 * same feeds (calendar day types, ADR-29). `connected` is false when there is no feed folder.
 */
export function calendarInstances(dir: string | undefined, tz: string, from: string, to: string): { connected: boolean; error: string | null; list: Instance[] } {
	if (!dir || !fs.existsSync(path.join(dir, 'feeds.json'))) return { connected: false, error: null, list: [] };
	try {
		const got = instances(dir, tz, startOf(from, tz), startOf(addDays(to, 1), tz));
		return { connected: true, ...got };
	} catch (e) {
		return { connected: true, error: (e as Error).message, list: [] };
	}
}

function dedupe<T extends { title: string; start: string }>(evs: T[]): T[] {
	const seen = new Set<string>();
	return evs.filter((e) => {
		const k = `${e.title.toLowerCase()}|${e.start}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/** Today's events and the next `days` days, as the wall shows them. */
export function calendarView(dir: string | undefined, tz: string, now = new Date(), days = 7): CalendarView {
	const empty = { today: [], upcoming: [] };
	if (!dir || !fs.existsSync(path.join(dir, 'feeds.json'))) return { connected: false, error: null, ...empty };
	const today = ymd(now, tz);
	const last = addDays(today, days);
	let got: ReturnType<typeof instances>;
	try {
		got = instances(dir, tz, startOf(today, tz), startOf(addDays(last, 1), tz));
	} catch (e) {
		return { connected: true, error: (e as Error).message, ...empty };
	}
	const time = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
	const toEvent = (i: Instance): CalEvent => ({
		title: i.title,
		allDay: i.allDay,
		start: i.allDay ? i.startDate : i.start.toISOString(),
		end: i.end ? i.end.toISOString() : null,
		time: i.allDay ? null : time.format(i.start).replace(/\s/g, ' '),
		location: i.location,
		feed: i.feed,
		past: !i.allDay && (i.end ?? i.start).getTime() <= now.getTime()
	});
	const order = (a: Instance, b: Instance) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime();
	const onDay = (date: string, i: Instance) => (i.allDay ? i.startDate <= date && date <= i.endDate : i.startDate === date);

	const todays = dedupe(got.list.filter((i) => onDay(today, i)).sort(order).map(toEvent));
	const weekday = new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'UTC' });
	const label = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	const upcoming: CalDay[] = [];
	for (let n = 1; n <= days; n++) {
		const date = addDays(today, n);
		// A multi-day event that started earlier shows once, on the first day listed (tomorrow).
		const evs = got.list.filter((i) => onDay(date, i) && (n === 1 || !i.allDay || i.startDate === date)).sort(order);
		const d = new Date(`${date}T00:00:00Z`);
		upcoming.push({ date, weekday: weekday.format(d), label: label.format(d), events: dedupe(evs.map(toEvent)) });
	}
	return { connected: true, error: got.error, today: todays, upcoming };
}
