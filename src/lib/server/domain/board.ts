import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { DB } from '../db';
import { list, listItem, member } from '../db/schema';
import { addDays, hhmm, localParts, DEFAULT_TZ } from './time';
import { calendarInstances, type Instance } from './calendar';
import { dayTypeById, getOrCreateOccurrence, occurrenceSteps, resolveDayType, templatesForMember } from './routines';
import { selectActive, selectNext } from './windows';
import { activePlan, firstBaby, planDay } from './plan';
import { wallLists, wallTodo, type WallList, type WallTodo } from './lists';
import { weatherCache, type WallWeather } from '../weather';
import { displayDate } from './time';

// The Board (SPEC §2.0, ADR-30): the wall's data in colour on a spare screen. Same sources as
// the wall's home and lists screens (to do, lists, weather, agenda) plus what the kid view
// shows (each child's routine now) and a week grid borrowed from the Skylight
// (docs/skylight-parity.md). Ticks are allowed; nothing is created here.

export const WEEK_CELL_EVENTS = 4;
export const NEXT_WEEK_EVENTS = 3;
export const BOARD_TODO_ROWS = 8;

export interface BoardStep {
	id: number;
	title: string;
	icon: string | null;
	done: boolean;
}
export interface BoardKid {
	id: number;
	name: string;
	icon: string;
	dayType: { name: string; glyph: string } | null;
	/** The routine running now, else the next one today (`state: 'soon'`), else null. */
	routine: null | { occurrenceId: number; name: string; window: string; state: 'now' | 'soon'; steps: BoardStep[]; done: number; total: number };
	/** When nothing runs: the next routine today, or null when the day is over. */
	next: { name: string; start: string } | null;
}
export interface BoardBaby {
	name: string;
	icon: string;
	plan: string;
	next: { title: string; icon: string | null; time: string | null; estimate: boolean; waiting: string | null } | null;
	running: { title: string; icon: string | null; since: string | null } | null;
	done: number;
	total: number;
}
export interface WeekEvent {
	time: string | null;
	title: string;
	/** A member's glyph when the event is theirs (their calendar), else null. */
	icon: string | null;
	kind: 'event' | 'todo';
	past: boolean;
}
export interface WeekCell {
	date: string;
	weekday: string;
	day: number;
	today: boolean;
	past: boolean;
	events: WeekEvent[];
	more: number;
}
export interface BoardView {
	date: string;
	dateLabel: string;
	tz: string;
	weather: WallWeather | null;
	kids: BoardKid[];
	baby: BoardBaby | null;
	todo: WallTodo[];
	todoMore: number;
	lists: WallList[];
	week: WeekCell[];
	nextWeek: { count: number; events: Array<WeekEvent & { weekday: string }> };
	calendar: boolean;
}

const timeLabel = (minutes: number) => {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
};

export function boardKids(db: DB, date: string, now: Date, tz: string): BoardKid[] {
	return db
		.select()
		.from(member)
		.where(and(eq(member.kind, 'child'), eq(member.active, true)))
		.orderBy(asc(member.sort), asc(member.id))
		.all()
		.map((k) => {
			const templates = templatesForMember(db, k.id);
			const active = selectActive(templates, now, tz);
			const next = selectNext(templates, now, tz);
			const pick = active ? { template: active.template, date: active.date, state: 'now' as const } : next ? { template: next, date, state: 'soon' as const } : null;
			let routine: BoardKid['routine'] = null;
			let dayTypeId = resolveDayType(db, k.id, date);
			if (pick) {
				const occ = getOrCreateOccurrence(db, pick.template, pick.date, now);
				dayTypeId = occ.dayTypeId;
				const steps = occurrenceSteps(db, occ.id).map((s) => ({ id: s.id, title: s.titleSnapshot, icon: s.iconSnapshot, done: Boolean(s.completedAt) }));
				routine = {
					occurrenceId: occ.id,
					name: pick.template.name,
					window: `${timeLabel(hhmm(pick.template.windowStart))} – ${timeLabel(hhmm(pick.template.windowEnd))}`,
					state: pick.state,
					steps,
					done: steps.filter((s) => s.done).length,
					total: steps.length
				};
			}
			const dt = dayTypeById(db, dayTypeId);
			return {
				id: k.id,
				name: k.name,
				icon: k.icon,
				dayType: dt ? { name: dt.name, glyph: dt.glyph } : null,
				routine,
				next: next && pick?.state !== 'soon' ? { name: next.name, start: timeLabel(hhmm(next.windowStart)) } : null
			};
		});
}

