import type { DB } from '../db';
import { boardKids, weekGrid, type BoardKid, type WeekCell } from './board';
import { calendarView, type CalEvent } from './calendar';
import { activePlan, firstBaby, planDay } from './plan';
import { allLists, wallTodo, type WallTodo } from './lists';
import { editedLabel, listNotes } from './notes';
import { displayDate, localParts, DEFAULT_TZ } from './time';
import { weatherCache, type WallWeather } from '../weather';

// The Planner's Home (ADR-38): the day at a glance on a phone. The Board's sources (weather,
// each child's routine now, to do, the week) plus the calendar's today and tomorrow, the
// baby's plan, and one line per list and note. Ticks and the baby's timer only; every card
// opens its own page for anything else.

export const HOME_DUE_ROWS = 5;
export const HOME_LISTS = 3;
export const HOME_NOTES = 2;
/** From 5 pm Home also shows tomorrow's events. */
export const EVENING_FROM = 17 * 60;

/**
 * Where the day is, from the routines' own windows:
 * `routine` a child's routine is running (it leads the page), `day` one is still to come today,
 * `evening` none is left today (tomorrow's events show).
 */
export type HomePhase = 'routine' | 'day' | 'evening';

export interface HomeBaby {
	name: string;
	icon: string;
	plan: string;
	/** The timer running now ("Sleep"), with when it started (ISO) for a live counter. */
	running: { stepId: number; title: string; icon: string | null; since: string } | null;
	/** The next step: a timer is started here, anything else is ticked. */
	next: { stepId: number; title: string; icon: string | null; time: string | null; estimate: boolean; timer: boolean } | null;
	/** The last step ticked today that is not a timer ("Milk"), for "2 h 10 ago". */
	last: { title: string; at: string } | null;
	done: number;
	total: number;
}

export interface HomeView {
	date: string;
	dateLabel: string;
	greeting: string;
	tz: string;
	phase: HomePhase;
	weather: WallWeather | null;
	kids: BoardKid[];
	baby: HomeBaby | null;
	calendar: { connected: boolean; error: string | null; today: CalEvent[]; tomorrow: CalEvent[] | null };
	due: WallTodo[];
	dueMore: number;
	lists: Array<{ id: number; name: string; icon: string; open: number }>;
	listsMore: number;
	notes: Array<{ id: number; title: string; preview: string; edited: string }>;
	notesMore: number;
	week: WeekCell[];
}

export function homePhase(kids: BoardKid[]): HomePhase {
	if (kids.some((k) => k.routine?.state === 'now')) return 'routine';
	if (kids.length === 0 || kids.some((k) => k.routine || k.next)) return 'day';
	return 'evening';
}

export function greeting(hour: number): string {
	return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function homeBaby(db: DB, date: string, now: Date, tz: string): HomeBaby | null {
	const b = firstBaby(db);
	const plan = b && activePlan(db, b.id);
	if (!b || !plan) return null;
	const day = planDay(db, plan, date, now, tz);
	const last = day.rows
		.filter((r) => r.done && !r.timer && r.completedAt)
		.sort((x, y) => Date.parse(y.completedAt!) - Date.parse(x.completedAt!))[0];
	return {
		name: b.name,
		icon: b.icon,
		plan: plan.name,
		running: day.running?.completedAt ? { stepId: day.running.id, title: day.running.title, icon: day.running.icon, since: day.running.completedAt } : null,
		next: day.next ? { stepId: day.next.id, title: day.next.title, icon: day.next.icon, time: day.next.time, estimate: day.next.estimate, timer: day.next.timer } : null,
		last: last ? { title: last.title, at: last.completedAt! } : null,
		done: day.rows.filter((r) => r.done).length,
		total: day.rows.length
	};
}

export function homeView(db: DB, opts: { dir?: string; tz?: string; now?: Date; rollover?: number } = {}): HomeView {
	const tz = opts.tz ?? DEFAULT_TZ;
	const now = opts.now ?? new Date();
	const date = displayDate(now, tz, opts.rollover);
	const local = localParts(now, tz);
	const kids = boardKids(db, date, now, tz);
	const phase = homePhase(kids);

	const cal = calendarView(opts.dir, tz, now, 1);
	const today = cal.today.filter((e) => !e.past);
	// Tomorrow shows from 5 pm, once the day's routines are over, or when nothing is left today.
	const tomorrow = phase === 'evening' || local.minutes >= EVENING_FROM || today.length === 0 ? (cal.upcoming[0]?.events ?? []) : null;

	const todo = wallTodo(db, now);
	const due = todo.slice(0, HOME_DUE_ROWS);
	const lists = allLists(db, now);
	const notes = listNotes(db);

	return {
		date,
		dateLabel: new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now),
		greeting: greeting(Math.floor(local.minutes / 60)),
		tz,
		phase,
		weather: weatherCache.get(now, tz),
		kids,
		baby: homeBaby(db, date, now, tz),
		calendar: { connected: cal.connected, error: cal.error, today, tomorrow },
		due,
		dueMore: todo.filter((i) => !i.done).length - due.filter((i) => !i.done).length,
		lists: lists.slice(0, HOME_LISTS).map((l) => ({ id: l.id, name: l.name, icon: l.icon, open: l.open })),
		listsMore: Math.max(0, lists.length - HOME_LISTS),
		notes: notes.slice(0, HOME_NOTES).map((n) => ({ id: n.id, title: n.title, preview: n.preview, edited: editedLabel(n.updatedAt, now) })),
		notesMore: Math.max(0, notes.length - HOME_NOTES),
		week: weekGrid(db, opts.dir, tz, local.date, now).week
	};
}