function baby(db: DB, date: string, now: Date, tz: string): BoardBaby | null {
	const b = firstBaby(db);
	const plan = b && activePlan(db, b.id);
	if (!b || !plan) return null;
	const day = planDay(db, plan, date, now, tz);
	return {
		name: b.name,
		icon: b.icon,
		plan: plan.name,
		next: day.next ? { title: day.next.title, icon: day.next.icon, time: day.next.time, estimate: day.next.estimate, waiting: day.next.waiting } : null,
		running: day.running ? { title: day.running.title, icon: day.running.icon, since: day.running.time } : null,
		done: day.rows.filter((r) => r.done).length,
		total: day.rows.length
	};
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The Monday on or before a local date. */
export function mondayOf(date: string): string {
	const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
	return addDays(date, -((wd + 6) % 7));
}

function dedupe(evs: WeekEvent[]): WeekEvent[] {
	const seen = new Set<string>();
	return evs.filter((e) => {
		const k = `${e.title.toLowerCase()}|${e.time ?? ''}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/**
 * This week (Mon–Sun) and next: calendar events from Tesserae's feeds (ADR-19) and dated
 * list items that are not shopping, on their day. All-day first, then by time.
 */
export function weekGrid(db: DB, dir: string | undefined, tz: string, today: string, now: Date): { week: WeekCell[]; nextWeek: BoardView['nextWeek']; calendar: boolean } {
	const monday = mondayOf(today);
	const end = addDays(monday, 13);
	const cal = calendarInstances(dir, tz, monday, end);
	const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
	const people = new Map(db.select({ name: member.name, icon: member.icon }).from(member).all().map((m) => [m.name.toLowerCase(), m.icon]));
	const kinds = new Map(db.select({ id: list.id, kind: list.kind }).from(list).all().map((l) => [l.id, l.kind]));
	const due = db
		.select({ title: listItem.title, date: listItem.dueDate, listId: listItem.listId })
		.from(listItem)
		.where(and(isNull(listItem.doneAt), gte(listItem.dueDate, monday), lte(listItem.dueDate, end)))
		.all()
		.filter((i) => kinds.get(i.listId) !== 'grocery');
	const onDay = (date: string, i: Instance) => (i.allDay ? i.startDate <= date && date <= i.endDate : i.startDate === date);
	const dayEvents = (date: string): WeekEvent[] => {
		const evs = cal.list
			.filter((i) => onDay(date, i))
			.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
			.map<WeekEvent>((i) => ({
				time: i.allDay ? null : fmt.format(i.start).replace(/\s/g, ' '),
				title: i.title,
				icon: people.get(i.feed.toLowerCase()) ?? null,
				kind: 'event',
				past: !i.allDay && (i.end ?? i.start).getTime() <= now.getTime()
			}));
		const todos = due.filter((i) => i.date === date).map<WeekEvent>((i) => ({ time: null, title: i.title, icon: null, kind: 'todo', past: false }));
		return [...dedupe(evs), ...todos];
	};
	const week: WeekCell[] = [];
	for (let n = 0; n < 7; n++) {
		const date = addDays(monday, n);
		const all = dayEvents(date);
		const shown = all.length <= WEEK_CELL_EVENTS ? all : all.slice(0, WEEK_CELL_EVENTS - 1);
		week.push({
			date,
			weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
			day: Number(date.slice(8)),
			today: date === today,
			past: date < today,
			events: shown,
			more: all.length - shown.length
		});
	}
	const nextAll: Array<WeekEvent & { weekday: string }> = [];
	for (let n = 7; n < 14; n++) {
		const date = addDays(monday, n);
		const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
		for (const e of dayEvents(date)) nextAll.push({ ...e, weekday });
	}
	return { week, nextWeek: { count: nextAll.length, events: nextAll.slice(0, NEXT_WEEK_EVENTS) }, calendar: cal.connected };
}

export function boardView(db: DB, opts: { dir?: string; tz?: string; now?: Date; rollover?: number } = {}): BoardView {
	const tz = opts.tz ?? DEFAULT_TZ;
	const now = opts.now ?? new Date();
	const date = displayDate(now, tz, opts.rollover);
	const today = localParts(now, tz).date;
	const todo = wallTodo(db, now);
	const shownTodo = todo.length <= BOARD_TODO_ROWS ? todo : todo.slice(0, BOARD_TODO_ROWS - 1);
	const grid = weekGrid(db, opts.dir, tz, today, now);
	return {
		date,
		dateLabel: new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now),
		tz,
		weather: weatherCache.get(now, tz),
		kids: boardKids(db, date, now, tz),
		baby: baby(db, date, now, tz),
		todo: shownTodo,
		todoMore: todo.filter((i) => !i.done).length - shownTodo.filter((i) => !i.done).length,
		lists: wallLists(db, now),
		...grid
	};
}
